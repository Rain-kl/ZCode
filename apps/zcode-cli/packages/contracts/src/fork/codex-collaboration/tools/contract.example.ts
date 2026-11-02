import { SpawnAgentInputSchema, CollaborationConfigSchema } from "./contract.js";
export const collaborationToolExample = {
  config: CollaborationConfigSchema.parse({}),
  spawn: SpawnAgentInputSchema.parse({
    task_name: "worker",
    message: "Inspect the requested module",
  }),
};
