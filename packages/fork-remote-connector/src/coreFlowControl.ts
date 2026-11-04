import type { MessagePortFlowControl, MessagePortFlowState } from "@zcode/rpc";

/** 与既有 MessagePort 控制消息保持相同语义；身份始终由 Core 的 socket scope 绑定。 */
export function encodeCoreFlowState(state: MessagePortFlowState): string {
  return JSON.stringify({
    __zcodeRpcControl: "connection-flow-v1",
    state,
  } satisfies MessagePortFlowControl);
}

export function parseCoreFlowState(text: string): MessagePortFlowState | null {
  if (text.length > 128) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return record.__zcodeRpcControl === "connection-flow-v1" &&
    (record.state === "saturated" || record.state === "drained") &&
    Object.keys(record).length === 2
    ? record.state
    : null;
}
