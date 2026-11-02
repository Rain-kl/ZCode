export type AgentStatus = "idle" | "running" | "completed" | "errored" | "interrupted";
export type MessageKind = "NEW_TASK" | "MESSAGE" | "FINAL_ANSWER" | "STATUS";
export interface CollaborationMessage {
  id: string;
  kind: MessageKind;
  senderId: string;
  recipientId: string;
  text: string;
  callId?: string;
}
export interface AgentIdentity {
  agentId: string;
  childSessionId: string;
  path: string;
  parentId?: string;
  traceId: string;
  settings: AgentSettings;
}
export interface AgentSettings {
  forkTurns: "all" | "none";
  agentType?: string;
  model?: string;
  reasoningEffort?: string;
}
export interface AgentRecord extends AgentIdentity {
  status: AgentStatus;
  generation: number;
  mailbox: CollaborationMessage[];
  lastError?: string;
}
export interface SpawnRequest {
  callerId: string;
  callId: string;
  taskName: string;
  message: string;
  settings?: Partial<AgentSettings>;
}
export interface AcceptedSpawn {
  callerId: string;
  callId: string;
  fingerprint: string;
  agentId: string;
}
export interface CollaborationSnapshot {
  version: 1;
  rootSessionId: string;
  agents: AgentRecord[];
  accepted: AcceptedSpawn[];
}
export interface RunResult {
  status: "completed" | "errored";
  text: string;
}
export type CollaborationErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "DUPLICATE_NAME"
  | "CALL_ID_CONFLICT"
  | "CAPACITY"
  | "DEPTH"
  | "PERSISTENCE_REQUIRED"
  | "INVALID_SNAPSHOT"
  | "STORAGE_FAILED"
  | "RUNTIME_FAILED"
  | "DELIVERY_FAILED"
  | "CANCELLED"
  | "CLOSED";
export class CollaborationError extends Error {
  constructor(
    readonly code: CollaborationErrorCode,
    message: string,
    readonly context: Readonly<Record<string, string | number>> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "CollaborationError";
  }
}
