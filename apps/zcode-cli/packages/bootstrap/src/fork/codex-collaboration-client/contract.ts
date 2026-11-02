import type { CollaborationAgentRuntimeStatus } from "@zcode/core";
import type {
  CollaborationIdentityMetadata,
  MessageWithParts,
  SessionInfo,
  SessionStorePort,
} from "@zcode/contracts";
export interface CollaborationChildFact extends CollaborationIdentityMetadata {
  parentToolCallId: string;
  status: "running" | "success" | "failed" | "cancelled";
  summaryText: string;
}
export interface CollaborationChildren {
  rootSessionId?: string;
  children: CollaborationChildFact[];
}
export interface ReadCollaborationChildrenInput {
  store: SessionStorePort;
  session: SessionInfo;
  messages: readonly MessageWithParts[];
  /** Exact current controller fact. Absence never initializes an owner. */
  getAgentStatus?: (
    rootSessionId: string,
    agentId: string,
  ) => CollaborationAgentRuntimeStatus | undefined;
}
