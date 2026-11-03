export { createCollaborationToolEntries } from "./tools.js";
export {
  buildCollaborationRole,
  formatCollaborationEnvelope,
  mapCollaborationStatus,
} from "./prompts.js";
export type * from "./contract.js";
export const codexCollaborationToolsModule = {
  id: "codex-collaboration-tools",
  provides: ["collaboration-tool-entries", "collaboration-role"],
  requires: ["zcode-cli", "shared", "codex-collaboration-tools-contract", "codex-collaboration-controller", "tool-discovery"],
} as const;
