import type { RuntimeCollaborationBinding } from "./contract.js";
export async function selectedChildStop(binding: RuntimeCollaborationBinding, agentId: string) {
  return binding.interruptChild(agentId);
}
