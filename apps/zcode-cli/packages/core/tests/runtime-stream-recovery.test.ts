import { describe, expect, it } from "vitest";
import {
  ModelTransportKind,
  SessionEventType,
  createSessionId,
  createTraceId,
} from "@zcode/contracts";
import { createTestAgentRuntime } from "./test-agent-runtime.js";
import { createTestModelSelection } from "./test-model-selection.js";
import {
  createTestModelFactory,
  type TestModelExecutionObservation,
} from "./test-runtime-model.js";
import { createTestSessionEventStore } from "./test-event-store.js";

type ReasoningFailureKind = "idle-timeout" | "network-reset";

function createReasoningFailure(kind: ReasoningFailureKind): Error {
  const error = new Error(
    kind === "idle-timeout"
      ? "Model stream stalled: no event received before the idle timeout."
      : "Provider stream failed with ECONNRESET.",
  ) as Error & { code?: string; context?: Record<string, unknown> };
  error.code = kind === "idle-timeout" ? "model_request_timeout" : "model_network_error";
  error.context = {
    reason: kind === "idle-timeout" ? "stream_idle_timeout" : "network_error",
    retryable: true,
  };
  return error;
}

async function publishModelNetworkStatus(
  observation: TestModelExecutionObservation,
  event: Record<string, unknown>,
): Promise<void> {
  await observation.invocationContext?.statusSink?.publish({
    attempt: 1,
    maxAttempts: 1,
    providerId: String(observation.model.providerId),
    modelId: String(observation.model.modelId),
    requestId: event.requestId,
    timestamp: new Date().toISOString(),
    traceId:
      observation.invocationContext?.traceContext?.traceId ??
      createTraceId("reasoning-recovery-test"),
    transport: ModelTransportKind.Sse,
    ...event,
  });
}

describe("AgentRuntime reasoning-only stream recovery", () => {
  it.each<ReasoningFailureKind>(["idle-timeout", "network-reset"])(
    "recovers from a retryable %s after visible reasoning without text or tools",
    async (failureKind) => {
      const sessionId = createSessionId(`reasoning-only-recovery-${failureKind}`);
      const eventStore = createTestSessionEventStore();
      let modelCallCount = 0;
      let failedRequest: any;
      let recoveryRequest: any;
      let recoveryObservation: TestModelExecutionObservation | undefined;

      const runtime = createTestAgentRuntime(
        sessionId,
        {
          mode: "yolo",
          modelSelection: createTestModelSelection("test/reasoning-recovery"),
          modelStreaming: "on",
          outputStyle: { name: "Learning", prompt: "Explain tradeoffs while solving the task." },
        },
        {
          eventStore,
          modelFactory: createTestModelFactory({
            async generateText() {
              throw new Error("streaming path expected");
            },
            async *streamText(request: any, observation) {
              modelCallCount += 1;
              if (modelCallCount === 1) {
                failedRequest = request;
                await publishModelNetworkStatus(observation, {
                  requestId: `reasoning-${failureKind}-1`,
                  type: "model_request_started",
                });
                yield { type: "reasoning_start", id: "reasoning-failed" };
                yield {
                  type: "reasoning_delta",
                  id: "reasoning-failed",
                  text: "unfinished reasoning",
                };
                const error = createReasoningFailure(failureKind);
                await publishModelNetworkStatus(observation, {
                  message: error.message,
                  reason: error.context?.reason,
                  requestId: `reasoning-${failureKind}-1`,
                  retryable: true,
                  type: "model_request_failed",
                });
                throw error;
              }

              recoveryRequest = request;
              recoveryObservation = observation;
              await publishModelNetworkStatus(observation, {
                requestId: `reasoning-${failureKind}-2`,
                type: "model_request_started",
              });
              yield { type: "reasoning_start", id: "reasoning-recovered" };
              yield {
                type: "reasoning_delta",
                id: "reasoning-recovered",
                text: "fresh reasoning",
              };
              yield { type: "reasoning_end", id: "reasoning-recovered" };
              yield { type: "text_delta", text: "recovered answer" };
              yield {
                type: "finish",
                finishReason: "stop",
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              };
            },
          } as never),
        },
      );

      const result = await runtime.executeTurn("recover reasoning-only stream");
      const events = await eventStore.getEvents(sessionId);
      const discardedTail = events.find(
        (event) => event.type === SessionEventType.StreamRecoveryTailDiscarded,
      )?.payload as Record<string, unknown> | undefined;
      const reasoningAssistantIds = events
        .filter((event) => event.type === SessionEventType.ModelStreaming)
        .map((event) => event.payload as any)
        .filter((payload) => payload.kind === "reasoning_delta")
        .map((payload) => payload.assistantMessageId);

      expect(result.response).toBe("recovered answer");
      expect(modelCallCount).toBe(2);
      expect(recoveryObservation?.invocationContext?.streamIdleTimeoutRetryNumber).toBe(1);
      expect(
        recoveryRequest.messages.filter((message: any) => message.role === "assistant"),
      ).toEqual([]);
      expect(recoveryObservation?.invocationContext?.streamRecovery).toMatchObject({
        recoveredFromRequestId: `reasoning-${failureKind}-1`,
        retryNumber: 1,
        maxRetries: 20,
      });
      expect(discardedTail).toMatchObject({
        discardedReasoningBytes: new TextEncoder().encode("unfinished reasoning").byteLength,
        discardedTextBytes: 0,
        discardedToolCallIds: [],
      });
      expect(new Set(reasoningAssistantIds).size).toBe(2);
      // 重试发送同一份输入：恢复请求与失败请求相同，不多出 output_style。
      expect(recoveryRequest.messages).toEqual(failedRequest.messages);
      expect(
        JSON.stringify(recoveryRequest.messages).match(/Learning output style is active/g),
      ).toHaveLength(1);
    },
  );
});

// FORK-BEGIN(codex-collaboration)
it.each([false, true])(
  "recovers unrecognized API failure with prior output %s using one budget",
  async (withOutput) => {
    let calls = 0;
    const budgets = new Set();
    const runtime = createTestAgentRuntime(
      createSessionId(`unknown-recovery-${withOutput}`),
      {
        mode: "yolo",
        modelSelection: createTestModelSelection("test/unknown"),
        modelStreaming: "on",
      },
      {
        eventStore: createTestSessionEventStore(),
        modelFactory: createTestModelFactory({
          async *streamText(_request, observation) {
            calls += 1;
            const budget = observation.invocationContext?.modelRecoveryBudget;
            expect(budget).toBeDefined();
            budgets.add(budget);
            expect(budget?.claimAttempt()).toBe(calls);
            if (calls <= 20) {
              if (withOutput) yield { type: "text_delta", text: "discard this partial answer" };
              throw Object.assign(new Error("unrecognized provider failure"), {
                context: { retryable: true, source: "provider" },
              });
            }
            yield { type: "text_delta", text: "complete answer" };
            yield { type: "finish", finishReason: "stop", usage: {} };
          },
        }),
      },
    );
    const result = await runtime.executeTurn("recover all API failures");
    expect(result.response).toBe("complete answer");
    expect(calls).toBe(21);
    expect(budgets.size).toBe(1);
  },
);
// FORK-END(codex-collaboration)

// FORK-BEGIN(codex-collaboration)
it.each([
  "disconnect",
  "missing-finish",
  "budget-exhaustion",
  "default-budget-exhaustion",
  "tool-only-missing-finish",
  "context-overflow",
] as const)("recovers an actual SDK HTTP %s after partial text", async (failureKind) => {
  const { createServer } = await import("node:http");
  const { TestAiSdkModelAdapter, TestProviderConfigFixture } =
    await import("../../adapters/tests/test-provider-config.js");
  const { createTestModelProperties } = await import("../../adapters/tests/test-model-format.js");
  let requests = 0;
  let completedEffects = 0;
  let recoveringContext = false;
  const contextKinds: string[] = [];
  const requestBodies: string[] = [];
  const server = createServer(async (request, response) => {
    requests += 1;
    const ordinal = requests;
    let body = "";
    for await (const part of request) body += part.toString();
    requestBodies.push(body);
    const compact = body.includes("create a detailed summary");
    if (failureKind === "context-overflow" && recoveringContext) {
      contextKinds.push(compact ? "compact" : "normal");
      if (!compact && !contextKinds.includes("compact")) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: { code: "context_length_exceeded", message: "Maximum context length exceeded" },
          }),
        );
        return;
      }
    }
    if (failureKind.endsWith("budget-exhaustion")) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "fixture provider diagnostic" } }));
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (content: string | null, finish: string | null) =>
      `data: ${JSON.stringify({ id: "chat", object: "chat.completion.chunk", created: 1, model: "model", choices: [{ index: 0, delta: content === null ? {} : { content }, finish_reason: finish }] })}\n\n`;
    if (failureKind === "context-overflow") {
      response.end(
        chunk(
          compact ? "<summary>Preserve context recovery.</summary>" : "recovered complete answer",
          null,
        ) +
          chunk(null, "stop") +
          "data: [DONE]\n\n",
      );
    } else if (failureKind === "tool-only-missing-finish" && ordinal === 1) {
      response.write(
        `data: ${JSON.stringify({ id: "chat", object: "chat.completion.chunk", created: 1, model: "model", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "incomplete-write", type: "function", function: { name: "RecordEffect", arguments: "{}" } }] }, finish_reason: null }] })}\n\n`,
      );
      setTimeout(() => response.end(), 20);
    } else if (ordinal === 1) {
      response.write(chunk("discarded partial text", null));
      setTimeout(() => (failureKind === "disconnect" ? response.destroy() : response.end()), 20);
    } else {
      response.end(
        chunk("recovered complete answer", null) + chunk(null, "stop") + "data: [DONE]\n\n",
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected HTTP address");
  const adapter = new TestAiSdkModelAdapter({
    registry: new TestProviderConfigFixture({
      providers: {
        test: {
          kind: "openai-compatible",
          baseURL: `http://127.0.0.1:${address.port}/v1`,
          apiKey: "test",
        },
      },
    }),
    retry: {
      baseDelayMs: 0,
      maxDelayMs: 0,
      jitter: false,
      ...(failureKind === "budget-exhaustion" ? { maxAttempts: 2 } : {}),
    },
  });
  const { createToolRegistry } = await import("../src/tool/registry.js");
  const registry = createToolRegistry();
  registry.register({
    inputSchema: {},
    metadata: {
      name: "RecordEffect",
      concurrentSafe: false,
      destructive: false,
      needsApproval: false,
      readOnly: false,
      riskLevel: "low",
      sideEffectScope: "workspace",
    },
    handler: async () => {
      completedEffects += 1;
      return "effect executed";
    },
  });
  const runtime = createTestAgentRuntime(
    createSessionId(`http-recovery-${failureKind}`),
    {
      mode: "yolo",
      modelSelection: createTestModelSelection("test/model"),
      modelStreaming: "on",
      compact: { enabled: true },
    },
    {
      toolRegistry: registry,
      eventStore: createTestSessionEventStore(),
      modelFactory: () =>
        adapter.createModel({
          providerId: "test",
          modelId: "model",
          properties: createTestModelProperties(),
          options: { maxOutputTokens: 1000 },
        }),
    },
  );
  try {
    if (failureKind === "context-overflow") {
      await runtime.executeTurn("setup one");
      await runtime.executeTurn("setup two");
      requests = 0;
      requestBodies.length = 0;
      recoveringContext = true;
    }
    if (failureKind.endsWith("budget-exhaustion")) {
      await expect(runtime.executeTurn("recover HTTP stream")).rejects.toBeInstanceOf(Error);
      expect(requests).toBe(failureKind === "budget-exhaustion" ? 2 : 21);
      return;
    }
    const result = await runtime.executeTurn("recover HTTP stream");
    expect(result.response).toBe("recovered complete answer");
    expect(requests).toBe(failureKind === "context-overflow" ? 3 : 2);
    if (failureKind === "context-overflow")
      expect(contextKinds).toEqual(["normal", "compact", "normal"]);
    if (failureKind === "tool-only-missing-finish") expect(completedEffects).toBe(0);
    expect(requestBodies[1]).not.toContain("discarded partial text");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
// FORK-END(codex-collaboration)

// FORK-BEGIN(codex-collaboration)
it.each(["workspace", "system", "session"] as const)(
  "preserves a completed %s side effect across later stream recovery",
  async (sideEffectScope) => {
    const { createToolRegistry } = await import("../src/tool/registry.js");
    const registry = createToolRegistry();
    let executions = 0;
    registry.register({
      inputSchema: {},
      metadata: {
        concurrentSafe: false,
        destructive: false,
        name: "CompletedEffect",
        needsApproval: false,
        readOnly: false,
        riskLevel: "low",
        sideEffectScope,
      },
      handler: async () => {
        executions += 1;
        return "durable completed effect";
      },
    });
    let requests = 0;
    const budgets = [];
    let recoveredMessages = "";
    const runtime = createTestAgentRuntime(
      createSessionId(`completed-effect-${sideEffectScope}`),
      { mode: "yolo", modelStreaming: "on" },
      {
        toolRegistry: registry,
        eventStore: createTestSessionEventStore(),
        modelFactory: createTestModelFactory({
          async *streamText(request, observation) {
            requests += 1;
            const budget = observation.invocationContext?.modelRecoveryBudget;
            budget?.claimAttempt();
            budgets.push(budget);
            if (requests === 1) {
              yield {
                type: "tool_call",
                toolCall: { id: "completed-effect", name: "CompletedEffect", input: {} },
              };
              yield { type: "finish", finishReason: "tool-calls", usage: {} };
            } else if (requests === 2) {
              yield { type: "text_delta", text: "discarded failed text" };
              throw Object.assign(new Error("provider failed after completed effect"), {
                context: { source: "provider", retryable: true },
              });
            } else {
              recoveredMessages = JSON.stringify(request.messages);
              yield { type: "text_delta", text: "recovered after completed effect" };
              yield { type: "finish", finishReason: "stop", usage: {} };
            }
          },
        }),
      },
    );
    const result = await runtime.executeTurn("complete one effect then recover generation");
    expect(result.response).toBe("recovered after completed effect");
    expect(executions).toBe(1);
    expect(requests).toBe(3);
    expect(budgets[0]).not.toBe(budgets[1]);
    expect(budgets[1]).toBe(budgets[2]);
    expect(recoveredMessages).toContain("durable completed effect");
    expect(recoveredMessages).not.toContain("discarded failed text");
  },
);
// FORK-END(codex-collaboration)

// FORK-BEGIN(codex-collaboration)
it("keeps one budget through a nonempty context finish, compact and model retry", async () => {
  let recovering = false;
  let overflow = false;
  const budgets = [];
  const attempts: Array<number | undefined> = [];
  const runtime = createTestAgentRuntime(
    createSessionId("semantic-context-budget"),
    { mode: "yolo", modelStreaming: "off", compact: { enabled: true } },
    {
      eventStore: createTestSessionEventStore(),
      modelFactory: createTestModelFactory({
        async generateText(request, observation) {
          const budget = observation.invocationContext?.modelRecoveryBudget;
          if (recovering) {
            budget?.constrainMaxAttempts(3);
            attempts.push(budget?.claimAttempt());
            budgets.push(budget);
          }
          const compact = JSON.stringify(request.messages).includes("create a detailed summary");
          if (compact)
            return {
              text: "<summary>Preserve semantic overflow.</summary>",
              finishReason: "stop",
              usage: {},
            };
          if (recovering && !overflow) {
            overflow = true;
            return { text: "partial overflow answer", finishReason: "context_exceeded", usage: {} };
          }
          return { text: "complete answer", finishReason: "stop", usage: {} };
        },
      }),
    },
  );
  await runtime.executeTurn("warmup one");
  await runtime.executeTurn("warmup two");
  recovering = true;
  const result = await runtime.executeTurn("recover semantic overflow");
  expect(result.response).toBe("complete answer");
  expect(budgets).toHaveLength(3);
  expect(budgets.every((budget) => budget === budgets[0])).toBe(true);
  expect(budgets[0]?.attempts).toBe(3);
  expect(attempts).toEqual([1, 2, 3]);
});
// FORK-END(codex-collaboration)

it.each([
  { context: { localControl: "permission_denied", retryable: false } },
  { context: { localControl: "upstream_blocked", retryable: false } },
  { context: { localControl: "prepare_failed", retryable: false } },
  { context: { reason: "context_exceeded", retryable: true } },
  { type: "MODEL_CONTEXT_EXCEEDED", retryable: true },
  { context: { reason: "cancelled", retryable: false } },
])(
  "honors nested local and semantic control over an outer retryable wrapper: %j",
  async (inner) => {
    const { isRetryableStreamRecoveryFailure } =
      await import("../src/runtime/methods/streaming-recovery.js");
    const error = Object.assign(
      new Error("runtime wrapper", { cause: Object.assign(new Error("inner control"), inner) }),
      { retryable: true },
    );
    expect(isRetryableStreamRecoveryFailure(error)).toBe(false);
  },
);
