import assert from "node:assert/strict";
import test from "node:test";

import type { Model, ModelRequest, ModelStreamEvent } from "@zcode/contracts";

import {
  aggregateStreamToResult,
  withNonStreamingViaStream,
} from "../src/fork/nonstream-via-stream/model.js";

/**
 * 契约：非流式结果 == 流式的最终态。切换通道不能引入第二套事实，
 * 也不能因为流式才有的切分事件（text_start/end、tool_input_*、compact boundary）改变结果。
 */

async function* streamOf(events: ModelStreamEvent[]): AsyncIterable<ModelStreamEvent> {
  for (const event of events) {
    yield event;
  }
}

const USAGE = { total: 12, input: 5, output: 7, reasoning: 0, cache: { read: 0, write: 0 } };

test("文本、finish、usage、providerMetadata 汇总成一次性结果", async () => {
  const result = await aggregateStreamToResult(
    streamOf([
      { type: "start" },
      { type: "text_start", id: "t1" },
      { type: "text_delta", id: "t1", text: "hel" },
      { type: "text_delta", id: "t1", text: "lo" },
      { type: "text_end", id: "t1" },
      {
        type: "finish",
        finishReason: "stop",
        providerMetadata: { anthropic: { stopSequence: null } },
        usage: USAGE,
      },
    ]),
  );

  assert.equal(result.text, "hello");
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(result.usage, USAGE);
  assert.deepEqual(result.providerMetadata, { anthropic: { stopSequence: null } });
  // 没有 reasoning / toolCalls 时不能凭空造出空数组，否则调用方会拿到「有值但为空」的第二套事实。
  assert.equal(result.reasoning, undefined);
  assert.equal(result.toolCalls, undefined);
});

test("只有 delta 没有 start 时，无 id 的 delta 归并到同一块", async () => {
  const result = await aggregateStreamToResult(
    streamOf([
      { type: "reasoning_delta", text: "想" },
      { type: "reasoning_delta", text: "一下" },
      { type: "finish", finishReason: "stop", usage: USAGE },
    ]),
  );

  assert.equal(result.reasoning?.length, 1);
  assert.equal(result.reasoning?.[0]?.text, "想一下");
});

test("reasoning 块按 id 分桶，end 时带回 providerMetadata", async () => {
  // 与流式路径同一套归并规则：id 是分桶键，无 id 的 delta 落在默认桶。
  // 这条断言把分桶规则钉住，避免以后「顺手」把不同 id 的思考合并成一块。
  const result = await aggregateStreamToResult(
    streamOf([
      { type: "reasoning_delta", text: "无 id 的一段" },
      { type: "reasoning_start", id: "r1" },
      { type: "reasoning_delta", id: "r1", text: "带 id 的一段" },
      { type: "reasoning_end", id: "r1", providerMetadata: { signature: "sig" } },
      { type: "finish", finishReason: "stop", usage: USAGE },
    ]),
  );

  assert.equal(result.reasoning?.length, 2);
  assert.equal(result.reasoning?.[0]?.text, "无 id 的一段");
  assert.equal(result.reasoning?.[1]?.text, "带 id 的一段");
  assert.deepEqual(result.reasoning?.[1]?.providerOptions, { signature: "sig" });
});

test("error 事件按流式错误语义抛出，provider code 不丢", async () => {
  // normalizeStreamError 会把 provider 业务错误归一成 CoreError，真实 code 落在 context.providerCode。
  // 断言这一点是因为：丢掉它，UI 就无法命中 provider 的业务错误文案（例如 3007）。
  await assert.rejects(
    () => aggregateStreamToResult(streamOf([{ type: "error", error: { code: 3007, message: "provider rejected" } }])),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const withContext = error as Error & { context?: { providerCode?: unknown } };
      // 归一层会把 provider code 字符串化，这里按实际契约断言（写成数字会误报）。
      assert.equal(withContext.context?.providerCode, "3007");
      return true;
    },
  );
});

test("同 id 的工具调用重复投递只保留一次", async () => {
  const toolCall = { id: "call_1", name: "Read", input: { file_path: "a.ts" } };
  const result = await aggregateStreamToResult(
    streamOf([
      { type: "tool_input_start", id: "call_1", toolName: "Read" },
      { type: "tool_input_delta", id: "call_1", delta: '{"file_path"' },
      { type: "tool_input_end", id: "call_1" },
      { type: "tool_call", toolCall },
      { type: "tool_call", toolCall },
      { type: "finish", finishReason: "tool-calls", usage: USAGE },
    ]),
  );

  assert.equal(result.toolCalls?.length, 1);
  assert.deepEqual(result.toolCalls?.[0], toolCall);
  // tool_input_* 只是流式切分，不参与结果。
  assert.equal(result.text, "");
});

function createFakeModel(events: ModelStreamEvent[], record: ModelRequest[]): Model {
  return {
    providerId: "probe-provider" as Model["providerId"],
    modelId: "probe-model" as Model["modelId"],
    properties: {} as Model["properties"],
    optionSpecs: {} as Model["optionSpecs"],
    options: {},
    bind: () => createFakeModel(events, record),
    generateText: async () => {
      throw new Error("非流式通道不应被调用");
    },
    streamText: (request) => {
      record.push(request);
      return streamOf(events);
    },
  };
}

test("generateText 走流式通道，streamText 原样透传", async () => {
  const requests: ModelRequest[] = [];
  const base = createFakeModel(
    [
      { type: "text_delta", text: "ok" },
      { type: "finish", finishReason: "stop", usage: USAGE },
    ],
    requests,
  );
  const adapted = withNonStreamingViaStream(base);
  const request: ModelRequest = { messages: [{ role: "user", content: "hi" }] };

  const result = await adapted.generateText(request);
  assert.equal(result.text, "ok");
  assert.equal(result.finishReason, "stop");
  // 请求必须原样转发给底层流式方法，不能丢字段。
  assert.deepEqual(requests, [request]);

  const streamed: ModelStreamEvent[] = [];
  for await (const event of adapted.streamText(request)) {
    streamed.push(event);
  }
  assert.equal(streamed.length, 2);
  assert.equal(requests.length, 2);

  // 标识与选项必须透传，否则调用方按 modelId 记录的用量会错位。
  assert.equal(adapted.providerId, base.providerId);
  assert.equal(adapted.modelId, base.modelId);
});

test("bind() 之后仍然是非流式走流式", async () => {
  const requests: ModelRequest[] = [];
  const adapted = withNonStreamingViaStream(createFakeModel([], requests)).bind({
    maxOutputTokens: 128,
  });

  await adapted.generateText({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(requests.length, 1);
});
