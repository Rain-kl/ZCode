import type { AgentIdentity, CollaborationController } from "./contract.js";

/** Tool adapters pass the provider's stable tool-call ID through unchanged. */
export async function exampleDelegation(
  controller: CollaborationController,
  rootId: string,
): Promise<AgentIdentity> {
  return controller.spawn({
    callerId: rootId,
    callId: "spawn-tool-call-1",
    taskName: "review",
    message: "Review the change",
  });
}
