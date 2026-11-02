import { describe, expect, it } from "vitest";
import {
  HookEventName,
  READ_SESSION_CONTEXT_TOOL_NAME,
  SessionEventType,
  createSessionId,
  modelMessageContentToText,
  type ModelMessageContent,
} from "@zcode/contracts";
import { createTestAgentRuntime } from "./test-agent-runtime.js";
import { createInMemoryHookRunner } from "../src/hooks/index.js";
import { createTestSessionEventStore } from "./test-event-store.js";
import { createTestModelFactory } from "./test-runtime-model.js";

describe("AgentRuntime lifecycle hooks", () => {
  it("queues deferred input as TurnSteerQueued when no active turn is steerable", async () => {
    const sessionId = createSessionId("runtime-deferred-input");
    const eventStore = createTestSessionEventStore();
    const runtime = createTestAgentRuntime(sessionId, {}, { eventStore });

    const result = await runtime.enqueueDeferredInput({
      input: "验证期间追加",
      inputId: "cmd-deferred",
    });

    if (result.kind !== "queued") {
      throw new Error(`unexpected deferred input result: ${result.kind}`);
    }
    const events = await eventStore.getEvents(sessionId);
    const queued = events.find((event) => event.type === SessionEventType.TurnSteerQueued);
    expect(queued?.payload).toMatchObject({
      delivery: "queue",
      input: "验证期间追加",
      inputId: "cmd-deferred",
      pendingInputId: result.pendingInputId,
      targetTurnId: "deferred",
    });
  });

  it("accepts attachment-only deferred input and preserves canonical refs", async () => {
    const sessionId = createSessionId("runtime-deferred-attachment-only");
    const eventStore = createTestSessionEventStore();
    const runtime = createTestAgentRuntime(sessionId, {}, { eventStore });
    const attachmentRefs = [
      { ref: "artifact://note", fileName: "note.txt", mime: "text/plain", bytes: 9 },
    ];

    const result = await runtime.enqueueDeferredInput({
      input: "",
      inputId: "cmd-attachment-only",
      attachments: [
        {
          type: "file",
          content: "note body",
          path: "note.txt",
          filename: "note.txt",
          mimeType: "text/plain",
          sizeBytes: 9,
        },
      ],
      intent: {
        sourceCommandId: "cmd-attachment-only",
        clientId: "mobile-client",
        kind: "sendText",
        admissionSeq: 1,
        admittedAt: 1_234,
        requestedDelivery: "guide",
        admittedDelivery: "queue",
        attachmentRefs,
      },
    });

    expect(result.kind).toBe("queued");
    const queued = (await eventStore.getEvents(sessionId)).find(
      (event) => event.type === SessionEventType.TurnSteerQueued,
    );
    expect(queued?.payload).toMatchObject({
      input: "",
      inputId: "cmd-attachment-only",
      intent: { attachmentRefs },
    });
  });

  it("rejects deferred input only when both text and attachments are empty", async () => {
    const sessionId = createSessionId("runtime-deferred-empty-input");
    const eventStore = createTestSessionEventStore();
    const runtime = createTestAgentRuntime(sessionId, {}, { eventStore });

    const result = await runtime.enqueueDeferredInput({ input: "   ", attachments: [] });

    expect(result).toMatchObject({ kind: "rejected", reason: "empty_input" });
    const events = await eventStore.getEvents(sessionId);
    expect(events.some((event) => event.type === SessionEventType.TurnSteerQueued)).toBe(false);
  });

  it("injects SessionStart once and UserPromptSubmit context before model requests", async () => {
    const sessionId = createSessionId("runtime-hooks-context");
    const eventStore = createTestSessionEventStore();
    const hookEvents: string[] = [];
    const sessionStartModels: string[] = [];
    const capturedRequests: string[] = [];
    const hookRunner = createInMemoryHookRunner({
      hooks: [
        {
          event: HookEventName.SessionStart,
          callback: async (input) => {
            hookEvents.push(`${input.hookEventName}:${input.source}`);
            sessionStartModels.push(input.model);
            return {
              hookSpecificOutput: {
                additionalContext: "session-start-context",
                hookEventName: HookEventName.SessionStart,
              },
            };
          },
        },
        {
          event: HookEventName.UserPromptSubmit,
          callback: async (input) => {
            hookEvents.push(`${input.hookEventName}:${input.prompt}`);
            return {
              hookSpecificOutput: {
                additionalContext: `prompt-context:${input.prompt}`,
                hookEventName: HookEventName.UserPromptSubmit,
              },
            };
          },
        },
      ],
    });
    const runtime = createTestAgentRuntime(
      sessionId,
      {},
      {
        eventStore,
        hookRunner,
        modelFactory: createTestModelFactory({
          async generateText(request: { messages: Array<{ content: ModelMessageContent }> }) {
            capturedRequests.push(
              request.messages
                .map((message) => modelMessageContentToText(message.content))
                .join("\n"),
            );
            return modelTextResult("ok");
          },
        } as never),
      },
    );

    await runtime.executeTurn("first", undefined, {
      intent: {
        kind: "sendText",
        modelSelection: {
          providerId: "provider-b",
          modelId: "model-b",
          options: { reasoningLevel: "high" },
        },
        requestedDelivery: "start-now",
        sourceCommandId: "hook-model-switch",
      },
    });
    await runtime.executeTurn("second");

    expect(hookEvents).toEqual([
      "SessionStart:startup",
      "UserPromptSubmit:first",
      "UserPromptSubmit:second",
    ]);
    expect(sessionStartModels).toEqual(["provider-b/model-b"]);
    expect(capturedRequests[0]).toContain("session-start-context");
    expect(capturedRequests[0]).toContain("prompt-context:first");
    expect(capturedRequests[1]).toContain("prompt-context:second");
  });

  it("injects a ReadSessionContext reminder when the prompt mentions a session id", async () => {
    const sessionId = createSessionId("runtime-session-reference");
    const referencedSessionId = createSessionId("referenced-context");
    const eventStore = createTestSessionEventStore();
    const capturedRequests: string[] = [];
    const runtime = createTestAgentRuntime(
      sessionId,
      {},
      {
        eventStore,
        modelFactory: createTestModelFactory({
          async generateText(request: { messages: Array<{ content: ModelMessageContent }> }) {
            capturedRequests.push(
              request.messages
                .map((message) => modelMessageContentToText(message.content))
                .join("\n"),
            );
            return modelTextResult("ok");
          },
        } as never),
      },
    );

    await runtime.executeTurn(`continue from #${referencedSessionId}`);

    expect(capturedRequests[0]).toContain(READ_SESSION_CONTEXT_TOOL_NAME);
    expect(capturedRequests[0]).toContain(referencedSessionId);
  });

  it("blocks UserPromptSubmit before calling the model", async () => {
    const sessionId = createSessionId("runtime-hooks-block-prompt");
    const eventStore = createTestSessionEventStore();
    let modelCalled = false;
    const hookRunner = createInMemoryHookRunner({
      emitEvent: async (event) => {
        await eventStore.append(event);
      },
      hooks: [
        {
          event: HookEventName.UserPromptSubmit,
          callback: async () => ({
            continue: false,
            reason: "blocked by prompt hook",
            hookSpecificOutput: {
              hookEventName: HookEventName.UserPromptSubmit,
            },
          }),
        },
      ],
    });
    const runtime = createTestAgentRuntime(
      sessionId,
      {},
      {
        eventStore,
        hookRunner,
        modelFactory: createTestModelFactory({
          async generateText() {
            modelCalled = true;
            return modelTextResult("should not run");
          },
        } as never),
      },
    );

    const result = await runtime.executeTurn("blocked prompt");
    const events = await eventStore.getEvents(sessionId);

    expect(result.response).toBe("blocked by prompt hook");
    expect(modelCalled).toBe(false);
    expect(events.map((event) => event.type)).toContain(SessionEventType.HookRunBlocked);
    expect(events.map((event) => event.type)).not.toContain(SessionEventType.ModelRequest);
  });

  it("uses Stop hook feedback to continue the model loop", async () => {
    const sessionId = createSessionId("runtime-hooks-stop-continue");
    const eventStore = createTestSessionEventStore();
    let modelCallCount = 0;
    const capturedRequests: string[] = [];
    const hookRunner = createInMemoryHookRunner({
      hooks: [
        {
          event: HookEventName.Stop,
          callback: async () => {
            if (modelCallCount > 1) return undefined;
            return {
              decision: "block",
              reason: "revise with the stop hook feedback",
              systemMessage: "Ralph iteration 2",
            };
          },
        },
      ],
    });
    const runtime = createTestAgentRuntime(
      sessionId,
      {},
      {
        eventStore,
        hookRunner,
        modelFactory: createTestModelFactory({
          async generateText(request: { messages: Array<{ content: ModelMessageContent }> }) {
            modelCallCount++;
            capturedRequests.push(
              request.messages
                .map((message) => modelMessageContentToText(message.content))
                .join("\n"),
            );
            return modelTextResult(modelCallCount === 1 ? "draft answer" : "final answer");
          },
        } as never),
      },
    );

    const result = await runtime.executeTurn("write an answer");

    expect(result.response).toBe("final answer");
    expect(modelCallCount).toBe(2);
    expect(capturedRequests[1]).toContain("draft answer");
    expect(capturedRequests[1]).toContain("revise with the stop hook feedback");
  });

  it("caps consecutive Stop hook continuations at three", async () => {
    const sessionId = createSessionId("runtime-hooks-stop-cap");
    const eventStore = createTestSessionEventStore();
    let hookCallCount = 0;
    let modelCallCount = 0;
    const hookRunner = createInMemoryHookRunner({
      hooks: [
        {
          event: HookEventName.Stop,
          callback: async () => {
            hookCallCount++;
            return {
              decision: "block",
              reason: `stop feedback ${hookCallCount}`,
            };
          },
        },
      ],
    });
    const runtime = createTestAgentRuntime(
      sessionId,
      {},
      {
        eventStore,
        hookRunner,
        modelFactory: createTestModelFactory({
          async generateText() {
            modelCallCount++;
            return modelTextResult(`answer ${modelCallCount}`);
          },
        } as never),
      },
    );

    const result = await runtime.executeTurn("write an answer");

    expect(result.response).toBe("answer 4");
    expect(modelCallCount).toBe(4);
    expect(hookCallCount).toBe(4);
  });

  it("injects built-in session mailbox context when messaging is enabled", async () => {
    const sessionId = createSessionId("runtime-mailbox-hooks");
    const eventStore = createTestSessionEventStore();
    const capturedRequests: string[] = [];
    let drained = false;
    const runtime = createTestAgentRuntime(
      sessionId,
      {},
      {
        eventStore,
        sessionMailboxPort: {
          async drainUnread() {
            if (drained) return [];
            drained = true;
            return [
              {
                version: 1,
                messageId: "mail-1",
                fromSessionId: "source-session",
                toSessionId: sessionId,
                content: "please check the failing test",
                createdAt: new Date().toISOString(),
              },
            ];
          },
        },
        modelFactory: createTestModelFactory({
          async generateText(request: { messages: Array<{ content: ModelMessageContent }> }) {
            capturedRequests.push(
              request.messages
                .map((message) => modelMessageContentToText(message.content))
                .join("\n"),
            );
            return modelTextResult("ok");
          },
        } as never),
      },
    );

    await runtime.executeTurn("work");

    expect(capturedRequests[0]).toContain("<session-message");
    expect(capturedRequests[0]).toContain("mail-1");
    expect(capturedRequests[0]).toContain("please check the failing test");
    expect(runtime.getToolRegistry().has("send_message")).toBe(true);
    const sendMessageTool = runtime.getToolRegistry().get("send_message");
    if (!sendMessageTool) throw new Error("Expected send_message tool to be registered");
    const sendMessageInputProperties = (sendMessageTool.inputSchema as any).properties;
    expect(sendMessageInputProperties).toHaveProperty("target");
    expect(sendMessageInputProperties).toHaveProperty("message");
    expect(sendMessageInputProperties).not.toHaveProperty("sessionId");
    expect(sendMessageInputProperties).not.toHaveProperty("content");
  });

  it("queues post-tool session mailbox context as active-turn user input", async () => {
    const sessionId = createSessionId("runtime-mailbox-post-tool");
    const targetSessionId = createSessionId("runtime-mailbox-post-tool-target");
    const eventStore = createTestSessionEventStore();
    const capturedRequests: Array<Array<{ content: ModelMessageContent; role: string }>> = [];
    let drainCount = 0;
    let modelCallCount = 0;
    const runtime = createTestAgentRuntime(
      sessionId,
      {},
      {
        eventStore,
        sessionMailboxPort: {
          async drainUnread() {
            drainCount++;
            if (drainCount !== 2) return [];
            return [
              {
                version: 1,
                messageId: "mail-post-tool-1",
                fromSessionId: targetSessionId,
                toSessionId: sessionId,
                content: "成竹在胸，请你接 胸 字开头的成语。",
                createdAt: new Date().toISOString(),
              },
              {
                version: 1,
                messageId: "mail-post-tool-2",
                fromSessionId: targetSessionId,
                toSessionId: sessionId,
                content: "胸有成竹，请你接 竹 字开头的成语。",
                createdAt: new Date().toISOString(),
              },
            ];
          },
        },
        modelFactory: createTestModelFactory({
          async generateText(request: {
            messages: Array<{ content: ModelMessageContent; role: string }>;
          }) {
            modelCallCount++;
            capturedRequests.push(request.messages);
            if (modelCallCount === 1) {
              return {
                finishReason: "tool-calls",
                model: "test",
                providerMetadata: undefined,
                text: "",
                toolCalls: [
                  {
                    id: "send-message-call-1",
                    name: "list_agents",
                    input: {},
                  },
                ],
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              };
            }
            return modelTextResult("received mailbox boundary");
          },
        } as never),
      },
    );

    const result = await runtime.executeTurn("start idiom chain");
    const toolMessage = capturedRequests.flat().find((message) => message.role === "tool");
    const mailboxRequestText = capturedRequests
      .flat()
      .map((message) => modelMessageContentToText(message.content))
      .join("\n");
    const events = await eventStore.getEvents(sessionId);
    const eventTypes = events.map((event) => event.type);

    expect(result.response).toBe("received mailbox boundary");
    expect(modelCallCount).toBeGreaterThanOrEqual(2);
    expect(modelMessageContentToText(toolMessage?.content ?? "")).not.toContain("<session-message");
    expect(mailboxRequestText).toContain("mail-post-tool-1");
    expect(mailboxRequestText).toContain("成竹在胸，请你接 胸 字开头的成语。");
    expect(mailboxRequestText).toContain("mail-post-tool-2");
    expect(mailboxRequestText).toContain("胸有成竹，请你接 竹 字开头的成语。");
    expect(eventTypes).toContain(SessionEventType.TurnSteerQueued);
    expect(eventTypes).toContain(SessionEventType.TurnSteerDrained);
  });
});

function modelTextResult(text: string) {
  return {
    finishReason: "stop",
    model: "test",
    providerMetadata: undefined,
    text,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    },
  };
}
