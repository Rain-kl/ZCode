export { createRuntimeCollaborationBinding } from "./bridge.js";
export {
  readCollaborationRootEntry,
  readCollaborationRelation,
  relationFromSnapshot,
} from "./persistence.js";
export type { CollaborationRootEntry } from "./persistence.js";
export type * from "./contract.js";
export { COLLABORATION_SESSION_ENTRY } from "./contract.js";
export const codexCollaborationRuntimeModule = {
  id: "codex-collaboration-runtime",
  provides: ["runtime-collaboration"],
  requires: [
    "zcode-cli",
    "shared",
    "codex-collaboration-controller",
    "codex-collaboration-tools",
    "codex-collaboration-tools-contract",
  ],
} as const;
