import {
  CollaborationError,
  type SpawnRequest,
  type AgentRecord,
  type AgentSettings,
} from "../contract.js";

export function nonempty(value: string, name: string): void {
  if (typeof value !== "string" || !value.trim())
    throw new CollaborationError("INVALID_INPUT", `${name} must not be empty`);
}
export function normalizeAgentSettings(request: SpawnRequest, caller: AgentRecord): AgentSettings {
  const input = request.settings ?? {};
  if (
    Object.keys(input).some(
      (key) => !["forkTurns", "agentType", "model", "reasoningEffort"].includes(key),
    )
  ) {
    throw new CollaborationError("INVALID_INPUT", "Unknown collaboration spawn setting");
  }
  const forkTurns = input.forkTurns ?? "all";
  if (forkTurns !== "all" && forkTurns !== "none")
    throw new CollaborationError("INVALID_INPUT", "forkTurns must be all or none");
  if (forkTurns === "all" && (input.model !== undefined || input.reasoningEffort !== undefined))
    throw new CollaborationError(
      "INVALID_INPUT",
      "forkTurns all inherits model/reasoning and rejects overrides",
    );
  for (const key of ["model", "agentType", "reasoningEffort"] as const)
    if (input[key] !== undefined) nonempty(input[key], key);
  return {
    forkTurns,
    ...(input.agentType ? { agentType: input.agentType } : {}),
    ...(forkTurns === "all"
      ? {
          ...(caller.settings.model ? { model: caller.settings.model } : {}),
          ...(caller.settings.reasoningEffort
            ? { reasoningEffort: caller.settings.reasoningEffort }
            : {}),
        }
      : {
          ...(input.model ? { model: input.model } : {}),
          ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
        }),
  };
}
