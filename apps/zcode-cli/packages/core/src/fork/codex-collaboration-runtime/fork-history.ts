import { createMessageId, createPartId, type MessagePart } from "@zcode/contracts";
import type { AgentRuntimeInternal } from "../../runtime/internal.js";
import { MessageHistoryImpl } from "../../agent/message-history.js";
import { hydrateMessageHistoryFromSession } from "../../agent/session-history-hydrator.js";
/** Active declarations are deliberately excluded; only closed historical calls may be inherited. */
export async function forkCompletedHistory(
  parent: AgentRuntimeInternal,
  child: AgentRuntimeInternal,
) {
  if (!parent.sessionStore) {
    const entries = parent.messageHistory.toRuntimeEntries();
    const results = new Set(
      entries
        .filter((entry) => entry.kind !== "attachment" && entry.message.role === "tool")
        .map((entry) => (entry.kind !== "attachment" ? entry.message.toolCallId : undefined)),
    );
    const activeIndex = entries.findLastIndex(
      (entry) =>
        entry.kind !== "attachment" &&
        entry.message.role === "assistant" &&
        entry.message.toolCalls?.some((call) => !results.has(call.id)),
    );
    const declared = new Set(
      entries.flatMap((entry, index) =>
        entry.kind !== "attachment" && index !== activeIndex
          ? (entry.message.toolCalls?.map((call) => call.id) ?? [])
          : [],
      ),
    );
    const closed = new Set([...declared].filter((id) => results.has(id)));
    const inherited = entries
      .filter((entry) => entry.kind === "attachment" || entry.message.role !== "system")
      .map((entry) => {
        if (entry.kind === "attachment") return entry;
        const message = {
          ...entry.message,
          ...(entry.message.toolCalls
            ? { toolCalls: entry.message.toolCalls.filter((call) => closed.has(call.id)) }
            : {}),
        };
        return {
          ...entry,
          message,
          ...(message.role === "user" && !entry.metadata?.collaboration
            ? { metadata: { ...entry.metadata, source: "legacy_synthetic" as const } }
            : {}),
        };
      })
      .filter(
        (entry) =>
          entry.kind === "attachment" ||
          ((entry.message.role !== "tool" || closed.has(entry.message.toolCallId!)) &&
            (entry.message.content !== "" || (entry.message.toolCalls?.length ?? 0) > 0)),
      );
    child.messageHistory.addEntries(inherited);
    return;
  }
  const messages = (await parent.sessionStore?.messages({ sessionID: parent.sessionId })) ?? [];
  const inherited = [];
  for (const original of new Map(messages.map((message) => [message.info.id, message])).values()) {
    const messageID = createMessageId();
    const latestParts = [...new Map(original.parts.map((part) => [part.id, part])).values()];
    const parts = latestParts
      .filter(
        (part) =>
          part.type !== "tool" ||
          (original.info.id !== parent.latestAssistantMessageId &&
            (part.state.status === "completed" || part.state.status === "error")),
      )
      .map(
        (part): MessagePart => ({
          ...structuredClone(part),
          id: createPartId(),
          sessionID: child.sessionId,
          messageID,
        }),
      );
    if (!parts.length) continue;
    const message = {
      ...structuredClone(original.info),
      id: messageID,
      sessionID: child.sessionId,
      ...(original.info.role === "user"
        ? {
            semantics: {
              origin: "import" as const,
              kind: "user_prompt" as const,
              uiVisibility: "hidden" as const,
              providerVisibility: "visible" as const,
              transcriptVisibility: "visible" as const,
            },
            metadata: { ...original.info.metadata, collaborationInherited: true },
          }
        : {}),
    };
    await child.sessionStore?.saveMessage(message);
    for (const part of parts) await child.sessionStore?.savePart(part);
    inherited.push({ info: message, parts });
  }
  const history = new MessageHistoryImpl();
  await hydrateMessageHistoryFromSession({ history, messages: inherited });
  child.messageHistory.addEntries(history.toRuntimeEntries());
}
