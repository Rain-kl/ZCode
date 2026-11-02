// FORK(codex-collaboration): TUI 与 V4 复用同一 canonical 只读身份投影。
import { readCollaborationChildren } from "../fork/codex-collaboration-client/module.js";
import {
  SessionEventType,
  type SessionEvent,
  type SessionId,
  type SessionStorePort,
} from "@zcode/contracts";
import type { AgentRuntime } from "@zcode/core";
import type { ZCodeSessionSubagentsResult } from "@zcode/shared";
import { projectSessionTranscript, type SessionTranscriptMessage } from "../session-transcript.js";
import {
  paginateEndedSubagents,
  projectSessionSubagents,
} from "../zcode-protocol/subagent-session-query.js";

export interface SubagentTranscriptSnapshot {
  sessionId: string;
  sequenceNumber: number;
  messages: Array<SessionTranscriptMessage & { id?: string }>;
  events: SessionEvent[];
  replayMessageIds: string[];
}

type ObservationDeps = {
  sessionId: SessionId;
  sessionStore: SessionStorePort;
  runtime: AgentRuntime;
};

/** The app owns storage and lifecycle interpretation; the TUI receives a read model. */
export function createSubagentObservation(deps: ObservationDeps) {
  return {
    async readSubagents(
      input: { endedCursor?: string; endedLimit?: number } = {},
    ): Promise<ZCodeSessionSubagentsResult> {
      const eventStore = deps.runtime.getSessionEventStore();
      const parentSession = await deps.sessionStore.getSession(deps.sessionId);
      if (!parentSession)
        return { revision: 0, childSessionIds: [], running: [], ended: { total: 0, items: [] } };
      const messages = await deps.sessionStore.messages({ sessionID: deps.sessionId });
      // FORK-BEGIN(codex-collaboration)
      const facts = await readCollaborationChildren({
        store: deps.sessionStore,
        session: parentSession,
        messages,
        getAgentStatus: (_rootId, agentId) => deps.runtime.getCollaborationAgentStatus(agentId),
      });
      const projection = projectSessionSubagents({
        revision: await eventStore.getLatestSequenceNumber(deps.sessionId),
        children: facts.children,
      });
      // FORK-END(codex-collaboration)
      const ended = paginateEndedSubagents(projection.ended, {
        cursor: input.endedCursor,
        limit: Math.min(100, Math.max(1, input.endedLimit ?? 20)),
      });
      return {
        revision: projection.revision,
        childSessionIds: facts.children.map((child) => child.childSessionId),
        running: projection.running,
        ended: { total: projection.ended.length, ...ended },
      };
    },
    async readSubagentTranscript(childSessionId: string): Promise<SubagentTranscriptSnapshot> {
      const eventStore = deps.runtime.getSessionEventStore();
      const sessionId = childSessionId as SessionId;
      const child = await deps.sessionStore.getSession(sessionId);
      if (!child || child.parentID !== deps.sessionId || child.taskType !== "subagent_child") {
        throw new Error("Subagent does not belong to the current session.");
      }
      // FORK(codex-collaboration): parentID 仅是附加校验；必须同属 accepted graph 才可下钻。
      const manifest = await this.readSubagents();
      if (!manifest.childSessionIds.includes(childSessionId))
        throw new Error(`Subagent has no accepted relation: ${childSessionId}`);
      // Read persisted history first, then the event tail. For messages with a
      // complete live stream, replay replaces persisted text instead of appending
      // it twice. Later events are admitted strictly after this watermark.
      const persisted = await deps.sessionStore.messages({ sessionID: sessionId });
      const events = await eventStore.getEvents(sessionId);
      const replayMessageIds = new Set<string>();
      for (const event of events) {
        const payload = event.payload as Record<string, unknown>;
        if (
          event.type === SessionEventType.ModelStreaming &&
          payload.kind === "start" &&
          typeof payload.assistantMessageId === "string"
        ) {
          replayMessageIds.add(payload.assistantMessageId);
        }
      }
      const messages = persisted.flatMap((message) =>
        replayMessageIds.has(message.info.id)
          ? [{ id: message.info.id, content: "", role: "agent" as const }]
          : projectSessionTranscript([message]).map((projected) => ({
              ...projected,
              id: message.info.id,
            })),
      );
      return {
        sessionId,
        messages,
        events,
        replayMessageIds: [...replayMessageIds],
        sequenceNumber: events.at(-1)?.sequenceNumber ?? 0,
      };
    },
  };
}
