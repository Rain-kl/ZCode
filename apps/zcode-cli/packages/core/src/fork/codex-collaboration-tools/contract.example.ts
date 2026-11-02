import { buildCollaborationRole } from "./module.js";
export const collaborationRoleExample = buildCollaborationRole({
  path: "/root",
  toolNames: ["spawn_agent", "send_message", "wait_agent"],
});
