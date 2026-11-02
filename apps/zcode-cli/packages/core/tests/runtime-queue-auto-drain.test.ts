import { describe, expect, it, vi } from "vitest";
import {
  completeExternalQueueDrain,
  drainPendingInput,
  hasInlineGuidePendingInput,
  // FORK(codex-collaboration): 覆盖队列原地转 guide 的异步所有权交接。
  guidePendingInputById,
} from "../src/runtime/methods/steering.js";

describe("guide 行内 drain 的外层 FIFO 门", () => {
  it("外层普通队列恢复期间阻止 guide 越过旧项，消费到空后恢复 tool-batch drain", () => {
    const activeTurn = {
      pendingInputs: [{ id: "new-running-input", commandKind: undefined, delivery: "guide" }],
    };
    const runtime = {
      activeTurn,
      pendingInputReservations: new Map<string, string>(),
      queueExternalDrainActive: true,
    };

    expect(hasInlineGuidePendingInput.call(runtime as never, activeTurn as never)).toBe(false);
    completeExternalQueueDrain.call(runtime as never);
    expect(hasInlineGuidePendingInput.call(runtime as never, activeTurn as never)).toBe(true);
  });

  it("普通 future queue 在前时仍允许后续 guide 走当前轮", () => {
    const activeTurn = {
      pendingInputs: [
        { id: "future-queue", commandKind: undefined, delivery: "queue" },
        { id: "current-guide", commandKind: undefined, delivery: "guide" },
      ],
    };
    const runtime = {
      activeTurn,
      pendingInputReservations: new Map<string, string>(),
      queueExternalDrainActive: false,
    };

    expect(hasInlineGuidePendingInput.call(runtime as never, activeTurn as never)).toBe(true);
  });

  it("行内 drain 只取最早 guide，并把普通 future queue 留在原位", async () => {
    const futureQueue = {
      id: "future-queue",
      input: "future work",
      queuedAt: new Date(0),
      delivery: "queue",
    };
    const currentGuide = {
      id: "current-guide",
      input: "guide current work",
      queuedAt: new Date(0),
      delivery: "guide",
    };
    const activeTurn = {
      pendingInputs: [futureQueue, currentGuide],
      turnId: "turn-current",
    };
    const appendedEvents: Array<{ payload: { pendingInputIds?: string[] } }> = [];
    const runtime = {
      activeTurn,
      appendEvent: vi.fn(async (event) => appendedEvents.push(event)),
      createEvent: vi.fn((_type, payload) => ({ payload })),
      messageHistory: { addEntries: vi.fn() },
      pendingInputReservations: new Map<string, string>(),
      persistUserPrompt: vi.fn(async () => undefined),
      sessionId: "session-current",
      workingDirectory: "/workspace",
    };

    await drainPendingInput.call(runtime as never, {
      activeTurn: activeTurn as never,
      events: [],
      traceContext: { traceId: "trace-current" } as never,
    });

    expect(activeTurn.pendingInputs).toEqual([futureQueue]);
    expect(runtime.messageHistory.addEntries).toHaveBeenCalledOnce();
    expect(JSON.stringify(runtime.messageHistory.addEntries.mock.calls[0])).toContain(
      "guide current work",
    );
    expect(JSON.stringify(runtime.messageHistory.addEntries.mock.calls[0])).not.toContain(
      "future work",
    );
    expect(appendedEvents).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ pendingInputIds: ["current-guide"] }),
      }),
    ]);
  });
});

// FORK-BEGIN(codex-collaboration)
describe("queued steer ownership", () => {
  function fixture() {
    const intent = {
      sourceCommandId: "source",
      queueItemId: "item",
      clientId: "mobile",
      kind: "sendText",
      text: "STEER",
      requestedDelivery: "queue",
      admittedDelivery: "queue",
      admissionSeq: 7,
      admittedAt: 123,
      modelSelection: { providerId: "fixture", modelId: "model" },
    };
    const held = {
      pendingInputId: "item",
      input: "STEER",
      queuedAt: new Date(123),
      traceId: "trace",
      targetTurnId: "old-turn",
      intent,
    };
    const activeTurn = {
      turnId: "current",
      steerable: true,
      pendingInputs: [],
      traceContext: { traceId: "trace" },
    };
    const runtime = {
      activeTurn: activeTurn as typeof activeTurn | undefined,
      sessionId: "session",
      pendingInputReservations: new Map([["item", "promotion"]]),
      rebuildProjection: vi.fn(async () => ({ pendingSteerInputs: [held] })),
      appendEvent: vi.fn(async (_event: unknown) => {}),
    };
    return { runtime, activeTurn, intent };
  }

  it("同一 reservation 重试仍只有一项，保留来源、模型和 admission 顺序", async () => {
    const { runtime, activeTurn, intent } = fixture();
    const options = { pendingInputId: "item", reservationId: "promotion" };
    expect(await guidePendingInputById.call(runtime as never, options)).toBe(true);
    expect(await guidePendingInputById.call(runtime as never, options)).toBe(true);
    expect(activeTurn.pendingInputs).toHaveLength(1);
    expect(activeTurn.pendingInputs[0]).toMatchObject({
      id: "item",
      queryId: "source",
      delivery: "guide",
      inputPresentation: "user_steer",
      intent: { ...intent, requestedDelivery: "guide", admittedDelivery: "guide" },
    });
  });

  it("持久化时轮次已结束：不向旧轮插入，原 ID 明确回落 queue", async () => {
    const { runtime, activeTurn } = fixture();
    const started = Promise.withResolvers<void>();
    const persisted = Promise.withResolvers<void>();
    runtime.appendEvent.mockImplementationOnce(async () => {
      started.resolve();
      await persisted.promise;
    });
    const pending = guidePendingInputById.call(runtime as never, {
      pendingInputId: "item",
      reservationId: "promotion",
    });
    await started.promise;
    runtime.activeTurn = undefined;
    persisted.resolve();
    expect(await pending).toBe(true);
    expect(activeTurn.pendingInputs).toEqual([]);
    expect(runtime.appendEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          pendingInputId: "item",
          requestedDelivery: "guide",
          admittedDelivery: "queue",
          fallbackReasonCode: "guide.noToolBoundary",
        }),
      }),
      expect.any(Object),
    );
  });

  it("另一 reservation 不能改写已接受的输入", async () => {
    const { runtime, activeTurn } = fixture();
    expect(
      await guidePendingInputById.call(runtime as never, {
        pendingInputId: "item",
        reservationId: "other-client",
      }),
    ).toBe(false);
    expect(runtime.appendEvent).not.toHaveBeenCalled();
    expect(activeTurn.pendingInputs).toEqual([]);
  });
});
// FORK-END(codex-collaboration)
