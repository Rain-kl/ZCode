import type { ToolCallBlockRenderContext } from "@/ToolCallBlocks/shared.js";

// FORK(codex-collaboration): 下钻标题只取新 spawn 参数，与可见摘要一致，不解析旧 ACK 或 output_file。
export function getAgentPrimaryText(
  toolCall: ToolCallBlockRenderContext["toolCallNode"]["toolCall"],
  fallbackLabel: string,
): string {
  const input = toolCall.input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const key of ["task_name", "agent_type"] as const) {
      const value = (input as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return fallbackLabel;
}
