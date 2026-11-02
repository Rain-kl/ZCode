export * from "./contract.js";
export const codexCollaborationToolsContractModule = {
  id: "codex-collaboration-tools-contract",
  provides: ["collaboration-tool-schemas"],
  requires: ["zcode-cli"],
} as const;
