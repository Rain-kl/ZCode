import test from "node:test";
import assert from "node:assert/strict";
import { createHttpClientError } from "@zcode/contracts";
import {
  TAVILY_SEARCH_ENDPOINT,
  buildTavilySearchRequest,
  classifyTavilyFailure,
  createTavilyChannel,
  mapTavilyResponse,
} from "../src/fork/search-providers/tavily.js";

/** HttpClientRequest.body 是 Uint8Array，断言前必须解码——直接 deepEqual 一个对象必然失败。 */
function decodeBody(body: Uint8Array | undefined): unknown {
  assert.ok(body, "请求体必须存在");
  return JSON.parse(new TextDecoder().decode(body)) as unknown;
}

test("请求形状：端点、方法、Bearer 鉴权与 JSON 体", () => {
  const request = buildTavilySearchRequest({ query: "hello", apiKey: "tvly-k" });
  assert.equal(request.url, TAVILY_SEARCH_ENDPOINT);
  assert.equal(request.url, "https://api.tavily.com/search");
  assert.equal(request.method, "POST");
  assert.equal(request.headers?.Authorization, "Bearer tvly-k");
  assert.equal(request.headers?.["Content-Type"], "application/json");
  assert.deepEqual(decodeBody(request.body), { query: "hello" });
});

test("可选参数只在有值时出现，且不再发送 maxUses", () => {
  const request = buildTavilySearchRequest({
    query: "q",
    apiKey: "k",
    allowedDomains: ["a.com"],
    blockedDomains: [],
    maxResults: 3,
    maxUses: 8,
  });
  assert.deepEqual(decodeBody(request.body), {
    query: "q",
    max_results: 3,
    include_domains: ["a.com"],
  });
  assert.ok(!("maxUses" in (decodeBody(request.body) as Record<string, unknown>)));
  assert.ok(!("exclude_domains" in (decodeBody(request.body) as Record<string, unknown>)));
});

test("域名列表被截断到厂商上限（include 300 / exclude 150）", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => `d${i}.com`);
  const request = buildTavilySearchRequest({
    query: "q",
    apiKey: "k",
    allowedDomains: many(305),
    blockedDomains: many(160),
  });
  const body = decodeBody(request.body) as { include_domains: string[]; exclude_domains: string[] };
  assert.equal(body.include_domains.length, 300);
  assert.equal(body.exclude_domains.length, 150);
});

test("响应映射：vendor 字段转成中立结果项，published_date → pageAge", () => {
  const mapped = mapTavilyResponse({
    query: "q",
    results: [
      { title: "T1", url: "https://a.com", content: "snippet", score: 0.9, published_date: "2026-01-02" },
      { url: "https://b.com" },
    ],
    response_time: 1.2,
  });
  assert.deepEqual(mapped.items, [
    { url: "https://a.com", title: "T1", pageAge: "2026-01-02" },
    { url: "https://b.com", title: undefined, pageAge: undefined },
  ]);
  assert.match(mapped.text, /https:\/\/a\.com/);
  assert.match(mapped.text, /snippet/);
});

test("200 但 results 为空数组 = 成功（不得当作失败去降级）", () => {
  const mapped = mapTavilyResponse({ query: "q", results: [] });
  assert.deepEqual(mapped.items, []);
  assert.equal(mapped.text, "");
});

test("results 缺失或不是数组 = 响应不合规，抛错", () => {
  assert.throws(() => mapTavilyResponse({ query: "q" }), /results/);
  assert.throws(() => mapTavilyResponse({ query: "q", results: "nope" }), /results/);
  assert.throws(() => mapTavilyResponse(null), /results/);
});

test("错误分类逐条覆盖状态码与厂商消息", () => {
  const detail = (message: string) => JSON.stringify({ detail: { error: message } });
  assert.match(classifyTavilyFailure(401, detail("invalid api key"), "Unauthorized"), /401/);
  assert.match(classifyTavilyFailure(401, detail("invalid api key"), "Unauthorized"), /invalid api key/);
  assert.match(classifyTavilyFailure(429, detail("too many"), "Too Many Requests"), /429/);
  assert.match(classifyTavilyFailure(432, detail("plan limit"), "Limit"), /432/);
  assert.match(classifyTavilyFailure(433, detail("paygo limit"), "Limit"), /433/);
  assert.match(classifyTavilyFailure(400, detail("bad body"), "Bad Request"), /400/);
  assert.match(classifyTavilyFailure(422, JSON.stringify({ detail: [{ msg: "bad" }] }), "Unprocessable"), /422/);
  assert.match(classifyTavilyFailure(500, "", "Internal Server Error"), /500/);
});

test("错误体不是预期形状时不崩，仍给出状态码", () => {
  assert.match(classifyTavilyFailure(500, "<html>oops</html>", "Internal Server Error"), /500/);
  // 405 的 detail 是纯字符串（第三种形状）——我们不会发 GET，但解析必须是全函数
  assert.match(classifyTavilyFailure(405, JSON.stringify({ detail: "Method Not Allowed" }), "Method Not Allowed"), /405/);
  assert.ok(!classifyTavilyFailure(405, JSON.stringify({ detail: "Method Not Allowed" }), "Method Not Allowed").includes("undefined"));
});

test("published_date 缺席时 pageAge 为 undefined（真实响应默认不含该字段）", () => {
  const mapped = mapTavilyResponse({
    query: "q",
    results: [{ url: "https://a.com", title: "T", content: "c", score: 0.5, raw_content: null }],
  });
  assert.equal(mapped.items[0]?.pageAge, undefined);
});

test("渠道：HTTP 错误转成带状态码的失败，超时转成超时失败", async () => {
  const channel = createTavilyChannel({
    label: "工作用",
    apiKey: "tvly-k",
    httpClientPort: {
      async request() {
        return {
          url: TAVILY_SEARCH_ENDPOINT,
          status: 401,
          statusText: "Unauthorized",
          headers: {},
          body: new TextEncoder().encode('{"detail":{"error":"invalid api key"}}'),
          bytes: 40,
          durationMs: 5,
        };
      },
    },
  });
  await assert.rejects(
    () => channel.search({ query: "q" }),
    (error: unknown) => {
      assert.match(String(error instanceof Error ? error.message : error), /401/);
      return true;
    },
  );
});

test("渠道：成功响应产出中立结果，且不发 egressPolicy（代理用户不被拦）", async () => {
  let seen: { egressPolicy?: unknown } | undefined;
  const channel = createTavilyChannel({
    label: "工作用",
    apiKey: "tvly-k",
    httpClientPort: {
      async request(request) {
        seen = request;
        return {
          url: TAVILY_SEARCH_ENDPOINT,
          status: 200,
          statusText: "OK",
          headers: {},
          body: new TextEncoder().encode(
            JSON.stringify({ query: "q", results: [{ title: "T", url: "https://a.com", content: "c" }] }),
          ),
          bytes: 60,
          durationMs: 5,
        };
      },
    },
  });
  const result = await channel.search({ query: "q", maxResults: 2 });
  assert.equal(seen?.egressPolicy, undefined);
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(result.toolResults?.[0]?.output, [
    { url: "https://a.com", title: "T", pageAge: undefined },
  ]);
});

test("渠道：200 但响应体非合法 JSON 时抛出带状态码与上下文的错误并保留 cause", async () => {
  const channel = createTavilyChannel({
    label: "工作用",
    apiKey: "tvly-k",
    httpClientPort: {
      async request() {
        return {
          url: TAVILY_SEARCH_ENDPOINT,
          status: 200,
          statusText: "OK",
          headers: {},
          body: new TextEncoder().encode("<html>bad gateway</html>"),
          bytes: 24,
          durationMs: 5,
        };
      },
    },
  });
  await assert.rejects(
    () => channel.search({ query: "q" }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Tavily.*非 JSON/);
      assert.match(error.message, /200/);
      assert.ok(error.cause instanceof SyntaxError);
      return true;
    },
  );
});

test("渠道：传输层失败保留底层错误码与消息", async () => {
  const channel = createTavilyChannel({
    label: "工作用",
    apiKey: "tvly-k",
    httpClientPort: {
      async request() {
        throw createHttpClientError({
          code: "timeout",
          message: "network timeout after 30000ms",
        });
      },
    },
  });
  await assert.rejects(
    () => channel.search({ query: "q" }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /transport failure/);
      assert.match(error.message, /timeout/);
      return true;
    },
  );
});

test("渠道：透传自定义 timeoutMs 与 signal", async () => {
  let seenRequest: unknown;
  let seenOptions: unknown;
  const controller = new AbortController();
  const channel = createTavilyChannel({
    label: "工作用",
    apiKey: "tvly-k",
    timeoutMs: 15_000,
    httpClientPort: {
      async request(req, options) {
        seenRequest = req;
        seenOptions = options;
        return {
          url: TAVILY_SEARCH_ENDPOINT,
          status: 200,
          statusText: "OK",
          headers: {},
          body: new TextEncoder().encode(JSON.stringify({ query: "q", results: [] })),
          bytes: 20,
          durationMs: 5,
        };
      },
    },
  });
  await channel.search({ query: "q", signal: controller.signal });
  assert.equal((seenRequest as { timeoutMs?: number }).timeoutMs, 15_000);
  assert.equal((seenOptions as { signal?: AbortSignal }).signal, controller.signal);
});
