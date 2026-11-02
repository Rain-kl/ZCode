import type {
  AgentIdentity,
  AgentRecord,
  AgentStatus,
  CollaborationSnapshot,
  SpawnRequest,
} from "./data.js";
export interface WaitResult {
  reason: "activity" | "steered" | "timeout";
  message: string;
  timedOut: boolean;
  timeoutMs: number;
}
export interface CollaborationController {
  /** Derived projections only; observer errors never roll back a durable command. */
  subscribe(listener: (snapshot: CollaborationSnapshot) => void): () => void;
  spawn(request: SpawnRequest, options?: { signal?: AbortSignal }): Promise<AgentIdentity>;
  send(callerId: string, target: string, message: string): Promise<void>;
  followup(callerId: string, target: string, message: string): Promise<void>;
  interrupt(
    callerId: string,
    target: string,
  ): Promise<{ previousStatus: AgentStatus | "not_found" }>;
  list(callerId: string, pathPrefix?: string): AgentRecord[];
  get(callerId: string, target: string): AgentRecord;
  wait(
    callerId: string,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<WaitResult>;
  steer(agentId: string): void;
  /** Retry retained mailbox through its unique installed runtime sink. Does not start a turn. */
  deliver(callerId: string, target: string): Promise<void>;
  unload(callerId: string, target: string): Promise<void>;
  /** Completes queued persistence/delivery; exposes asynchronous completion failures. */
  flush(): Promise<void>;
  dispose(): Promise<void>;
}
