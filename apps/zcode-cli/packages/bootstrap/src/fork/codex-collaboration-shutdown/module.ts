export { ProtocolRuntimeResources } from "./app-resources.js";
export { cleanupProtocolRuntime } from "./runtime-cleanup.js";
export type { ProtocolAppFactory, ProtocolRuntimeCleanupOptions } from "./contract.js";

export const codexCollaborationShutdownModule = {
  id: "codex-collaboration-shutdown",
  requires: ["zcode-cli"],
  provides: ["codex-collaboration-shutdown"],
  publicEntrypoints: ["module.ts", "contract.ts"],
} as const;
