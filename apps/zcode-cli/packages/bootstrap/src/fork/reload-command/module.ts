import {
  SessionEventType,
  type ForkRefreshCompletedTimelinePart,
  type MessageWithParts,
  type SessionEvent,
} from "@zcode/contracts";
import type { ForkRefreshTimelineReader } from "./contract.js";

export const forkRefreshTimeline: ForkRefreshTimelineReader = {
  completions(message): ForkRefreshCompletedTimelinePart[] {
    const result: ForkRefreshCompletedTimelinePart[] = [];
    for (const part of message.parts) {
      if (part.type !== "timeline" || part.timelineType !== "fork_refresh_completed") continue;
      // 持久化事实畸形时显式拒绝恢复，不能悄悄伪装为成功或丢掉回执。
      if (
        typeof part.completionEventId !== "string" ||
        !part.completionEventId ||
        (part.sourceCommandId !== undefined &&
          (typeof part.sourceCommandId !== "string" || !part.sourceCommandId)) ||
        part.status !== "completed" ||
        part.display !== "separator" ||
        message.info.role !== "assistant" ||
        message.info.semantics?.kind !== "timeline_event" ||
        message.info.semantics.providerVisibility !== "hidden" ||
        !Number.isFinite(message.info.time.created) ||
        (part.time?.start !== undefined && !Number.isFinite(part.time.start)) ||
        (part.time?.end !== undefined && !Number.isFinite(part.time.end))
      ) {
        throw new Error(
          `Invalid fork refresh timeline: session=${message.info.sessionID} message=${message.info.id} part=${part.id}`,
        );
      }
      result.push(part);
    }
    return result;
  },
};

export function hasForkRefreshTimeline(message: MessageWithParts): boolean {
  return forkRefreshTimeline.completions(message).length > 0;
}

export function durableForkRefreshEventIds(messages: readonly MessageWithParts[]): Set<string> {
  return new Set(
    messages.flatMap((message) =>
      forkRefreshTimeline.completions(message).map((part) => part.completionEventId),
    ),
  );
}

export function settledForkRefreshControlTurnIds(
  events: readonly SessionEvent[],
  durableIds: ReadonlySet<string>,
): Set<string> {
  const turns = new Set(
    events.flatMap((event) =>
      event.type === SessionEventType.ForkReloadCompleted &&
      durableIds.has(String(event.id)) &&
      event.turnId
        ? [String(event.turnId)]
        : [],
    ),
  );
  const starts = new Set<string>();
  const ends = new Set<string>();
  for (const event of events) {
    if (!event.turnId || !turns.has(String(event.turnId))) continue;
    if (event.type === SessionEventType.TurnComplete) ends.add(String(event.turnId));
    if (event.type === SessionEventType.TurnStarted) {
      const payload = event.payload as { inputVisibility?: string; executionKind?: string };
      if (payload.inputVisibility === "model-only" && payload.executionKind === "controlOnly")
        starts.add(String(event.turnId));
    }
  }
  return new Set([...starts].filter((turnId) => ends.has(turnId)));
}

export function retainActiveForkRefreshEvents(
  events: readonly SessionEvent[],
  allMessages: readonly MessageWithParts[],
  activeMessages: readonly MessageWithParts[],
): SessionEvent[] {
  const allIds = durableForkRefreshEventIds(allMessages);
  const activeIds = durableForkRefreshEventIds(activeMessages);
  const removedIds = new Set([...allIds].filter((id) => !activeIds.has(id)));
  const removedTurns = settledForkRefreshControlTurnIds(events, removedIds);
  // 旧分支的 live 事实也必须服从 transcript cut；没有持久宿主的旧版本事件仍保留兼容。
  return events.filter((event) => {
    if (event.type === SessionEventType.ForkReloadCompleted && removedIds.has(String(event.id)))
      return false;
    // 只有具备已裁剪持久回执、model-only/controlOnly start 与 success end 的完整维护轮才一起移除。
    return !(
      event.turnId &&
      removedTurns.has(String(event.turnId)) &&
      (event.type === SessionEventType.TurnStarted || event.type === SessionEventType.TurnComplete)
    );
  });
}
