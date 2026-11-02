export type {
  CollaborationToolPort,
  CollaborationConfig,
  CollaborationAgentStatus,
} from "@zcode/contracts";
export interface CollaborationRoleInput {
  path: string;
  config?: Partial<import("@zcode/contracts").CollaborationConfig>;
  toolNames: readonly string[];
  availableAgentTypes?: readonly string[];
  exposeModelOverrides?: boolean;
}
