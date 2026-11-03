import { BotIcon } from "lucide-react";
import { useCallback } from "react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ToolLayout } from "@/ToolCallBlocks/ToolLayout.js";
import { ToolSnapshotFieldNotice } from "@/ToolCallBlocks/ToolSnapshotFieldNotice.js";
import type { ToolCallBlockRenderContext } from "@/ToolCallBlocks/shared.js";
import { collaborationActionLabelIds, collaborationActionName } from "./contract.js";

function textField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const text = (value as Record<string, unknown>)[field];
  return typeof text === "string" && text.trim() ? text : undefined;
}
export function CollaborationToolCallBlock(context: ToolCallBlockRenderContext) {
  const { intl } = useZCodeIntl();
  const tool = context.toolCallNode.toolCall;
  const name = collaborationActionName(tool.toolName ?? tool.kind);
  const label = intl.formatMessage({
    id: name ? collaborationActionLabelIds[name] : "chat.toolCall.kind.agent",
  });
  const target =
    name === "spawn_agent" ? textField(tool.input, "task_name") : textField(tool.input, "target");
  const message = textField(tool.input, "message");
  const agentType = context.authoritativeAgentType ?? textField(tool.input, "agent_type");
  const output = typeof tool.output === "string" && tool.output !== "{}" ? tool.output : undefined;
  const fields = [
    ["chat.toolCall.collaboration.target", target],
    ["chat.toolCall.collaboration.message", message],
    ["chat.toolCall.collaboration.agentType", agentType],
    ["chat.toolCall.collaboration.pathPrefix", textField(tool.input, "path_prefix")],
    ["chat.toolCall.collaboration.forkTurns", textField(tool.input, "fork_turns")],
    ["chat.toolCall.collaboration.model", textField(tool.input, "model")],
    ["chat.toolCall.collaboration.reasoningEffort", textField(tool.input, "reasoning_effort")],
    [
      "chat.toolCall.collaboration.timeout",
      tool.input &&
      typeof tool.input === "object" &&
      "timeout_ms" in tool.input &&
      typeof tool.input.timeout_ms === "number"
        ? String(tool.input.timeout_ms)
        : undefined,
    ],
    ["chat.toolCall.collaboration.result", context.errorText ?? output],
  ].filter(
    (field): field is [string, string] => typeof field[1] === "string" && field[1].length > 0,
  );
  const renderContent = useCallback(
    () => (
      <dl className="space-y-3 rounded-lg border border-border bg-panel px-4 py-3">
        {fields.map(([id, value]) => (
          <div key={id}>
            <dt className="text-ui-sm text-foreground-subtle">{intl.formatMessage({ id })}</dt>
            <dd className="whitespace-pre-wrap break-words text-ui-base text-foreground">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    ),
    [fields, intl],
  );
  const failed = tool.status === "failed";
  const stopped = tool.status === "stopped";
  const status = failed
    ? "chat.toolCall.status.failed"
    : stopped
      ? "chat.toolCall.status.stopped"
      : undefined;
  return (
    <>
      <ToolLayout
        toolId={tool.toolId}
        icon={<BotIcon className="size-4 shrink-0 text-foreground-subtle" />}
        showIcon={context.showIcon !== false}
        kindLabel={label}
        primaryText={<span className="min-w-0 truncate">{target ?? label}</span>}
        secondaryText={agentType}
        isRunning={context.isRunning}
        sourceLabel={context.sourceLabel}
        summaryAction={
          context.agentSummaryAction
            ? {
                ...context.agentSummaryAction,
                ariaLabel: intl.formatMessage({ id: "chat.toolCall.collaboration.open" }),
              }
            : undefined
        }
        canToggle={fields.length > 0 && (context.canToggle ?? true)}
        forceOpen={fields.length > 0 && (context.forceOpen ?? false)}
        renderContent={fields.length ? renderContent : undefined}
        showFailureStatus={failed}
        statusLabel={status ? intl.formatMessage({ id: status }) : undefined}
        showStatusLabel={Boolean(status)}
        statusTooltip={context.errorText}
      />
      <ToolSnapshotFieldNotice
        refs={tool.snapshotRefs ?? []}
        onLoadFullToolCallFields={
          context.onLoadFullToolCallFields
            ? () => context.onLoadFullToolCallFields?.(tool.toolId)
            : undefined
        }
      />
    </>
  );
}
