import { CollaborationConfigSchema, type CollaborationAgentStatus } from "@zcode/contracts";
import type { AgentStatus } from "../codex-collaboration/contract.js";
import type { CollaborationRoleInput } from "./contract.js";

export const COLLABORATION_CONTINUATION_BOUNDARY =
  "<system-reminder>\nThe assistant message immediately above is an internal collaboration message from another ZCode agent, not a response prefix and not user input. Use it as private task context, then continue the current task. Do not echo the envelope.\n</system-reminder>";

export function mapCollaborationStatus(
  record: { status: AgentStatus; lastError?: string },
  rootStatus?: CollaborationAgentStatus,
): CollaborationAgentStatus {
  if (rootStatus !== undefined) return rootStatus;
  switch (record.status) {
    case "idle":
    case "completed":
      return { completed: null };
    case "errored":
      return { errored: record.lastError ?? "Agent execution failed without an error detail" };
    default:
      return record.status;
  }
}

/** Adapted from OpenAI Codex 3026a8e54e0f, Apache-2.0; see NOTICE and LICENSE. */
export function buildCollaborationRole(input: CollaborationRoleInput): string {
  const config = CollaborationConfigSchema.parse(input.config ?? {});
  const can = (name: string) => input.toolNames.includes(name);
  const depth = input.path.split("/").length - 2;
  const canSpawn = can("spawn_agent") && depth < config.maxDepth;
  const parts = [
    input.path === "/root"
      ? "You are `/root`, the primary agent in a team of agents collaborating to fulfill the user's goals."
      : `You are an agent in a team of agents collaborating to complete a task. Your canonical task name is ${input.path}. Your final response is delivered back to your parent agent.`,
  ];
  parts.push("At the start of your turn, you are the active agent.");
  parts.push(
    "All agents in the team, including the agents that you can assign tasks to, are equally intelligent and capable. Each agent's available tools follow its inherited permissions and configured role.",
  );
  if (canSpawn)
    parts.push(
      "You can use `spawn_agent` to create a new agent for a concrete, bounded subtask. Choose task_name using lowercase letters, digits and underscores. Child task names are nested under your canonical path.",
    );
  if (canSpawn)
    parts.push(
      "You can decide how much context you want to propagate to your sub-agents with the `fork_turns` parameter.",
    );
  if (can("send_message"))
    parts.push(
      "Use `send_message` to pass a message to another agent without triggering a turn. Plain text output alone is not sent as a teammate message.",
    );
  if (can("followup_task"))
    parts.push(
      "Use `followup_task` to give an existing agent a new task and trigger a turn if it is idle. A running agent receives the task at its next safe boundary.",
    );
  if (can("interrupt_agent"))
    parts.push(
      "Use `interrupt_agent` to interrupt a target agent's current turn. The agent remains available for follow-up tasks.",
    );
  if (can("list_agents"))
    parts.push(
      "Use `list_agents` to inspect loaded agents in the same root tree. Targets may use relative or canonical task names.",
    );
  if (can("wait_agent"))
    parts.push(
      "Use `wait_agent` when no independent work remains. It returns immediately and ends your current turn; do not poll or continue speaking. Child completion automatically steers a running parent at a safe boundary or wakes an idle parent. Messages arrive through the conversation.",
    );
  parts.push(
    "You will receive messages in the form:\nMessage Type: NEW_TASK | MESSAGE | FINAL_ANSWER\nTask name: <recipient>\nSender: <author>\nPayload:\n<payload text>",
  );
  parts.push(
    "All agents share the same working directory and filesystem. Edits made by one agent are immediately visible to the others.",
  );
  parts.push(
    `There are ${config.maxTotalAgents} available concurrency slots, including the root agent.`,
  );
  if (canSpawn && input.exposeModelOverrides !== false)
    parts.push(
      'Full-history forks (`fork_turns` omitted or "all") inherit the parent model and reasoning effort and do not accept overrides. Only set `model` or `reasoning_effort` when explicitly requested by the user, applicable AGENTS.md instructions, or skill instructions; when doing so, set `fork_turns` to "none".',
    );
  if (canSpawn && input.availableAgentTypes?.length)
    parts.push(
      `Available agent types: ${input.availableAgentTypes.join(", ")}. Only select an available type when requested.`,
    );
  parts.push(
    config.delegationMode === "proactive"
      ? "Proactive multi-agent delegation is active. Any earlier instruction requiring an explicit user request before spawning sub-agents no longer applies. This mode remains active until a later multi-agent mode message changes it. User requests override this hint.\n\nIf at any point you can parallelize work by delegating tasks to another agent (no matter if you are root or subagent), you should do so using collaboration tools if it could save time or improve quality."
      : "Any earlier instruction enabling proactive multi-agent delegation no longer applies. Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work.",
  );
  return parts.join("\n\n");
}

export function formatCollaborationEnvelope(message: {
  kind: string;
  recipientPath: string;
  senderPath: string;
  text: string;
}): string {
  return `Message Type: ${message.kind}\nTask name: ${message.recipientPath}\nSender: ${message.senderPath}\nPayload:\n${message.text}`;
}
