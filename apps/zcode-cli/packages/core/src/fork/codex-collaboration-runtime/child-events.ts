import {
  SessionEventType,
  type CollaborationIdentityMetadata,
  type SessionId,
  type TraceContext,
} from "@zcode/contracts";
import type { AgentRuntimeInternal } from "../../runtime/internal.js";
import type { AgentRuntime } from "../../runtime/agent-runtime.js";
import type { AgentIdentity } from "../codex-collaboration/contract.js";
import { mirrorSubagentToolEvent } from "../../subagent/tool-event-mirror.js";

export function childEventSink(
  parent: AgentRuntimeInternal,
  identity: AgentIdentity,
  traceContext: TraceContext,
  relation: () => CollaborationIdentityMetadata | undefined,
  child: () => AgentRuntimeInternal,
) {
  const names = new Map<string, string>();
  const parentTurnId = parent.activeTurn?.turnId;
  return {
    async onSessionEvent(event: import("@zcode/contracts").SessionEvent) {
      if (
        event.sessionId !== identity.childSessionId ||
        (event.payload &&
          typeof event.payload === "object" &&
          "source" in event.payload &&
          event.payload.source === "subagent")
      ) {
        await parent.notifyEventSinks(event, { ...traceContext, sessionId: event.sessionId });
        return;
      }
      // 原 runner 在终态后封口；新 driver 同样必须阻止 Bash 通知另起未被 controller 接纳的模型轮。
      if (event.type === SessionEventType.TurnComplete || event.type === SessionEventType.TurnError)
        child().sealBackgroundTaskNotifications({ reason: "subagent_terminal", traceContext });
      const current = relation();
      const context = {
        agentId: identity.agentId,
        agentType: identity.settings.agentType ?? "general-purpose",
        childSessionId: identity.childSessionId as SessionId,
        description: identity.path,
        parentSessionId: parent.sessionId,
        parentToolCallId: current?.toolCallId,
        parentTurnId,
        background: true,
        toolNameByChildToolCallId: names,
      };
      await (parent as unknown as AgentRuntime).notifyExternalChildSessionEvent({
        childSessionId: context.childSessionId,
        event,
        traceContext,
      });
      const mirrored = mirrorSubagentToolEvent(event, context);
      if (mirrored)
        await parent.notifyEventSinks(mirrored, { ...traceContext, sessionId: parent.sessionId });
    },
  };
}
