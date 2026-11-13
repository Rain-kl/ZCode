import { createChildTraceContext, createQueryId, createTurnId } from "@zcode/contracts";
import { createRuntimeCommandId, type PromptRuntimeCommand } from "../../runtime/command-queue.js";
import { enqueueCancellableRuntimeCommand } from "../../runtime/methods/runtime-command-submit.js";
import type { AgentRuntimeInternal } from "../../runtime/internal.js";
import type { TurnResult } from "../../runtime/types.js";
import type { CollaborationMessage, TurnAdmission } from "../codex-collaboration/contract.js";
export async function prepareCollaborationTurn(
  runtime: AgentRuntimeInternal,
  task: CollaborationMessage,
  signal: AbortSignal,
  persist: () => Promise<unknown>,
): Promise<TurnAdmission> {
  if (runtime.hasActiveOrQueuedTurnWork())
    throw new Error(`Collaboration admission requires idle session ${runtime.sessionId}`);
  signal.throwIfAborted();
  const turnId = createTurnId();
  const traceContext = createChildTraceContext(runtime.rootTraceContext, {
    sessionId: runtime.sessionId,
    turnId,
    queryId: createQueryId(),
  });
  runtime.reserveTurnStart(turnId, traceContext, "regular");
  try {
    await persist();
    signal.throwIfAborted();
  } catch (error) {
    runtime.releaseTurnStart(turnId);
    throw error;
  }
  let used = false;
  return {
    async cancel() {
      if (used) return;
      used = true;
      runtime.releaseTurnStart(turnId);
    },
    async run() {
      if (used) throw new Error(`Collaboration admission already consumed: ${task.id}`);
      used = true;
      runtime.backgroundTaskNotificationsSealed = false;
      runtime.backgroundTaskNotificationSealReason = undefined;
      const result = await enqueueCancellableRuntimeCommand<TurnResult, PromptRuntimeCommand>(
        runtime,
        {
          abortSignal: signal,
          onCommandCancelled: () => runtime.releaseTurnStart(turnId),
          createCommand: ({ resolve, reject }) => ({
            id: createRuntimeCommandId(),
            createdAt: new Date(),
            input: task.text,
            mode: "prompt",
            priority: "next",
            traceContext,
            resolve,
            reject,
            startReservation: { kind: "regular", turnId, traceContext },
            options: {
              abortSignal: signal,
              traceContext,
              recordedInputMessageId: task.id as import("@zcode/contracts").MessageId,
              skipInputRecord: true,
              inputSource: "subagent",
              inputVisibility: task.kind === "NEW_TASK" ? "user-visible" : "model-only",
              skipUserPromptSubmitHooks: true,
            },
          }),
        },
      );
      return { status: "completed", text: result.response };
    },
  };
}
