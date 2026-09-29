import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  WebFetchErrorCode,
  WebFetchInputJsonSchema,
  WebFetchInputSchema,
  type SessionId,
  type ToolCallId,
  type TraceId,
} from "@zcode/contracts";

import { MAX_WEBFETCH_INLINE_BYTES, MAX_MODEL_INPUT_CHARS } from "../src/tool/handlers/webfetch-constants.js";
import { putWebFetchCache } from "../src/tool/handlers/webfetch-cache.js";
import { formatGenericPersistedOutputContent } from "../src/tool/result-persistence-format.js";
import { clearWebFetchCacheForTests, webFetchToolEntry } from "../src/tool/handlers/webfetch.js";
import type { CachedFetchContent } from "../src/tool/handlers/webfetch-types.js";
import type { ToolExecutionContext } from "../src/tool/types.js";

/**
 * 契约：WebFetch 不再调用任何模型，直接返回抽取出的正文；上下文封顶交给工具结果预算。
 * 产品规则见 docs/features/webfetch-direct-return/design.md。
 *
 * 这里用「预置内容缓存 + 不带 model 的上下文」驱动真实 handler：
 * 缓存命中时不会发起网络请求，而旧实现走到加工分支必然抛
 * 「Model is not configured for WebFetch prompt processing」——
 * 因此「能正常返回正文」本身就是「没有调用加工模型」的可断言事实。
 */

const WEB_FETCH_URL = "https://example.com/doc";

function cachedContent(overrides: Partial<CachedFetchContent> = {}): CachedFetchContent {
  const content = overrides.content ?? "第一段\n\n第二段，带标点。";
  return {
    bytes: content.length,
    content,
    contentType: "text/html",
    finalUrl: WEB_FETCH_URL,
    redirects: [],
    sizeBytes: content.length,
    status: 200,
    statusText: "OK",
    ...overrides,
  };
}

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

async function runHandler(fetched: CachedFetchContent): Promise<Record<string, unknown>> {
  clearWebFetchCacheForTests();
  putWebFetchCache(WEB_FETCH_URL, fetched);
  const output = await webFetchToolEntry.handler({ url: WEB_FETCH_URL }, contextWithoutModel());
  return output as Record<string, unknown>;
}

// -----------------------------------------------
// 处理器：直返正文，不调用模型
// -----------------------------------------------

test("缓存命中时直接返回正文原文，不调用加工模型", async () => {
  const fetched = cachedContent();
  const output = await runHandler(fetched);

  assert.equal(output.result, fetched.content);
  assert.equal(output.truncated, false);
  assert.equal(output.cacheHit, true);
});

test("超长正文同样直返全文：不再有字数/预算阈值判定", async () => {
  // 40 KiB 远超被取代的「去标点 15000 字」阈值：旧实现必然走加工分支并因缺少 model 而抛错。
  const content = "x".repeat(40 * 1024);
  const output = await runHandler(cachedContent({ content }));

  assert.equal(output.result, content);
  assert.equal(output.truncated, false);
});

test("空正文也走同一条直返路径", async () => {
  const output = await runHandler(cachedContent({ content: "" }));
  assert.equal(output.result, "");
});

// -----------------------------------------------
// 契约：prompt 参数退场
// -----------------------------------------------

test("工具声明里不再有 prompt 属性", () => {
  const properties = WebFetchInputJsonSchema.properties as Record<string, unknown>;
  assert.deepEqual(Object.keys(properties).sort(), ["url"]);
});

test("旧调用传入的 prompt 被 schema 丢弃且不抛错（向前兼容）", () => {
  const parsed = WebFetchInputSchema.parse({ url: WEB_FETCH_URL, prompt: "总结要点" });
  assert.deepEqual(parsed, { url: WEB_FETCH_URL });
  assert.equal("prompt" in parsed, false);
});

test("摘要专属错误码不再出现在契约里", () => {
  assert.equal("ProcessingFailed" in WebFetchErrorCode, false);
});

// -----------------------------------------------
// 上下文封顶：配置必须真的会触发
// -----------------------------------------------

test("结果预算按内联上限封顶，且该上限低于输入侧落盘阈值", () => {
  const budget = webFetchToolEntry.resultBudget;
  assert.ok(budget, "WebFetch 必须声明 resultBudget");
  assert.equal(budget.maxModelBytes, MAX_WEBFETCH_INLINE_BYTES);
  assert.equal(budget.maxInlineBytes, MAX_WEBFETCH_INLINE_BYTES);
  assert.equal(budget.strategy, "artifact");
  assert.equal(budget.preview?.maxBytes, MAX_WEBFETCH_INLINE_BYTES);

  // 不变量：内联上限必须小于输入侧 artifact 阈值，否则结果侧闸门永远轮不到触发，
  // 「取消摘要」就会退化成「整页正文进上下文」。
  assert.ok(
    MAX_WEBFETCH_INLINE_BYTES < MAX_MODEL_INPUT_CHARS,
    `内联上限 ${MAX_WEBFETCH_INLINE_BYTES} 必须小于输入侧阈值 ${MAX_MODEL_INPUT_CHARS}`,
  );
});

test("落盘后的模型可见预览由共享信封决定，远小于落盘触发线", () => {
  // MAX_WEBFETCH_INLINE_BYTES 只是「是否落盘」的触发线；一旦落盘，模型看到多少由
  // result-persistence-format 的共享信封决定（与 resultBudget.preview 无关）。
  // 这条差异直接决定「一次抓取真正占多少上下文」，所以要钉住，而不是只钉触发线。
  const content = "x".repeat(64_858);
  const envelope = formatGenericPersistedOutputContent({
    content,
    originalBytes: Buffer.byteLength(content, "utf8"),
    persistedPath: "/tmp/artifact.txt",
  });

  assert.match(envelope, /^<persisted-output>/);
  assert.match(envelope, /Full output saved to: \/tmp\/artifact\.txt/);
  assert.match(envelope, /Output too large \(65 KB\)/);

  // 只取预览正文：剔除信封的尾部标记行（`...` 与闭合标签），它们不属于预览内容。
  const afterMarker = envelope.split("Preview (first 2 KB):\n")[1] ?? "";
  const preview = afterMarker
    .replace(/\n\.\.\.\n<\/persisted-output>$/, "")
    .replace(/\n<\/persisted-output>$/, "");
  assert.ok(preview.length > 0, "预览必须存在");
  assert.ok(
    preview.length <= 2_000,
    `预览必须被共享信封限制在 2000 字符内，实际 ${preview.length}`,
  );
  assert.ok(
    envelope.length < MAX_WEBFETCH_INLINE_BYTES / 2,
    `落盘后进上下文的信封应当远小于 ${MAX_WEBFETCH_INLINE_BYTES} 字节，实际 ${envelope.length}`,
  );
});

// -----------------------------------------------
// 接线不变量：摘要链路与剩余预算透传不许复活
// -----------------------------------------------

const CORE_SRC = new URL("../src/", import.meta.url);

function coreSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, CORE_SRC), "utf8");
}

test("加工阶段文件已删除", () => {
  assert.equal(existsSync(new URL("tool/handlers/webfetch-processing.ts", CORE_SRC)), false);
  assert.equal(
    existsSync(new URL("fork/webfetch-direct-passthrough/policy.ts", CORE_SRC)),
    false,
  );
  assert.equal(
    existsSync(new URL("fork/webfetch-direct-passthrough/remaining-tokens.ts", CORE_SRC)),
    false,
  );
});

test("WebFetch handler 不引用加工模型", () => {
  const source = coreSource("tool/handlers/webfetch.ts");
  assert.doesNotMatch(source, /processFetchedContent/);
  assert.doesNotMatch(source, /runWithModelInvocationContext/);
  assert.doesNotMatch(source, /web_fetch_processing/);
  // 正文必须来自抽取结果本身，不能又变成某个加工产物。
  assert.match(source, /result:\s*fetched\.content/);
});

test("重定向文案不再回显 prompt", () => {
  assert.doesNotMatch(coreSource("tool/handlers/webfetch.ts"), /-\s*prompt:/);
});

test("剩余上下文预算的透传已从工具链路移除", () => {
  // 这些字段与标记是 webfetch-direct-passthrough 为「判定是否跳过摘要」而加的；
  // 摘要没了，它们没有任何消费方，留一层就多一处「悄悄变回总结」的缝。
  for (const relativePath of [
    "tool/types.ts",
    "tool/executor/types.ts",
    "tool/executor/call-runner.ts",
    "tool/executor/batch-runner.ts",
    "runtime/types.ts",
    "runtime/methods/tools.ts",
    "runtime/methods/turn-tools.ts",
    "runtime/methods/turn-model-step.ts",
  ]) {
    const source = coreSource(relativePath);
    assert.doesNotMatch(source, /remainingContextTokens/, relativePath);
    assert.doesNotMatch(source, /webfetch-direct-passthrough/, relativePath);
  }
});
