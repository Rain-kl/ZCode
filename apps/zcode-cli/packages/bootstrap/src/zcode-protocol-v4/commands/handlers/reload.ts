// reload 命令组：/reload（FORK(reload-command)）。
//
// 语义：在已有会话里重读 fork 设置（系统指令 + 工具档位），就地重建提示词前缀与工具面，
// 下一轮起生效；对话历史不动。空闲直接派发为一次 `executeTurnCommand("/reload")`
// （turn.ts 的 parseReloadCommand 分流到 core 的 executeForkReload 维护轮），忙碌与 compact
// 一致进入 FIFO（commandKind = "reload"，回合结束排空时走同一条分流）。命令本身不产生模型请求。
//
// 见 FEATURES.md 的 reload-command 条目与 docs/features/reload-command/design.md。
import type { CommandEnvelope, CommandResult } from "@zcode/shared/zcode-protocol-v4";
import type { SteerTurnOptions } from "../../../app/types.js";
import { inputIntentMetadata } from "../input-intent.js";
import { requireRecord } from "../record-access.js";
import type { V4CommandCoreHost } from "../types.js";
import { enqueueDeferredInputForBusyWork, V4InputAdmissionRejectedError } from "./session-flow.js";

/** /reload 的裁决拒绝（gateway 捕获后进 ACK failed，message 透传给客户端）。 */
export class V4ReloadRejectedError extends Error {
  constructor(
    readonly reasonCode: "restoreWarning",
    message: string,
  ) {
    super(message);
    this.name = "V4ReloadRejectedError";
  }
}

async function reload(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const record = requireRecord(host, envelope.sessionId);
  if (record.restoreWarning) {
    // 与 compact / prompt-turn 同一道闸：恢复失败的会话不能静默续写（含维护轮）。
    throw new V4ReloadRejectedError("restoreWarning", record.restoreWarning.message);
  }

  const activeTurn = record.app.runtime.getActiveTurnInfo();
  const routingMode = host.getInputRoutingMode?.(record.app.sessionId) ?? null;
  const busy = Boolean(record.activeAbortController) || Boolean(activeTurn);
  if (busy || routingMode === "enqueue" || routingMode === "guide" || routingMode === "choice") {
    // 忙碌：与 compact 一致入 FIFO；消费时由 turn.ts 的 parseReloadCommand 分流执行，
    // 与空闲路径落到同一个执行点。
    const intent = inputIntentMetadata(envelope, { requestedDelivery: "queue", text: "/reload" });
    const queueOptions = {
      commandKind: "reload" as const,
      inputId: envelope.commandId,
      intent,
      queryId: envelope.commandId as NonNullable<SteerTurnOptions["queryId"]>,
    };
    if (await enqueueDeferredInputForBusyWork(record, "/reload", queueOptions)) {
      return undefined;
    }
    const queued = await record.app.steerTurn("/reload", {
      ...queueOptions,
      delivery: "queue",
    });
    if (queued.kind === "rejected") {
      throw new V4InputAdmissionRejectedError(
        queued.reason === "input_too_large"
          ? "proto.payloadTooLarge"
          : queued.reason === "empty_input"
            ? "proto.invalidPayload"
            : "fault.command.inputRejected",
        `reload input queue rejected: ${queued.reason}`,
      );
    }
    return undefined;
  }

  // 空闲：直接派发，命令 ACK 等待维护轮完成（重载是亚秒级动作，无需后台 run 语义）。
  // Stop 通道与 compact 同形：controller 登记在 record 上，执行结束统一摘除。
  const abortController = new AbortController();
  record.activeAbortController = abortController;
  try {
    await record.app.submitPrompt("/reload", {
      abortSignal: abortController.signal,
      inputId: envelope.commandId,
    });
  } finally {
    if (record.activeAbortController === abortController) {
      record.activeAbortController = undefined;
    }
  }
  return undefined;
}

export const reloadHandlers = { reload } as const;
