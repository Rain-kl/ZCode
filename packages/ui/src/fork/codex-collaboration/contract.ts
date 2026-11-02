export const collaborationActionLabelIds = {
  spawn_agent: "chat.toolCall.collaboration.spawn",
  followup_task: "chat.toolCall.collaboration.followup",
  send_message: "chat.toolCall.collaboration.send",
  interrupt_agent: "chat.toolCall.collaboration.interrupt",
  list_agents: "chat.toolCall.collaboration.list",
  wait_agent: "chat.toolCall.collaboration.wait",
} as const;
export type CollaborationActionName = keyof typeof collaborationActionLabelIds;
export function collaborationActionName(
  value: string | null | undefined,
): CollaborationActionName | undefined {
  return value && Object.hasOwn(collaborationActionLabelIds, value)
    ? (value as CollaborationActionName)
    : undefined;
}
