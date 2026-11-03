export { CollaborationToolCallBlock } from "./renderer.js";
export { collaborationActionName, collaborationActionLabelIds } from "./contract.js";
export const codexCollaborationUiModule = {
  id: "codex-collaboration-ui",
  provides: ["six-tool-presentation"],
  requires: ["ui", "shared"],
} as const;
