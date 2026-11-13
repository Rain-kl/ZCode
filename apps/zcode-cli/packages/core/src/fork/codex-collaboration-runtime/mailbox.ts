import {
  CollaborationMessageProvenanceSchema,
  SessionEventType,
  type MessageId,
  type CollaborationMessageProvenance,
  type MessageWithParts,
} from "@zcode/contracts";
import { createRuntimeCommandId } from "../../runtime/command-queue.js";
import type { RuntimeMessageEntry } from "../../agent/message-history.js";
import type { AgentRuntimeInternal } from "../../runtime/internal.js";
import type { AgentIdentity, CollaborationMessage } from "../codex-collaboration/contract.js";
export interface MailboxReceipt {
  message: CollaborationMessage;
  provenance: CollaborationMessageProvenance;
}
export function readMailboxReceipt(
  message: MessageWithParts,
  identity: AgentIdentity,
): CollaborationMessageProvenance | undefined {
  const metadata = message.info.metadata;
  if (!metadata || typeof metadata !== "object" || !("collaboration" in metadata)) return undefined;
  if ("collaborationInherited" in metadata && metadata.collaborationInherited === true)
    return undefined;
  const provenance = CollaborationMessageProvenanceSchema.parse(metadata.collaboration);
  // 只有正文与路由完整的 durable receipt 才能去重；saveMessage 成功而 savePart 失败不是接纳。
  if (
    provenance.messageId !== message.info.id ||
    provenance.recipientId !== identity.agentId ||
    provenance.recipientPath !== identity.path ||
    !message.parts.some((part) => part.type === "text" && part.text.length > 0)
  )
    throw new Error(
      `Incomplete collaboration task receipt ${message.info.id} for ${identity.path}`,
    );
  return provenance;
}
export function createRuntimeMailbox(
  runtime: AgentRuntimeInternal,
  identity: AgentIdentity,
  resolve: (id: string) => AgentIdentity,
) {
  const pending: RuntimeMessageEntry[] = [];
  const known = new Set<string>();
  const inline = new Set<string>();
  let latest: CollaborationMessage | undefined;

  let installed = false;
  const entry = (receipt: MailboxReceipt): RuntimeMessageEntry => ({
    message: { role: "user", content: receipt.message.text },
    metadata: { source: "subagent_message", collaboration: receipt.provenance },
  });
  return {
    hasUnreadMessages: () => pending.length > 0,
    latestMessage: () => latest,
    async install() {
      if (installed) return;
      const messages =
        (await runtime.sessionStore?.messages({ sessionID: runtime.sessionId })) ?? [];
      for (const message of messages) {
        const receipt = readMailboxReceipt(message, identity);
        if (receipt) known.add(receipt.messageId);
      }
      installed = true;
    },
    async deliver(message: CollaborationMessage) {
      if (!installed) throw new Error(`Mailbox not installed for ${identity.path}`);
      if (known.has(message.id)) return { messageId: message.id };
      const sender = resolve(message.senderId);
      const provenance: CollaborationMessageProvenance = {
        version: 1,
        messageId: message.id,
        kind: message.kind,
        senderId: message.senderId,
        recipientId: message.recipientId,
        senderPath: sender.path,
        recipientPath: identity.path,
      };
      const visible =
        identity.path !== "/root" && (message.kind === "NEW_TASK" || message.kind === "MESSAGE");
      const inlineInput = visible && runtime.activeTurn !== undefined;
      await runtime.ensureSessionPersisted(message.text, runtime.rootTraceContext);
      await runtime.persistSyntheticUserNoticeForSession({
        messageID: message.id as import("@zcode/contracts").MessageId,
        sessionId: runtime.sessionId,
        source: "subagent_message",
        text: message.text,
        visibility: visible ? "user-visible" : "model-only",
        metadata: { collaboration: provenance, ...(inlineInput ? { steerDelivery: "guide" } : {}) },
        traceContext: runtime.rootTraceContext,
      });
      const incoming = entry({ message, provenance });
      runtime.messageHistory.addEntries([incoming]);
      pending.push(incoming);
      known.add(message.id);
      latest = message;
      if (inlineInput) inline.add(message.id);
      // 完成唤醒复用 runtime 命令队列；调度项只保存 receipt ID，正文和来源仍由邮箱所有。
      if (
        identity.path === "/root" &&
        (message.kind === "FINAL_ANSWER" ||
          message.kind === "STATUS" ||
          (message.kind === "MESSAGE" && runtime.activeTurn !== undefined)) &&
        !runtime.shuttingDown
      )
        runtime.enqueueRuntimeCommand({
          id: createRuntimeCommandId(),
          createdAt: new Date(),
          mode: "task-notification",
          priority: "next",
          branchGeneration:
            runtime.runtimeTaskRegistry.get(message.senderId)?.branchGeneration ??
            runtime.branchGeneration,
          source: "background_task",
          text: "",
          collaborationMessageId: message.id as MessageId,
          originMeta: {
            backgroundSource: "subagent",
            workId: message.senderId,
            title: sender.path,
          },
          traceContext: runtime.rootTraceContext,
        });
      return { messageId: message.id };
    },
    async consume() {
      const entries = [...pending];
      for (const incoming of entries) {
        const id = incoming.metadata!.collaboration!.messageId;
        if (incoming.kind !== "attachment" && inline.has(id) && runtime.activeTurn) {
          const active = runtime.activeTurn;
          await runtime.appendEvent(
            runtime.createEvent(
              SessionEventType.TurnSteerDrained,
              {
                targetTurnId: active.turnId,
                injectedMessageIds: [id as MessageId],
                pendingInputIds: [id],
                drainedInputs: [
                  {
                    pendingInputId: id,
                    messageId: id as MessageId,
                    text: String(incoming.message.content),
                    delivery: "guide",
                  },
                ],
              },
              active.traceContext,
            ),
            active.traceContext,
          );
          inline.delete(id);
        }
        for (const command of runtime.runtimeCommandQueue.snapshot())
          if (command.mode === "task-notification" && command.collaborationMessageId === id)
            runtime.runtimeCommandQueue.removeById(command.id);
      }
      pending.splice(0, entries.length);
      return entries;
    },
  };
}
