import type {
  CollaborationToolPort,
  ModelToolContract,
  CollaborationIdentityMetadata,
  SessionId,
  TraceContext,
} from "@zcode/contracts";
import type { AgentProfile } from "../../subagent/profile.js";
import type { RuntimeMessageEntry } from "../../agent/message-history.js";
import type { AgentStatus } from "../codex-collaboration/contract.js";
export type CollaborationAgentRuntimeStatus = AgentStatus;
export interface RuntimeCollaborationBinding {
  readonly port: CollaborationToolPort;
  /** Read-only subtree liveness from canonical records and original command resource handles. */
  hasRunningWork(): boolean;
  /** Exact child state from the initialized controller only; never initializes or reads storage. */
  getAgentStatus(agentId: string): CollaborationAgentRuntimeStatus | undefined;
  /** Provider boundary: deliver retained mail, consume durable receipts and render current capabilities. */
  beforeModel(
    tools: readonly ModelToolContract[],
  ): Promise<{ role: string; entries: RuntimeMessageEntry[] }>;
  userInputAccepted(): void;
  interruptChild(agentId: string): Promise<boolean>;
  shutdown(): Promise<void>;
  flush(): Promise<void>;
}
export const COLLABORATION_SESSION_ENTRY = "codex_collaboration";
export type { CollaborationIdentityMetadata };
export interface PreparedChildRequest {
  agentId: string;
  agentType: string;
  sessionId: SessionId;
  profile: AgentProfile;
  allowedTools: readonly string[];
  disallowedTools?: readonly string[];
  permissionMode?: AgentProfile["permissionMode"];
  workingDirectory: string;
  workspaceRoot: string;
  traceContext: TraceContext;
}
