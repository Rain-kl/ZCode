export { createCollaborationController } from "./app/controller.js";
export { parseCollaborationSnapshot } from "./app/snapshot.js";
export type * from "./contract.js";

export const codexCollaborationControllerModule = {
  id: "codex-collaboration-controller",
  requires: [],
  provides: ["root-owned-collaboration"],
  publicEntrypoints: ["contract.ts", "module.ts"],
} as const;
