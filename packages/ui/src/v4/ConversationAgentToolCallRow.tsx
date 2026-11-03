import { useCallback, useMemo } from "react";
import { TID_V4_ROW, TID_V4_SUBAGENT_OPEN_SIDE_PANE, testId } from "@zcode/shared/test-ids";
import { ToolCallBlock } from "@/ToolCallBlocks.js";
import { getAgentPrimaryText } from "@/ToolCallBlocks/renderers/agentHelpers.js";
import type { ConversationAssistantWorkRenderItem } from "@/v4/conversationAssistantWorkItems.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";
import { toolCallRowToLegacyNode } from "@/v4/toolCallRowAdapter.js";
import { runUserAction } from "@/lib/userActionTelemetry.js";

export function openSubagentSessionFromSummary({
  backgrounded: _backgrounded = false,
  childSessionId,
  context,
  subagentType,
  title,
}: {
  backgrounded?: boolean;
  childSessionId?: string;
  context: ConversationRowRenderContext;
  subagentType: string;
  title: string;
}): boolean {
  const parentSessionId = context.sessionId;
  const onOpenSubagentSession = context.onOpenSubagentSession;
  if (!childSessionId || !parentSessionId || !onOpenSubagentSession) {
    return false;
  }

  onOpenSubagentSession({
    rootSessionId: context.rootSessionId ?? parentSessionId,
    parentSessionId,
    childSessionId,
    subagentType,
    title,
  });
  return true;
}

export function ConversationAgentToolCallRow({
  item,
  context,
}: {
  item: Extract<ConversationAssistantWorkRenderItem, { kind: "agentToolCall" }>;
  context: ConversationRowRenderContext;
}) {
  // FORK(codex-collaboration): 配对后展示唯一 lifecycle 的状态；spawn 工具 ACK 不代表 child 完成。
  const toolCallNode = useMemo(() => {
    const node = toolCallRowToLegacyNode(item.row);
    return {
      ...node,
      toolCall: {
        ...node.toolCall,
        // FORK(codex-collaboration): 配对隐藏独立 child 行后仍须展示其原始失败原因，不能只留下成功 spawn ACK。
        error:
          item.subagentRow.status === "failed" ? item.subagentRow.summaryText : node.toolCall.error,
        status:
          item.subagentRow.status === "running"
            ? "in_progress"
            : item.subagentRow.status === "cancelled"
              ? "stopped"
              : item.subagentRow.status === "failed"
                ? "failed"
                : "completed",
      },
    };
  }, [item.row, item.subagentRow.status, item.subagentRow.summaryText]);
  const childSessionId = item.subagentRow.childSessionId;
  const subagentType = item.subagentRow.subagentType;
  // 与 Agent 摘要行复用同一 title resolver，保证右侧 tab 和用户点击的可见标题逐字一致。
  const title = getAgentPrimaryText(toolCallNode.toolCall, "");
  const canOpenChildSession = Boolean(
    childSessionId && context.sessionId && context.onOpenSubagentSession,
  );
  const handleOpenChildSession = useCallback(() => {
    runUserAction({
      input: { featureId: "conversation.subagent", action: "open_side_pane", trigger: "button" },
      operation: () =>
        openSubagentSessionFromSummary({ childSessionId, context, subagentType, title }),
      completed: { resultSource: "local_commit" },
      failureStage: "subagent_open",
    });
  }, [childSessionId, context, subagentType, title]);
  const agentSummaryAction = useMemo(
    () =>
      canOpenChildSession && childSessionId
        ? {
            onActivate: handleOpenChildSession,
            testId: testId(TID_V4_SUBAGENT_OPEN_SIDE_PANE, childSessionId),
          }
        : undefined,
    [canOpenChildSession, childSessionId, handleOpenChildSession],
  );

  // Agent 工具行和普通工具行同属工作流，不能在配对壳上额外加 px-4，
  // 否则会和未配对 toolCall 行产生左右缩进差异。
  return (
    <div
      data-row-id={item.row.rowId}
      data-conversation-selectable="true"
      data-testid={testId(TID_V4_ROW, String(item.row.rowId))}
    >
      <ToolCallBlock
        toolCallNode={toolCallNode}
        workspacePath={context.workspacePath}
        theme={context.theme}
        codePreviewSettings={context.codePreviewSettings}
        showTodoToolCalls={context.messageStreamShowTodos === true}
        onOpenCodeViewer={context.onOpenCodeViewer}
        onOpenFileLink={context.onOpenFileLink}
        onOpenBrowserUrl={context.onOpenBrowserUrl}
        onOpenAutomationsMain={context.onOpenAutomationsMain}
        agentSummaryAction={agentSummaryAction}
        authoritativeAgentType={subagentType}
      />
    </div>
  );
}
