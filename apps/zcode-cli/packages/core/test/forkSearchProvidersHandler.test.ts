import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type HttpClientPort,
  WebSearchInputSchema,
  WebSearchOutputSchema,
} from "@zcode/contracts";
import type { SearchChannel } from "../src/fork/search-providers/channel.js";
import {
  buildSearchChannelChain,
  resetSearchChannelCacheForTests,
} from "../src/fork/search-providers/channels.js";
import {
  WEBSEARCH_TOOL_NAME,
  buildWebSearchProviderDescription,
} from "../src/tool/handlers/websearch.js";

test("入参接受 max_results，且仍是 strict", () => {
  const parsed = WebSearchInputSchema.parse({ query: "query", max_results: 5 });
  assert.equal(parsed.max_results, 5);
  assert.throws(() => WebSearchInputSchema.parse({ query: "query", nope: 1 }));
});

test("输出接受可选 channel，且缺省时仍合法", () => {
  // 注意：WebSearchOutputSchema 是 strict，且没有 truncated 字段（那是 WebFetchOutput 的）。
  const base = { query: "q", results: [], sources: [], durationMs: 1 };
  assert.ok(WebSearchOutputSchema.safeParse(base).success);
  assert.ok(
    WebSearchOutputSchema.safeParse({ ...base, channel: { kind: "tavily", label: "工作用" } }).success,
  );
});

test("工具描述不再声称 US-only", () => {
  const description = buildWebSearchProviderDescription(new Date("2026-09-29T00:00:00Z"));
  assert.ok(!/US-only/.test(description));
  assert.match(description, /current month is September 2026/);
});

test("工具名未变（模型侧签名保持单一形状）", () => {
  assert.equal(WEBSEARCH_TOOL_NAME, "WebSearch");
});

const fakeHttpClientPort: HttpClientPort = {
  async request() {
    throw new Error("not used in chain ordering test");
  },
};

const fakeServerChannel: SearchChannel = {
  kind: "server",
  label: "服务端搜索",
  async search() {
    throw new Error("not used in chain ordering test");
  },
};

function writeChannelsFile(home: string, payload: unknown): string {
  const dir = join(home, ".zcode", "cli", "fork");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "settings.json");
  writeFileSync(file, JSON.stringify(payload), "utf8");
  return file;
}

test("buildSearchChannelChain 保证服务端渠道在首位，后接按文件顺序的启用 Tavily 渠道", () => {
  resetSearchChannelCacheForTests();
  const home = mkdtempSync(join(tmpdir(), "sp-handler-"));
  writeChannelsFile(home, {
    version: 1,
    channels: [
      { id: "c1", kind: "tavily", label: "渠道一", enabled: true, apiKey: "k1" },
      { id: "c2", kind: "tavily", label: "渠道二 (禁用)", enabled: false, apiKey: "k2" },
      { id: "c3", kind: "tavily", label: "渠道三", enabled: true, apiKey: "k3" },
    ],
  });

  const chain = buildSearchChannelChain({
    homeDir: home,
    httpClientPort: fakeHttpClientPort,
    serverChannel: fakeServerChannel,
  });

  assert.equal(chain.length, 3);
  assert.equal(chain[0]?.kind, "server");
  assert.equal(chain[0]?.label, "服务端搜索");
  assert.equal(chain[1]?.kind, "tavily");
  assert.equal(chain[1]?.label, "渠道一");
  assert.equal(chain[2]?.kind, "tavily");
  assert.equal(chain[2]?.label, "渠道三");
});

