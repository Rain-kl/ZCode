import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { SessionId, ToolCallId, TraceId } from "@zcode/contracts";

import {
  FORK_WEBFETCH_DIRECT_MAX_CONTENT_CHARS,
  FORK_WEBFETCH_DIRECT_MAX_RAW_CHARS,
  FORK_WEBFETCH_DIRECT_MIN_REMAINING_TOKENS,
  countForkWebfetchContentChars,
  decideForkWebfetchDirectPassThrough,
} from "../src/fork/webfetch-direct-passthrough/policy.js";
import { resolveForkRemainingContextTokens } from "../src/fork/webfetch-direct-passthrough/remaining-tokens.js";
import type { ToolExecutionContext } from "../src/tool/types.js";
import type { CachedFetchContent } from "../src/tool/handlers/webfetch-types.js";
import { processFetchedContent } from "../src/tool/handlers/webfetch-processing.js";

/**
 * 契约：短页面不再经过「加工模型」二次总结，而是把抽取出的正文直接交给调用方模型。
 * 判定依赖 runtime 给出的剩余上下文预算；预算不可得时宁可多花一次加工调用，
 * 也不在未知预算下放大上下文。
 *
 * 产品规则见 docs/features/webfetch-direct-passthrough/design.md。
 */

const ENOUGH_REMAINING = FORK_WEBFETCH_DIRECT_MIN_REMAINING_TOKENS;

function nonPunctuationContent(chars: number): string {
  return "a".repeat(chars);
}

function cachedContent(overrides: Partial<CachedFetchContent> = {}): CachedFetchContent {
  const content = overrides.content ?? nonPunctuationContent(100);
  return {
    bytes: content.length,
    content,
    contentType: "text/html",
    finalUrl: "https://example.com/doc",
    redirects: [],
    sizeBytes: content.length,
    status: 200,
    statusText: "OK",
    ...overrides,
  };
}

/**
 * 不带 model：直通路径必须能跑通（它本来就不需要模型）；
 * 未命中时则会落到「需要 model」的分支，从而把「是否走了加工模型」变成可断言的事实。
 */
function contextWithoutModel(
  overrides: Partial<ToolExecutionContext> = {},
): ToolExecutionContext {
  return {
    abortSignal: new AbortController().signal,
    sessionId: "session_test" as SessionId,
    toolCallId: "toolcall_test" as ToolCallId,
    traceId: "trace_test" as TraceId,
    workingDirectory: "/tmp",
    workspaceRoot: "/tmp",
    ...overrides,
  };
}

const WEB_FETCH_INPUT = { url: "https://example.com/doc", prompt: "总结要点" };

// -----------------------------------------------
// 字数口径
// -----------------------------------------------

test("字数排除 Unicode 标点：中英文标点都不计入", () => {
  assert.equal(countForkWebfetchContentChars("你好，世界。"), 4);
  assert.equal(countForkWebfetchContentChars("a, b!"), 3);
  assert.equal(countForkWebfetchContentChars("（括号）、顿号"), 4);
});

test("字数计入空白、换行与符号类字符", () => {
  // 空白是保守取法的一部分：宽算只会更早回落总结，不会放大上下文。
  assert.equal(countForkWebfetchContentChars("a b"), 3);
  assert.equal(countForkWebfetchContentChars("a\nb"), 3);
  // `+` `=` 属于 Unicode S*（符号）而非 P*（标点），按设计计入。
  assert.equal(countForkWebfetchContentChars("a+b=c"), 5);
});

test("字数按 Unicode 码点计算，增补平面字符算 1", () => {
  assert.equal(countForkWebfetchContentChars("🙂🙂"), 2);
  assert.equal(countForkWebfetchContentChars("a🙂b"), 3);
});

// -----------------------------------------------
// 直通判定边界
// -----------------------------------------------

test("正文 14999 字且剩余 30000 → 直通", () => {
  const decision = decideForkWebfetchDirectPassThrough({
    content: nonPunctuationContent(FORK_WEBFETCH_DIRECT_MAX_CONTENT_CHARS - 1),
    remainingContextTokens: ENOUGH_REMAINING,
  });
  assert.equal(decision.direct, true);
  assert.equal(decision.reason, "direct");
  assert.equal(decision.contentChars, FORK_WEBFETCH_DIRECT_MAX_CONTENT_CHARS - 1);
});

test("正文正好 15000 字 → 不直通（严格小于）", () => {
  const decision = decideForkWebfetchDirectPassThrough({
    content: nonPunctuationContent(FORK_WEBFETCH_DIRECT_MAX_CONTENT_CHARS),
    remainingContextTokens: ENOUGH_REMAINING,
  });
  assert.equal(decision.direct, false);
  assert.equal(decision.reason, "content_too_long");
});

test("剩余正好 29999 → 不直通（至少 30000）", () => {
  const decision = decideForkWebfetchDirectPassThrough({
    content: nonPunctuationContent(100),
    remainingContextTokens: ENOUGH_REMAINING - 1,
  });
  assert.equal(decision.direct, false);
  assert.equal(decision.reason, "remaining_insufficient");
});

test("剩余预算不可得 → 不直通", () => {
  const decision = decideForkWebfetchDirectPassThrough({
    content: nonPunctuationContent(100),
    remainingContextTokens: undefined,
  });
  assert.equal(decision.direct, false);
  assert.equal(decision.reason, "remaining_unknown");
});

test("原始长度超过模型输入上限时不直通，先于字数判定生效", () => {
  const decision = decideForkWebfetchDirectPassThrough({
    // 全是标点：去标点后字数为 0，只可能被原始长度守卫拦下。
    content: "，".repeat(FORK_WEBFETCH_DIRECT_MAX_RAW_CHARS + 1),
    remainingContextTokens: ENOUGH_REMAINING,
  });
  assert.equal(decision.direct, false);
  assert.equal(decision.reason, "content_too_long_raw");
});

// -----------------------------------------------
// 剩余预算投影
// -----------------------------------------------

test("剩余预算 = contextWindow − 本次请求估算用量", () => {
  assert.equal(
    resolveForkRemainingContextTokens({ contextWindow: 200_000, estimatedCurrentUsage: 170_000 }),
    30_000,
  );
  assert.equal(
    resolveForkRemainingContextTokens({ contextWindow: 200_000, estimatedCurrentUsage: 200_500 }),
    0,
  );
});

test("模型未声明 contextWindow 或用量非法时剩余预算不可得", () => {
  assert.equal(
    resolveForkRemainingContextTokens({ contextWindow: undefined, estimatedCurrentUsage: 1_000 }),
    undefined,
  );
  assert.equal(
    resolveForkRemainingContextTokens({ contextWindow: 0, estimatedCurrentUsage: 1_000 }),
    undefined,
  );
  assert.equal(
    resolveForkRemainingContextTokens({ contextWindow: 200_000, estimatedCurrentUsage: -1 }),
    undefined,
  );
  assert.equal(
    resolveForkRemainingContextTokens({
      contextWindow: 200_000,
      estimatedCurrentUsage: Number.NaN,
    }),
    undefined,
  );
});

// -----------------------------------------------
// 处理器接线
// -----------------------------------------------

test("命中直通时不调用加工模型，直接返回正文原文", async () => {
  const fetched = cachedContent({ content: "第一段\n\n第二段，带标点。" });
  const result = await processFetchedContent(
    WEB_FETCH_INPUT,
    fetched,
    contextWithoutModel({ remainingContextTokens: ENOUGH_REMAINING }),
  );

  // 上下文里没有 model：走到加工分支必然抛「Model is not configured」，
  // 因此这里能返回内容本身就证明直通没有依赖模型。
  assert.equal(result.result, fetched.content);
  assert.equal(result.truncated, false);
});

test("正文过长时仍走加工模型（无 model 时暴露配置错误）", async () => {
  await assert.rejects(
    processFetchedContent(
      WEB_FETCH_INPUT,
      cachedContent({ content: nonPunctuationContent(FORK_WEBFETCH_DIRECT_MAX_CONTENT_CHARS) }),
      contextWithoutModel({ remainingContextTokens: ENOUGH_REMAINING }),
    ),
    /Model is not configured for WebFetch prompt processing/,
  );
});

test("预算不足或不可得时仍走加工模型", async () => {
  for (const remainingContextTokens of [ENOUGH_REMAINING - 1, undefined]) {
    await assert.rejects(
      processFetchedContent(
        WEB_FETCH_INPUT,
        cachedContent(),
        contextWithoutModel({ remainingContextTokens }),
      ),
      /Model is not configured for WebFetch prompt processing/,
    );
  }
});

test("预批文档站的 markdown 短路不受影响", async () => {
  const fetched = cachedContent({
    content: "# 标题\n\n正文",
    contentType: "text/markdown",
  });
  const result = await processFetchedContent(
    WEB_FETCH_INPUT,
    fetched,
    // 上游这条短路不依赖预算，剩余预算缺席时也必须照样直返原文。
    contextWithoutModel(),
    { preapprovedUrl: true },
  );

  assert.equal(result.result, fetched.content);
  assert.equal(result.truncated, false);
});

// -----------------------------------------------
// 接线不变量：白名单式重建必须带上预算字段
// -----------------------------------------------

test("批量/调度层每处转发 model 的地方都必须转发剩余预算", () => {
  // 这一层不是 object spread，而是逐个字段重建 options：漏一个字段不报错、不影响类型检查，
  // 只在运行期表现为「WebFetch 又悄悄变回总结」。第一版实现正是断在这里，所以断言「配对」
  // 而不是「存在」——上游将来新增一处重建点时这条也会红。
  const source = readFileSync(
    new URL("../src/tool/executor/batch-runner.ts", import.meta.url),
    "utf8",
  );
  const modelForwards = source.match(/model:\s*options\?\.model,/g) ?? [];
  const budgetForwards =
    source.match(/remainingContextTokens:\s*options\?\.remainingContextTokens,/g) ?? [];

  assert.ok(modelForwards.length >= 2, `期望至少 2 处 options 重建，实际 ${modelForwards.length}`);
  assert.equal(budgetForwards.length, modelForwards.length);
});
