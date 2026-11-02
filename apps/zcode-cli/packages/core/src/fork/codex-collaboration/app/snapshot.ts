import { CollaborationError, type AgentRecord, type CollaborationSnapshot } from "../contract.js";

const NAME = /^[a-z0-9_]+$/;
const STATUSES = new Set(["idle", "running", "completed", "errored", "interrupted"]);
const KINDS = new Set(["NEW_TASK", "MESSAGE", "FINAL_ANSWER", "STATUS"]);
export function validTaskName(value: string): boolean {
  return NAME.test(value) && value !== "root";
}
export function validAgentPath(value: string): boolean {
  return (
    value === "/root" ||
    (value.startsWith("/root/") && value.slice(6).split("/").every(validTaskName))
  );
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function invalid(detail: string): never {
  throw new CollaborationError("INVALID_SNAPSHOT", `Invalid collaboration snapshot: ${detail}`);
}
function settings(value: unknown): boolean {
  if (
    !object(value) ||
    !keys(value, ["forkTurns", "agentType", "model", "reasoningEffort"]) ||
    (value.forkTurns !== "all" && value.forkTurns !== "none")
  )
    return false;
  return ["agentType", "model", "reasoningEffort"].every(
    (key) => value[key] === undefined || text(value[key]),
  );
}
/** Validate at the storage boundary, including references and canonical parent edges. */
export function parseCollaborationSnapshot(
  value: unknown,
  rootSessionId: string,
): CollaborationSnapshot {
  if (
    !object(value) ||
    !keys(value, ["version", "rootSessionId", "agents", "accepted"]) ||
    value.version !== 1 ||
    value.rootSessionId !== rootSessionId ||
    !Array.isArray(value.agents) ||
    !Array.isArray(value.accepted)
  )
    invalid("version/root/collections");
  const ids = new Set<string>();
  const sessions = new Set<string>();
  const paths = new Set<string>();
  const messages = new Set<string>();
  for (const agent of value.agents) {
    if (
      !object(agent) ||
      !keys(agent, [
        "agentId",
        "childSessionId",
        "path",
        "parentId",
        "traceId",
        "settings",
        "status",
        "generation",
        "mailbox",
        "lastError",
      ]) ||
      !text(agent.agentId) ||
      !text(agent.childSessionId) ||
      !text(agent.traceId) ||
      !text(agent.path) ||
      !validAgentPath(agent.path) ||
      typeof agent.status !== "string" ||
      !STATUSES.has(agent.status) ||
      !Number.isSafeInteger(agent.generation) ||
      Number(agent.generation) < 0 ||
      !Array.isArray(agent.mailbox) ||
      !settings(agent.settings) ||
      (agent.lastError !== undefined && typeof agent.lastError !== "string")
    )
      invalid("agent shape");
    if (ids.has(agent.agentId) || sessions.has(agent.childSessionId) || paths.has(agent.path))
      invalid("duplicate identity");
    ids.add(agent.agentId);
    sessions.add(agent.childSessionId);
    paths.add(agent.path);
  }
  const root = value.agents.find((agent) => agent.path === "/root");
  if (!root || root.parentId !== undefined || root.childSessionId !== rootSessionId)
    invalid("root identity");
  for (const agent of value.agents) {
    if (agent !== root) {
      const parent = value.agents.find((candidate) => candidate.agentId === agent.parentId);
      if (
        !parent ||
        agent.path.slice(0, agent.path.lastIndexOf("/")) !== parent.path ||
        agent.traceId !== root.traceId
      )
        invalid("parent/trace edge");
    }
    for (const message of agent.mailbox) {
      if (
        !object(message) ||
        !keys(message, ["id", "kind", "senderId", "recipientId", "text", "callId"]) ||
        !text(message.id) ||
        typeof message.kind !== "string" ||
        !KINDS.has(message.kind) ||
        !text(message.senderId) ||
        !ids.has(message.senderId) ||
        message.recipientId !== agent.agentId ||
        typeof message.text !== "string" ||
        (message.callId !== undefined && !text(message.callId)) ||
        messages.has(message.id)
      )
        invalid("mailbox message");
      messages.add(message.id);
    }
  }
  const calls = new Set<string>();
  const acceptedAgents = new Set<string>();
  for (const entry of value.accepted) {
    if (
      !object(entry) ||
      !keys(entry, ["callerId", "callId", "fingerprint", "agentId"]) ||
      !text(entry.callerId) ||
      !ids.has(entry.callerId) ||
      !text(entry.callId) ||
      !text(entry.fingerprint) ||
      !text(entry.agentId) ||
      !ids.has(entry.agentId) ||
      entry.agentId === root.agentId ||
      calls.has(JSON.stringify([entry.callerId, entry.callId])) ||
      acceptedAgents.has(entry.agentId) ||
      value.agents.find((agent) => agent.agentId === entry.agentId)?.parentId !== entry.callerId
    )
      invalid("accepted call reference");
    calls.add(JSON.stringify([entry.callerId, entry.callId]));
    acceptedAgents.add(entry.agentId);
  }
  // The checked wire shape is cloned so callers cannot mutate the owner's snapshot.
  return structuredClone(value) as unknown as CollaborationSnapshot;
}
export function resolveAgent(
  agents: readonly AgentRecord[],
  callerId: string,
  target: string,
): AgentRecord {
  const caller = agents.find((agent) => agent.agentId === callerId);
  if (!caller)
    throw new CollaborationError("NOT_FOUND", "Caller is outside this collaboration tree", {
      callerId,
    });
  const byId = agents.find((agent) => agent.agentId === target);
  if (byId) return byId;
  const path = target.startsWith("/") ? target : `${caller.path}/${target}`;
  if (!validAgentPath(path))
    throw new CollaborationError(
      "INVALID_INPUT",
      "Target must be a canonical tree path or known ID",
      { target },
    );
  const found = agents.find((agent) => agent.path === path);
  if (!found)
    throw new CollaborationError("NOT_FOUND", "Agent is not in this collaboration tree", {
      target,
    });
  return found;
}
