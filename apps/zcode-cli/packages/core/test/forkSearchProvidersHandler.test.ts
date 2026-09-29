import test from "node:test";
import assert from "node:assert/strict";
import { WebSearchInputSchema, WebSearchOutputSchema } from "@zcode/contracts";
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
