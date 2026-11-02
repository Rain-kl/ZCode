import type {
  AgentIdentity,
  CollaborationMessage,
  CollaborationSnapshot,
  RunResult,
} from "./data.js";
/** Admission must not execute a model. run() is invoked once, after durable acceptance. */
export interface TurnAdmission {
  run(): Promise<RunResult>;
  cancel(): Promise<void>;
}
export interface CollaborationRuntime {
  installMailbox(): Promise<void>;
  /** Read-only activity owned by the driver after durable ACK, before model consumption. */
  hasUnreadMessages(): boolean;
  /** ACK transfers ownership durably; repeated message IDs must be idempotent. */
  deliver(message: CollaborationMessage): Promise<{ messageId: string }>;
  /** A resumed turn keeps the existing transcript. No model IO before run(). */
  admit(request: {
    task: CollaborationMessage;
    generation: number;
    signal: AbortSignal;
  }): Promise<TurnAdmission>;
}
export interface CollaborationRuntimeDriver {
  prepare(identity: AgentIdentity, options: { resume: boolean }): Promise<CollaborationRuntime>;
  /** Idempotent cleanup; runtime may be absent after a cold unaccepted reservation.
   * discard only an unaccepted session; never discard accepted history. */
  release(
    identity: AgentIdentity,
    runtime: CollaborationRuntime | undefined,
    options: { discard: boolean },
  ): Promise<void>;
}
export interface CollaborationStorage {
  mode: "persistent" | "memory";
  read(): Promise<unknown>;
  /** Atomic root session entry replacement; rejection must leave previous entry intact. */
  write(snapshot: CollaborationSnapshot): Promise<void>;
}
export interface CollaborationClock {
  schedule(delayMs: number, callback: () => void): () => void;
}
export interface ControllerOptions {
  root: AgentIdentity;
  rootRuntime: CollaborationRuntime;
  runtime: CollaborationRuntimeDriver;
  storage?: CollaborationStorage;
  persistence: "persistent" | "memory";
  clock: CollaborationClock;
  createId(kind: "agent" | "session" | "message"): string;
  maxTotalAgents?: number;
  maxLoadedChildren?: number;
  maxDepth?: number;
}
