import {
  COLLABORATION_TOOL_NAMES,
  CollaborationToolSchemas,
  CollaborationToolJsonSchemas,
  CoreErrorType,
  createCoreError,
  type CollaborationToolName,
  type CollaborationToolPort,
} from "@zcode/contracts";
import type { ToolEntry, ToolExecutionContext } from "../../tool/types.js";

const MAX_RESULT_BYTES = 100_000;
const STANDARD_TIMEOUT_MS = 30_000;
const WAIT_TIMEOUT_MS = 3_610_000;
const DESCRIPTIONS: Record<CollaborationToolName, string> = {
  spawn_agent:
    'Spawn a child task and return its canonical task_name after durable acceptance. task_name uses lowercase letters, digits and underscores. Full-history forks inherit model and reasoning effort; use fork_turns="none" for explicitly authorized overrides. agent_type must name an available profile. Available agent types are listed in <system-reminder>. Child execution continues after this tool returns.',
  send_message:
    "Send a message to another agent in the same tree without starting an idle agent. Use its task name or canonical path. Messages are consumed at safe model/tool boundaries.",
  followup_task:
    "Send a follow-up task to an existing agent and trigger a turn if idle. Running agents receive the task at a safe boundary. Reuses the same session and transcript.",
  interrupt_agent:
    "Interrupt the target agent's current turn and return its previous status. The identity and transcript remain available. Root and self cannot be interrupted by this tool.",
  list_agents:
    "List loaded agents in the same root tree, including root, sorted by canonical task name. Optionally filter by path_prefix.",
  wait_agent:
    "Wait for collaboration activity or new user input. Default 30 seconds, minimum 10 seconds, maximum 3600 seconds. Short requests are clamped to 10 seconds and reported. Does not cancel agents or return inbox bodies.",
};

function requirePort(context: ToolExecutionContext): CollaborationToolPort {
  if (context.collaborationPort) return context.collaborationPort;
  throw createCoreError(
    CoreErrorType.ConfigurationError,
    "Collaboration runtime port is not configured",
    {
      context: { toolCallId: context.toolCallId, sessionId: context.sessionId },
      recoverable: false,
    },
  );
}
export function createCollaborationToolEntries(): ToolEntry[] {
  return COLLABORATION_TOOL_NAMES.map((name): ToolEntry => {
    const readOnly = name === "list_agents" || name === "wait_agent";
    const timeout = name === "wait_agent" ? WAIT_TIMEOUT_MS : STANDARD_TIMEOUT_MS;
    const spec = CollaborationToolSchemas[name];
    return {
      capability: DESCRIPTIONS[name],
      metadata: {
        name,
        description: DESCRIPTIONS[name],
        searchHint: "agent teammates collaboration",
        shouldDefer: false,
        alwaysLoad: true,
        readOnly,
        destructive: false,
        concurrentSafe: true,
        timeoutMs: timeout,
        maxOutputBytes: MAX_RESULT_BYTES,
        sideEffectScope: readOnly ? "none" : "session",
        riskLevel: "low",
        needsApproval: false,
        allowedInPlanMode: true,
      },
      inputSchema: CollaborationToolJsonSchemas[name].input,
      outputSchema: CollaborationToolJsonSchemas[name].output,
      runtimeInputSchema: spec.input,
      runtimeOutputSchema: spec.output,
      preserveEmptyModelContent: name === "send_message" || name === "followup_task",
      handler: async (raw, context) => {
        const port = requirePort(context);
        const call = {
          toolCallId: context.toolCallId,
          signal: context.abortSignal,
          traceContext: context.traceContext,
          recordIdentity: context.recordCollaborationIdentity,
          ...(context.model
            ? {
                modelSelection: {
                  providerId: context.model.providerId,
                  modelId: context.model.modelId,
                  ...(context.model.options.reasoningLevel
                    ? { options: { reasoningLevel: context.model.options.reasoningLevel } }
                    : {}),
                },
              }
            : {}),
          ...(context.subagentModelOverride
            ? { executionOverride: context.subagentModelOverride }
            : {}),
        };
        switch (name) {
          case "spawn_agent":
            return port.spawn(CollaborationToolSchemas.spawn_agent.input.parse(raw), call);
          case "send_message":
            return port.send(CollaborationToolSchemas.send_message.input.parse(raw), call);
          case "followup_task":
            return port.followup(CollaborationToolSchemas.followup_task.input.parse(raw), call);
          case "interrupt_agent":
            return port.interrupt(CollaborationToolSchemas.interrupt_agent.input.parse(raw), call);
          case "list_agents":
            return port.list(CollaborationToolSchemas.list_agents.input.parse(raw), call);
          case "wait_agent":
            return port.wait(CollaborationToolSchemas.wait_agent.input.parse(raw), call);
        }
      },
      formatModelContent: (raw) => {
        const parsed = spec.output.parse(raw);
        return name === "send_message" || name === "followup_task" ? "" : JSON.stringify(parsed);
      },
      permission: {
        permission: `agent.collaboration.${name}`,
        reason: DESCRIPTIONS[name],
        riskLevel: "low",
        sideEffectScope: readOnly ? "none" : "session",
        needsApproval: false,
        patternSources: ["toolName", "input"],
        alwaysAllowPatternSources: ["toolName"],
        denyPriority: "beforeAsk",
      },
      resultBudget: {
        maxInlineBytes: MAX_RESULT_BYTES,
        maxModelBytes: MAX_RESULT_BYTES,
        strategy: "truncate",
        preview: { maxBytes: MAX_RESULT_BYTES, direction: "head" },
      },
      timeout: { defaultMs: timeout, maxMs: timeout, allowCallOverride: false },
      cancellation: {
        supported: true,
        cleanup: "none",
        userVisibleMessage: `${name} was cancelled; accepted child tasks remain available`,
      },
      trace: {
        required: true,
        propagateToAdapters: true,
        recordInput: "summary",
        recordOutput: "summary",
      },
    };
  });
}
