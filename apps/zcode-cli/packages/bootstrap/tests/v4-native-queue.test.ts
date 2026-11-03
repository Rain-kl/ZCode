// L2：v4 原生 queue 命令组（deleteQueueItem / editQueueItem / reorderQueueItem /
// setAutoDrain / setFollowupMode / sendQueuedNow）——验证命令直驱 core app 层 API，
// FORK(codex-collaboration): sendQueuedNow 保留原输入身份，转 guide 或 idle-only 提升。
// fake 风格参照 tests/v4-native-commands.test.ts（fake host/app，不经旧协议代码）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionEventType, type SessionEvent } from "@zcode/contracts";
import type { CommandEnvelope, QueueItem } from "@zcode/shared/zcode-protocol-v4";
import { V4CommandExecutor } from "../src/zcode-protocol-v4/commands/executor.js";
import {
  V4QueueItemTextUnavailableError,
  V4QueueItemReservedError,
  V4QueueItemNotEditableError,
  V4QueuePromotionLeaseUnavailableError,
} from "../src/zcode-protocol-v4/commands/handlers/queue.js";
import { V4CommandNoopError } from "../src/zcode-protocol-v4/index.js";
import { shouldAutoDrainV4QueueHead } from "../src/zcode-protocol-v4/queue-auto-drain.js";
import type {
  V4CommandCoreHost,
  V4SessionRecordView,
} from "../src/zcode-protocol-v4/commands/types.js";

function makeApp(overrides: Record<string, unknown> = {}) {
  const runtimeOverrides = (overrides.runtime ?? {}) as Record<string, unknown>;
  const appOverrides = { ...overrides };
  delete appOverrides.runtime;
  let foregroundPromotionLeaseId: string | undefined;
  return {
    sessionId: "s1",
    sendInput: vi.fn().mockImplementation(async (_input, options) => {
      options?.onTurnStartedObserved?.({
        id: "event-queue-turn-started",
        type: SessionEventType.TurnStarted,
        payload: { messageId: "msg-event-queue-turn-started" },
      });
      return {
        completion: Promise.resolve({}),
        kind: "started_turn",
        turnId: "turn-1",
      };
    }),
    submitPrompt: vi.fn().mockResolvedValue({}),
    steerTurn: vi.fn().mockResolvedValue({}),
    readTarget: vi.fn().mockResolvedValue(null),
    getMode: vi.fn().mockReturnValue("plan"),
    setTarget: vi.fn().mockImplementation(async (input: { objective: string }) => ({
      targetID: "g1",
      objective: input.objective,
      status: "active",
    })),
    continueActiveTarget: vi.fn().mockResolvedValue(null),
    updateTargetStatus: vi.fn().mockResolvedValue(null),
    reserveQueueItem: vi.fn().mockResolvedValue(true),
    markQueueItemPromoting: vi.fn().mockResolvedValue(true),
    // FORK(codex-collaboration): 普通队列项在 Core 内转 guide，不能靠停止当前轮提升。
    guideQueueItem: vi.fn().mockResolvedValue(false),
    releaseQueueItemReservation: vi.fn().mockResolvedValue(true),
    removeQueueItem: vi.fn().mockResolvedValue(true),
    editQueueItem: vi.fn().mockResolvedValue(true),
    reorderQueueItem: vi.fn().mockResolvedValue(true),
    setQueueAutoDrain: vi.fn().mockResolvedValue(undefined),
    setFollowupMode: vi.fn().mockResolvedValue(undefined),
    runtime: {
      acquireForegroundPromotionLease: vi.fn().mockImplementation(({ leaseId }) => {
        if (foregroundPromotionLeaseId && foregroundPromotionLeaseId !== leaseId) {
          return { kind: "conflict", leaseId: foregroundPromotionLeaseId };
        }
        foregroundPromotionLeaseId = leaseId;
        return { kind: "acquired", leaseId };
      }),
      getActiveForegroundExecutionId: vi.fn(() => undefined),
      releaseForegroundPromotionLease: vi.fn().mockImplementation((leaseId) => {
        if (foregroundPromotionLeaseId !== leaseId) return false;
        foregroundPromotionLeaseId = undefined;
        return true;
      }),
      stopActiveForegroundExecution: vi.fn().mockReturnValue({ kind: "idle" }),
      ...runtimeOverrides,
    },
    ...appOverrides,
  };
}

// FORK-BEGIN(codex-collaboration)
describe("排队消息 steer 安全边界", () => {
  it("同一 reservation 原地转 guide，保留原项等待真正 drain", async () => {
    const controller = new AbortController();
    const guideQueueItem = vi.fn().mockResolvedValue(true);
    const app = makeApp({ guideQueueItem });
    const record = makeRecord({ app, activeAbortController: controller });
    controller.signal.addEventListener("abort", () => {
      record.activeAbortController = undefined;
    });
    await new V4CommandExecutor(
      makeHost(record, {
        getQueueItem: () => queueItem({ attachments: [] }),
      }),
    ).execute(envelope("sendQueuedNow", { queueItemId: "q-1" }));
    expect(guideQueueItem).toHaveBeenCalledWith("q-1", "cmd-q1", expect.any(Object));
    expect(controller.signal.aborted).toBe(false);
    expect(app.runtime.stopActiveForegroundExecution).not.toHaveBeenCalled();
    expect(app.sendInput).not.toHaveBeenCalled();
    expect(app.removeQueueItem).not.toHaveBeenCalled();
    expect(app.releaseQueueItemReservation).toHaveBeenCalledOnce();
  });
});
// FORK-END(codex-collaboration)

/**
 * 加速轮的协议原形：Selection 指向隐藏的加速卡内建 Provider（端点/能力来自 Provider Config），
 * 只有卡 JWT 与卡 ID 作为本次执行的动态鉴权随 modelExecution 下发。
 */
const ORDINARY_MODEL_SELECTION = {
  providerId: "builtin:bigmodel-coding-plan",
  modelId: "GLM-5.3",
};

const HIGHSPEED_MODEL_SELECTION = {
  providerId: "account:bigmodel-highspeed-card",
  modelId: "GLM-5.3",
};

const HIGHSPEED_MODEL_EXECUTION = {
  selectionScope: "execution" as const,
  requestAuth: {
    apiKey: "card-1-jwt",
    headers: { Authorization: "Bearer card-1-jwt", "X-Highspeed-Card-ID": "card-1" },
  },
  selectionFallback: {
    providerId: "account:bigmodel-highspeed-card",
    target: ORDINARY_MODEL_SELECTION,
    rules: [
      { reason: "highspeed_card_expired" as const, providerErrorCode: "3402" },
      { reason: "highspeed_request_failed" as const },
    ],
  },
};

const HIGHSPEED_QUEUED_EXECUTION = {
  modelSelection: HIGHSPEED_MODEL_SELECTION,
  modelExecution: HIGHSPEED_MODEL_EXECUTION,
};

function queueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    sourceCommandId: "source-command-q1",
    queueItemId: "q-1",
    clientId: "mobile-client",
    kind: "sendText",
    text: "排队原文",
    modelSelection: {
      providerId: "provider-at-submit",
      modelId: "model-at-submit",
      options: { reasoningLevel: "high" },
    },
    mode: "plan",
    attachments: [{ ref: "/tmp/note.txt", fileName: "note.txt", mime: "text/plain", bytes: 9 }],
    delivery: { requested: "queue", admitted: "queue" },
    order: { admissionSeq: 7, queuePosition: 0 },
    steer: { state: "notRequested" },
    dispatch: { state: "queued" },
    admittedAt: 1234,
    ...overrides,
  };
}

function makeRecord(
  overrides: Partial<V4SessionRecordView> & { app?: ReturnType<typeof makeApp> } = {},
): V4SessionRecordView {
  return {
    app: (overrides.app ?? makeApp()) as unknown as V4SessionRecordView["app"],
    workspace: { workspacePath: "/w" },
    persistence: "immediate",
    ...overrides,
  } as V4SessionRecordView;
}

function makeHost(
  record: V4SessionRecordView,
  hostOverrides: Partial<V4CommandCoreHost> = {},
): V4CommandCoreHost & { legacyMutations: string[] } {
  const legacyMutations: string[] = [];
  return {
    getRecord: (id) => (id === "s1" ? record : undefined),
    afterLegacyStateMutation: async (_r, reason) => {
      legacyMutations.push(reason);
    },
    waitForProjectionEventCommit: async () => {},
    // 默认查得到完整权威 intent（sendQueuedNow 正路径）；各用例按需覆盖。
    getQueueItem: vi.fn().mockReturnValue(queueItem()),
    ...hostOverrides,
    legacyMutations,
  };
}

function envelope(type: string, payload: unknown): CommandEnvelope {
  return {
    type,
    payload,
    sessionId: "s1",
    commandId: "cmd-q1",
    baseRevision: 0,
  } as unknown as CommandEnvelope;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function flushDetachedWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function workspaceHookReviewRequestedEvent(input: {
  id: string;
  interactionId: string;
}): SessionEvent {
  return {
    id: input.id,
    type: SessionEventType.WorkspaceHookReviewRequested,
    payload: {
      request: {
        kind: "workspaceHookReview",
        reviewFlowId: "review-flow-queue",
        generation: 1,
        interactionId: input.interactionId,
        sessionId: "s1",
        taskId: "task-queue",
        runId: "run-queue",
        workspaceIdentity: "/w",
        workspaceLabel: "w",
        bundleDigest: "a".repeat(64),
        createdAt: Date.now(),
        deadlineAt: Date.now() + 10 * 60_000,
        sourceFiles: [
          {
            path: "/w/.zcode/config.json",
            displayPath: ".zcode/config.json",
            editable: true,
          },
        ],
        summary: { eventCount: 1, hookCount: 1, pendingCount: 1 },
        items: [
          {
            reviewItemId: "review-item-queue",
            event: "PreToolUse",
            matcher: "*",
            type: "process",
            displayName: "echo hello",
            displayCommand: "echo hello",
            sourcePath: "/w/.zcode/config.json",
            resolvedTimeoutMs: 1_000,
            resolvedMaxOutputBytes: 1_024,
            executionMode: "foreground",
            configuredEnabled: true,
            editable: true,
            trustState: "pending_trust",
          },
        ],
        warningCode: "workspace_hooks_execute_code",
      },
    },
  } as unknown as SessionEvent;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("v4 原生 queue 单项命令", () => {
  it("deleteQueueItem：直驱 app.removeQueueItem（queueItemId ≡ pendingInputId）", async () => {
    const app = makeApp();
    const record = makeRecord({ app });
    await new V4CommandExecutor(makeHost(record)).execute(
      envelope("deleteQueueItem", { queueItemId: "q-1" }),
    );
    expect(app.removeQueueItem).toHaveBeenCalledWith("q-1");
  });

  it("editQueueItem：直驱 app.editQueueItem（保位原地更新）", async () => {
    const app = makeApp();
    const record = makeRecord({ app });
    await new V4CommandExecutor(makeHost(record)).execute(
      envelope("editQueueItem", { queueItemId: "q-1", newText: "改后文本" }),
    );
    expect(app.editQueueItem).toHaveBeenCalledWith("q-1", "改后文本");
  });

  // FORK(reload-command): refresh 与 compact 同为不可编辑维护意图。
  it.each(["compact", "refresh"] as const)("editQueueItem：typed %s 不可编辑，避免 kind 与可见文本分裂", async (kind) => {
    const app = makeApp();
    const record = makeRecord({ app });
    const host = makeHost(record, {
      getQueueItem: vi
        .fn()
        .mockReturnValue(queueItem({ kind, text: `/${kind}`, attachments: [] })),
    });
    await expect(
      new V4CommandExecutor(host).execute(
        envelope("editQueueItem", { queueItemId: "q-1", newText: "伪装文本" }),
      ),
    ).rejects.toBeInstanceOf(V4QueueItemNotEditableError);
    expect(app.editQueueItem).not.toHaveBeenCalled();
  });

  it("reorderQueueItem：beforeQueueItemId 直传（null=队尾）", async () => {
    const app = makeApp();
    const record = makeRecord({ app });
    const executor = new V4CommandExecutor(makeHost(record));
    await executor.execute(
      envelope("reorderQueueItem", { queueItemId: "q-2", beforeQueueItemId: "q-1" }),
    );
    expect(app.reorderQueueItem).toHaveBeenCalledWith("q-2", "q-1");
    await executor.execute(
      envelope("reorderQueueItem", { queueItemId: "q-2", beforeQueueItemId: null }),
    );
    expect(app.reorderQueueItem).toHaveBeenLastCalledWith("q-2", null);
  });

  it("setAutoDrain：直驱 app.setQueueAutoDrain", async () => {
    const app = makeApp();
    const record = makeRecord({ app });
    const host = makeHost(record);
    await new V4CommandExecutor(host).execute(envelope("setAutoDrain", { autoDrain: true }));
    expect(app.setQueueAutoDrain).toHaveBeenCalledWith(true);
    expect(host.legacyMutations).toEqual(["queue_auto_drain_resumed"]);
  });

  it("setFollowupMode：直驱 app.setFollowupMode", async () => {
    const app = makeApp();
    const record = makeRecord({ app });
    await new V4CommandExecutor(makeHost(record)).execute(
      envelope("setFollowupMode", { mode: "guide" }),
    );
    expect(app.setFollowupMode).toHaveBeenCalledWith("guide");
  });

  it("delete 未命中抛可判别 noop，避免把已消费旧投影恢复到 composer", async () => {
    const app = makeApp({ removeQueueItem: vi.fn().mockResolvedValue(false) });
    const record = makeRecord({ app });
    const warn = vi.fn();
    await expect(
      new V4CommandExecutor(makeHost(record, { logger: { warn } })).execute(
        envelope("deleteQueueItem", { queueItemId: "q-gone" }),
      ),
    ).rejects.toMatchObject({
      reasonCode: "queue.itemMissing",
    } satisfies Partial<V4CommandNoopError>);
    expect(warn).toHaveBeenCalled();
  });
});

describe("v4 普通 queue 自动消费 goal gate", () => {
  it.each(["active", "paused", "budget_limited"] as const)(
    "target=%s 时即使 session ready 也不自动消费",
    (targetStatus) => {
      expect(
        shouldAutoDrainV4QueueHead({
          autoDrain: true,
          dispatchState: "queued",
          sessionBusy: false,
          targetStatus,
        }),
      ).toBe(false);
    },
  );

  it.each([null, "complete"] as const)(
    "target=%s 时保留既有 ready 自动消费语义",
    (targetStatus) => {
      expect(
        shouldAutoDrainV4QueueHead({
          autoDrain: true,
          dispatchState: "queued",
          sessionBusy: false,
          targetStatus,
        }),
      ).toBe(true);
    },
  );
});

describe("v4 原生 sendQueuedNow", () => {
  it("Highspeed queue 在卡仍有效时于提升边界应用单轮执行材料", async () => {
    const app = makeApp();
    const record = makeRecord({ app });
    const deleteQueuedTurnExecution = vi.fn();
    const host = makeHost(record, {
      getQueueItem: vi.fn().mockReturnValue(
        queueItem({
          // 队列持久化普通提交模型；临时 Highspeed Selection 与凭据只在 CLI 内存暂存。
          modelSelection: ORDINARY_MODEL_SELECTION,
          highspeed: {
            schemaVersion: 1,
            cardId: "card-1",
            taskId: "s1",
            provider: "bigmodel",
            model: "GLM-5.3",
            issuedAt: 1,
            expiresAt: Date.now() + 60_000,
          },
        }),
      ),
      readQueuedTurnExecution: vi.fn().mockReturnValue(HIGHSPEED_QUEUED_EXECUTION),
      deleteQueuedTurnExecution,
    });

    await new V4CommandExecutor(host).execute(envelope("sendQueuedNow", { queueItemId: "q-1" }));

    expect(host.readQueuedTurnExecution).toHaveBeenCalledWith("s1", "source-command-q1");
    expect(app.sendInput).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        intent: expect.objectContaining({
          highspeed: expect.objectContaining({ cardId: "card-1" }),
          modelSelection: HIGHSPEED_MODEL_SELECTION,
        }),
      }),
    );
    const sendOptions = app.sendInput.mock.calls[0]?.[1];
    // selectionScope=execution 表达「只作用于本轮」：不再需要提升后回写/恢复会话模型。
    expect(sendOptions.modelExecution.selectionScope).toBe("execution");
    await expect(
      sendOptions.modelExecution.requestDependencies.requestAuth.source.resolve(),
    ).resolves.toEqual(HIGHSPEED_MODEL_EXECUTION.requestAuth);
    expect(sendOptions.modelExecution.selectionFallback?.target).toEqual(ORDINARY_MODEL_SELECTION);
    // 凭据已冻结进本轮，暂存副本立即销毁，避免同一张卡被后续队列项复用。
    expect(deleteQueuedTurnExecution).toHaveBeenCalledWith("s1", "source-command-q1");
  });

  it("手动提升会使用命令补充的同卡执行材料，避免 CLI 暂存状态缺失后误降级", async () => {
    const app = makeApp();
    const record = makeRecord({ app });
    const highspeedMeta = {
      schemaVersion: 1 as const,
      cardId: "card-1",
      taskId: "s1",
      provider: "bigmodel",
      model: "GLM-5.3",
      issuedAt: 1,
      expiresAt: Date.now() + 60_000,
    };
    const refreshedExecution = {
      ...HIGHSPEED_MODEL_EXECUTION,
      requestAuth: {
        apiKey: "card-1-refreshed-jwt",
        headers: { Authorization: "Bearer card-1-refreshed-jwt", "X-Highspeed-Card-ID": "card-1" },
      },
    };
    const host = makeHost(record, {
      getQueueItem: vi
        .fn()
        .mockReturnValue(
          queueItem({ highspeed: highspeedMeta, modelSelection: ORDINARY_MODEL_SELECTION }),
        ),
      readQueuedTurnExecution: vi.fn().mockReturnValue(undefined),
    });

    await new V4CommandExecutor(host).execute(
      envelope("sendQueuedNow", {
        queueItemId: "q-1",
        highspeedMeta,
        modelSelection: HIGHSPEED_MODEL_SELECTION,
        modelExecution: refreshedExecution,
      }),
    );

    expect(app.sendInput).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        intent: expect.objectContaining({
          highspeed: highspeedMeta,
          modelSelection: HIGHSPEED_MODEL_SELECTION,
        }),
      }),
    );
    // 补供材料优先于内存暂存：这里 CLI 暂存为空，必须用命令带来的新 JWT 才不会降级。
    const sendOptions = app.sendInput.mock.calls[0]?.[1];
    await expect(
      sendOptions.modelExecution.requestDependencies.requestAuth.source.resolve(),
    ).resolves.toEqual(refreshedExecution.requestAuth);
  });

  it("Highspeed queue 提升时卡已过期则去掉加速标记并使用队列项普通模型", async () => {
    const sessionSelection = {
      providerId: "builtin:bigmodel-team-coding-plan",
      modelId: "GLM-5.3",
    };
    const app = makeApp({
      runtime: { getSessionModelSelection: vi.fn().mockReturnValue(sessionSelection) },
    });
    const record = makeRecord({ app });
    const deleteQueuedTurnExecution = vi.fn();
    const host = makeHost(record, {
      getQueueItem: vi.fn().mockReturnValue(
        queueItem({
          modelSelection: ORDINARY_MODEL_SELECTION,
          highspeed: {
            schemaVersion: 1,
            cardId: "expired-card",
            taskId: "s1",
            provider: "bigmodel",
            model: "GLM-5.3",
            issuedAt: 1,
            expiresAt: Date.now() - 1,
          },
        }),
      ),
      readQueuedTurnExecution: vi.fn().mockReturnValue(HIGHSPEED_QUEUED_EXECUTION),
      deleteQueuedTurnExecution,
    });

    await new V4CommandExecutor(host).execute(envelope("sendQueuedNow", { queueItemId: "q-1" }));

    const sendOptions = app.sendInput.mock.calls[0]?.[1];
    expect(sendOptions?.modelExecution).toBeUndefined();
    expect(sendOptions?.intent?.highspeed).toBeUndefined();
    // 队列项是发送时快照；降级不得回看之后可能已变化的 Session 模型。
    expect(sendOptions?.intent?.modelSelection).toEqual(ORDINARY_MODEL_SELECTION);
    expect(sendOptions?.intent?.modelSelection).not.toEqual(sessionSelection);
    expect(deleteQueuedTurnExecution).toHaveBeenCalledWith("s1", "source-command-q1");
  });

  it("旧队列把 Highspeed Provider 持久化且 execution 缺失时迁移回会话普通模型", async () => {
    const sessionSelection = {
      providerId: "builtin:bigmodel-team-coding-plan",
      modelId: "GLM-5.3",
    };
    const app = makeApp({
      runtime: { getSessionModelSelection: vi.fn().mockReturnValue(sessionSelection) },
    });
    const record = makeRecord({ app });
    const host = makeHost(record, {
      getQueueItem: vi.fn().mockReturnValue(
        queueItem({
          modelSelection: HIGHSPEED_MODEL_SELECTION,
          highspeed: {
            schemaVersion: 1,
            cardId: "legacy-card",
            taskId: "s1",
            provider: "bigmodel",
            model: "GLM-5.3",
            issuedAt: 1,
            expiresAt: Date.now() + 60_000,
          },
        }),
      ),
      readQueuedTurnExecution: vi.fn().mockReturnValue(undefined),
    });

    await new V4CommandExecutor(host).execute(envelope("sendQueuedNow", { queueItemId: "q-1" }));

    const sendOptions = app.sendInput.mock.calls[0]?.[1];
    expect(sendOptions?.modelExecution).toBeUndefined();
    expect(sendOptions?.intent?.highspeed).toBeUndefined();
    expect(sendOptions?.intent?.modelSelection).toEqual(sessionSelection);
    expect(sendOptions?.intent?.modelSelection).not.toEqual(HIGHSPEED_MODEL_SELECTION);
  });

  it("promotes quote-only input with its original sender metadata", async () => {
    const app = makeApp();
    const record = makeRecord({ app });
    const host = makeHost(record);
    const conversationQuotes = [{ text: "original", senderName: "Ryan Bot", senderId: "app-bot" }];
    vi.mocked(host.getQueueItem!).mockReturnValue(
      queueItem({ text: "", attachments: [], conversationQuotes }),
    );
    await new V4CommandExecutor(host).execute(envelope("sendQueuedNow", { queueItemId: "q-1" }));
    expect(app.sendInput).toHaveBeenCalledWith(
      expect.objectContaining({ text: "" }),
      expect.objectContaining({ intent: expect.objectContaining({ conversationQuotes }) }),
    );
  });
  it.each(["plan", "guarded", "yolo"] as const)(
    "%s 队列保留 mode/intent/附件：reserve → start → remove",
    async (mode) => {
      const app = makeApp();
      const record = makeRecord({ app });
      const host = makeHost(record, { getQueueItem: vi.fn().mockReturnValue(queueItem({ mode })) });
      await new V4CommandExecutor(host).execute(envelope("sendQueuedNow", { queueItemId: "q-1" }));
      expect(host.getQueueItem).toHaveBeenCalledWith("s1", "q-1");
      expect(app.reserveQueueItem).toHaveBeenCalledWith("q-1", "cmd-q1", expect.any(Object));
      expect(app.markQueueItemPromoting).toHaveBeenCalledWith("q-1", "cmd-q1", expect.any(Object));
      expect(app.sendInput).toHaveBeenCalledWith(
        {
          text: "排队原文",
          attachments: [expect.objectContaining({ path: "/tmp/note.txt", filename: "note.txt" })],
        },
        expect.objectContaining({
          delivery: "start_turn",
          inputId: "source-command-q1",
          queryId: "source-command-q1",
          intent: expect.objectContaining({
            sourceCommandId: "source-command-q1",
            queueItemId: "q-1",
            clientId: "mobile-client",
            modelSelection: {
              providerId: "provider-at-submit",
              modelId: "model-at-submit",
              options: { reasoningLevel: "high" },
            },
            mode,
            attachmentRefs: [
              { ref: "/tmp/note.txt", fileName: "note.txt", mime: "text/plain", bytes: 9 },
            ],
          }),
        }),
      );
      expect(app.removeQueueItem).toHaveBeenCalledWith(
        "q-1",
        expect.objectContaining({ reason: "promoted", reservationId: "cmd-q1" }),
      );
      expect(app.sendInput.mock.invocationCallOrder[0]).toBeLessThan(
        app.removeQueueItem.mock.invocationCallOrder[0],
      );
    },
  );

  it("Core admission 后直接 promoted/remove，不等待 turn completion", async () => {
    const turnGate = deferred<void>();
    const app = makeApp({
      sendInput: vi.fn().mockResolvedValue({
        completion: turnGate.promise,
        kind: "started_turn",
        turnId: "turn-q1",
      }),
    });
    const record = makeRecord({ app });
    const host = makeHost(record);

    await new V4CommandExecutor(host).execute(envelope("sendQueuedNow", { queueItemId: "q-1" }));

    // Core admission 完成后就移除队列项，不等待后台 turn 结束。
    expect(app.removeQueueItem).toHaveBeenCalledWith(
      "q-1",
      expect.objectContaining({ reason: "promoted", reservationId: "cmd-q1" }),
    );
    expect(app.releaseQueueItemReservation).not.toHaveBeenCalled();
    turnGate.resolve(undefined);
    await flushDetachedWork();
  });

  it("TurnStarted 缺 messageId 时仍完成 promotion，仅省略 repo 归因", async () => {
    const app = makeApp({
      sendInput: vi.fn().mockResolvedValue({
        completion: Promise.resolve({}),
        kind: "started_turn",
        turnId: "turn-q1",
      }),
    });

    await expect(
      new V4CommandExecutor(makeHost(makeRecord({ app }))).execute(
        envelope("sendQueuedNow", { queueItemId: "q-1" }),
      ),
    ).resolves.toBeUndefined();

    expect(app.removeQueueItem).toHaveBeenCalledWith(
      "q-1",
      expect.objectContaining({ reason: "promoted", reservationId: "cmd-q1" }),
    );
    expect(app.releaseQueueItemReservation).not.toHaveBeenCalled();
  });

  it("软门禁:pre-start failure 不误记 promoted,释放 reservation 回到 queued", async () => {
    const app = makeApp({
      sendInput: vi.fn().mockRejectedValue(new Error("runtime failed before queue TurnStarted")),
    });
    const record = makeRecord({ app });

    const executing = new V4CommandExecutor(makeHost(record)).execute(
      envelope("sendQueuedNow", { queueItemId: "q-1" }),
    );
    void executing.catch(() => undefined);
    await flushDetachedWork();
    await expect(executing).rejects.toMatchObject({
      message: expect.stringContaining("runtime failed"),
    });

    expect(app.removeQueueItem).not.toHaveBeenCalled();
    expect(app.releaseQueueItemReservation).toHaveBeenCalledWith(
      "q-1",
      "cmd-q1",
      expect.any(Object),
    );
  });

  it("goal queue item：sendQueuedNow 走 goal command path，不作为普通 prompt 重发", async () => {
    const app = makeApp();
    const record = makeRecord({ app });
    const host = makeHost(record, {
      getQueueItem: vi.fn().mockReturnValue({
        ...queueItem(),
        queueItemId: "q-goal",
        sourceCommandId: "source-goal",
        kind: "sendGoalCommand" as const,
        text: "/goal 排队目标",
      }),
    } as never);
    await new V4CommandExecutor(host).execute(envelope("sendQueuedNow", { queueItemId: "q-goal" }));
    expect(app.removeQueueItem).toHaveBeenCalledWith(
      "q-goal",
      expect.objectContaining({ reason: "promoted", reservationId: "cmd-q1" }),
    );
    expect(app.sendInput).not.toHaveBeenCalled();
    expect(app.setTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        displayText: "/goal 排队目标",
        objective: "排队目标",
        status: "active",
        intent: expect.objectContaining({
          sourceCommandId: "source-goal",
          text: "排队目标",
        }),
      }),
    );
  });

  it.each([false, true])(
    "compact queue item：提升保留原选择，autoDrain=%s",
    async (autoDrainPromotion) => {
      let finishCompact!: () => void;
      const compactGate = new Promise<Record<string, never>>((resolve) => {
        finishCompact = () => resolve({});
      });
      const app = makeApp({ submitPrompt: vi.fn().mockReturnValue(compactGate) });
      const record = makeRecord({ app });
      const host = makeHost(record, {
        getQueueItem: vi.fn().mockReturnValue(
          queueItem({
            queueItemId: "q-compact",
            sourceCommandId: "source-compact",
            kind: "compact",
            text: "/compact",
            attachments: [],
          }),
        ),
        recordPersistentCommandFact: vi.fn().mockResolvedValue(undefined),
      });
      await new V4CommandExecutor(host).execute(
        Object.assign(envelope("sendQueuedNow", { queueItemId: "q-compact" }), {
          __v4ExecutionContext: autoDrainPromotion ? { autoDrainPromotion: true } : undefined,
        }),
      );
      expect(app.submitPrompt).toHaveBeenCalledWith(
        "/compact",
        expect.objectContaining({
          inputId: "source-compact",
          intent: expect.objectContaining({
            sourceCommandId: "source-compact",
            queueItemId: "q-compact",
            admissionSeq: 7,
            modelSelection: queueItem().modelSelection,
          }),
        }),
      );
      expect(app.sendInput).not.toHaveBeenCalled();
      expect(app.removeQueueItem).toHaveBeenCalledWith(
        "q-compact",
        expect.objectContaining({ reason: "promoted", reservationId: "cmd-q1" }),
      );
      expect(host.legacyMutations).toContain("queue_compact_promoted");
      finishCompact();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  );

  it("automation queue 提升时回放可信身份，并在该 turn 结束后清理", async () => {
    const completion = deferred<unknown>();
    const app = makeApp({
      sendInput: vi.fn().mockImplementation(async (_input, options) => {
        options?.onTurnStartedObserved?.({
          id: "event-automation-queue-turn-started",
          type: SessionEventType.TurnStarted,
          payload: { messageId: "msg-automation-queue-turn-started" },
        });
        return {
          completion: completion.promise,
          kind: "started_turn",
          turnId: "turn-automation-queued",
        };
      }),
    });
    const record = makeRecord({ app });
    const item = queueItem({ attachments: [], automationId: "automation-queued" });

    await new V4CommandExecutor(makeHost(record, { getQueueItem: () => item })).execute(
      envelope("sendQueuedNow", { queueItemId: item.queueItemId }),
    );

    expect(app.sendInput).toHaveBeenCalledWith(
      expect.objectContaining({ text: item.text }),
      expect.objectContaining({
        automationId: "automation-queued",
        inputId: item.sourceCommandId,
        requireIdle: true,
      }),
    );
    expect(record.activeAutomationId).toBe("automation-queued");

    completion.resolve({});
    await flushDetachedWork();
    expect(record.activeAutomationId).toBeUndefined();
  });

  // FORK-BEGIN(codex-collaboration)
  it.each([
    { withAttachment: false, autoDrain: false },
    { withAttachment: true, autoDrain: false },
    { withAttachment: false, autoDrain: true },
  ])(
    "空闲提升保持独立轮语义 attachment=$withAttachment / auto=$autoDrain",
    async ({ withAttachment, autoDrain }) => {
      const app = makeApp();
      const item = queueItem(withAttachment ? {} : { attachments: [] });
      await new V4CommandExecutor(
        makeHost(makeRecord({ app }), { getQueueItem: () => item }),
      ).execute(
        envelope("sendQueuedNow", { queueItemId: "q-1" }),
        undefined,
        autoDrain ? { autoDrainPromotion: true } : undefined,
      );
      expect(app.sendInput).toHaveBeenCalledTimes(1);
      const [, options] = app.sendInput.mock.calls[0]!;
      expect(options.inputPresentation).toBeUndefined();
      expect(options).toMatchObject({
        inputId: item.sourceCommandId,
        requireIdle: true,
        intent: {
          sourceCommandId: item.sourceCommandId,
          clientId: item.clientId,
          requestedDelivery: "queue",
        },
      });
      expect(app.runtime.stopActiveForegroundExecution).not.toHaveBeenCalled();
      expect(app.removeQueueItem).toHaveBeenCalledWith(
        "q-1",
        expect.objectContaining({ reason: "promoted", reservationId: "cmd-q1" }),
      );
    },
  );

  it.each(["attachment", "compact", "refresh", "goal", "notification", "highspeed"])(
    "busy 且无法 inline (%s)：不停止、不重发，原项可重试",
    async (kind) => {
      const item = queueItem({
        ...(kind === "compact" ? { kind: "compact", text: "/compact" } : {}),
        ...(kind === "refresh" ? { kind: "refresh", text: "/refresh" } : {}),
        ...(kind === "goal" ? { kind: "sendGoalCommand", text: "/goal objective" } : {}),
        ...(kind === "notification" || kind === "highspeed" ? { attachments: [] } : {}),
        ...(kind === "highspeed"
          ? { highspeed: { cardId: "card", taskId: "task", expiresAt: Date.now() + 60000 } }
          : {}),
      });
      const app = makeApp({
        runtime: {
          acquireForegroundPromotionLease: vi.fn().mockReturnValue({ kind: "busy" }),
          getActiveForegroundExecutionId: vi.fn(() => "active-foreground"),
        },
      });
      const controller = new AbortController();
      const record = makeRecord({ app, activeAbortController: controller });
      await expect(
        new V4CommandExecutor(makeHost(record, { getQueueItem: () => item })).execute(
          envelope("sendQueuedNow", { queueItemId: "q-1" }),
        ),
      ).rejects.toBeInstanceOf(V4QueuePromotionLeaseUnavailableError);
      expect(controller.signal.aborted).toBe(false);
      expect(app.runtime.stopActiveForegroundExecution).not.toHaveBeenCalled();
      expect(app.readTarget).not.toHaveBeenCalled();
      expect(app.updateTargetStatus).not.toHaveBeenCalled();
      expect(app.sendInput).not.toHaveBeenCalled();
      expect(app.removeQueueItem).not.toHaveBeenCalled();
      expect(app.releaseQueueItemReservation).toHaveBeenCalledWith(
        "q-1",
        "cmd-q1",
        expect.any(Object),
      );
    },
  );

  it("转 guide 不改变 active goal 或 queue auto-drain", async () => {
    const app = makeApp({ guideQueueItem: vi.fn().mockResolvedValue(true) });
    const host = makeHost(makeRecord({ app }), {
      getQueueItem: () => queueItem({ attachments: [] }),
    });
    await new V4CommandExecutor(host).execute(envelope("sendQueuedNow", { queueItemId: "q-1" }));
    expect(app.runtime.acquireForegroundPromotionLease).not.toHaveBeenCalled();
    expect(app.runtime.stopActiveForegroundExecution).not.toHaveBeenCalled();
    expect(app.readTarget).not.toHaveBeenCalled();
    expect(app.updateTargetStatus).not.toHaveBeenCalled();
    expect(app.setQueueAutoDrain).not.toHaveBeenCalled();
    expect(host.legacyMutations).not.toContain("send_queued_now_goal_paused");
  });

  it("BG44：idle lease 覆盖提升交接，notification 不能趁空窗进入", async () => {
    let lease: string | undefined;
    const calls: string[] = [];
    const app = makeApp({
      runtime: {
        acquireForegroundPromotionLease: vi.fn(({ leaseId, mode }) => {
          expect(mode).toBe("idle-only");
          lease = leaseId;
          return { kind: "acquired", leaseId };
        }),
        releaseForegroundPromotionLease: vi.fn(() => {
          lease = undefined;
        }),
      },
      markQueueItemPromoting: vi.fn(async () => {
        await Promise.resolve();
        calls.push(lease ? "notification-blocked" : "notification-started");
        return true;
      }),
    });
    await new V4CommandExecutor(makeHost(makeRecord({ app }))).execute(
      envelope("sendQueuedNow", { queueItemId: "q-1" }),
    );
    expect(calls).toEqual(["notification-blocked"]);
    expect(app.runtime.stopActiveForegroundExecution).not.toHaveBeenCalled();
    expect(app.sendInput).toHaveBeenCalledOnce();
    expect(app.removeQueueItem).toHaveBeenCalledOnce();
  });
  // FORK-END(codex-collaboration)

  it("原文查不到（已 drain/删除或 id 无效）：拒绝且绝不盲删", async () => {
    const app = makeApp();
    const record = makeRecord({ app });
    const host = makeHost(record, {
      getQueueItem: vi.fn().mockReturnValue(null),
    });
    await expect(
      new V4CommandExecutor(host).execute(envelope("sendQueuedNow", { queueItemId: "q-missing" })),
    ).rejects.toBeInstanceOf(V4QueueItemTextUnavailableError);
    expect(app.removeQueueItem).not.toHaveBeenCalled();
    expect(app.sendInput).not.toHaveBeenCalled();
  });

  it("host 未接 getQueueItem 能力：同样拒绝（不能退化为 text-only 重发）", async () => {
    const app = makeApp();
    const record = makeRecord({ app });
    const host = makeHost(record, { getQueueItem: undefined });
    await expect(
      new V4CommandExecutor(host).execute(envelope("sendQueuedNow", { queueItemId: "q-1" })),
    ).rejects.toBeInstanceOf(V4QueueItemTextUnavailableError);
  });

  it("同 queue item 已被另一端 reserve：明确拒绝且不 stop/start/remove", async () => {
    const app = makeApp({ reserveQueueItem: vi.fn().mockResolvedValue(false) });
    const controller = new AbortController();
    const record = makeRecord({ app, activeAbortController: controller });
    await expect(
      new V4CommandExecutor(makeHost(record)).execute(
        envelope("sendQueuedNow", { queueItemId: "q-1" }),
      ),
    ).rejects.toBeInstanceOf(V4QueueItemReservedError);
    expect(controller.signal.aborted).toBe(false);
    expect(app.sendInput).not.toHaveBeenCalled();
    expect(app.removeQueueItem).not.toHaveBeenCalled();
  });

  it("start barrier 失败：释放 reservation，原 queue item 不移除", async () => {
    const app = makeApp();
    const record = makeRecord({ app });
    const host = makeHost(record, {
      ensureModelReady: vi.fn().mockRejectedValue(new Error("model unavailable")),
    });
    await expect(
      new V4CommandExecutor(host).execute(envelope("sendQueuedNow", { queueItemId: "q-1" })),
    ).rejects.toThrow("model unavailable");
    expect(app.releaseQueueItemReservation).toHaveBeenCalledWith(
      "q-1",
      "cmd-q1",
      expect.any(Object),
    );
    expect(app.removeQueueItem).not.toHaveBeenCalled();
  });
});
