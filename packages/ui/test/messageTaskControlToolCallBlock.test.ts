import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import type { TaskChatToolCallTreeNode } from "@/lib/toolCallTree.js";
import { ToolCallBlock } from "@/ToolCallBlocks.js";
import { TaskOutputToolCallBlock } from "@/ToolCallBlocks/renderers/task-output.js";
import { TaskStopToolCallBlock } from "@/ToolCallBlocks/renderers/task-stop.js";
import type { ToolCallBlockRenderContext } from "@/ToolCallBlocks/shared.js";

const displayModel = {
  inlinePreview: { type: "none" as const },
  planResult: null,
  viewerSource: null,
  viewerLabelId: "codeViewer.viewCode" as const,
  showSummaryFileLink: false,
  showInput: false,
  showOutput: true,
  showKind: false,
};

function renderToolCall(toolCall: TaskChatToolCallTreeNode["toolCall"]) {
  return renderToStaticMarkup(
    createElement(
      ZCodeIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(ToolCallBlock, {
        toolCallNode: {
          toolCall,
          childToolCalls: [],
        },
        workspacePath: "/workspace",
      }),
    ),
  );
}

function renderDedicatedToolCall(
  Renderer: ComponentType<ToolCallBlockRenderContext>,
  toolCall: TaskChatToolCallTreeNode["toolCall"],
  overrides: Partial<ToolCallBlockRenderContext> = {},
) {
  return renderToStaticMarkup(
    createElement(
      ZCodeIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(Renderer, {
        toolCallNode: {
          toolCall,
          childToolCalls: [],
        },
        workspacePath: "/workspace",
        displayModel,
        viewerSource: null,
        rawFileSummaries: [],
        isRunning: false,
        statusLabel: "已执行",
        childToolList: null,
        showIcon: true,
        forceOpen: true,
        canToggle: true,
        ...overrides,
      }),
    ),
  );
}

describe("message and task control tool call routing", () => {
  it("routes TaskStop to a semantic summary", () => {
    const html = renderToolCall({
      toolId: "stop-1",
      toolName: "TaskStop",
      kind: "TaskStop",
      title: "TaskStop",
      input: {
        task_id: "task_alpha",
      },
      output: JSON.stringify({
        message: "Successfully stopped task: task_alpha",
        task_id: "task_alpha",
        task_type: "local_agent",
      }),
      status: "completed",
      raw: {},
    });

    expect(html).toContain("停止任务");
    expect(html).not.toContain("已停止任务");
    expect(html).toContain("task_alpha");
    expect(html).not.toContain("local_agent");
  });

  it("routes TaskOutput to its task status summary", () => {
    const html = renderToolCall({
      toolId: "output-1",
      toolName: "TaskOutput",
      kind: "TaskOutput",
      title: "TaskOutput",
      input: {
        task_id: "task_alpha",
        block: false,
        timeout: 0,
      },
      output: "<retrieval_status>success</retrieval_status>",
      status: "completed",
      raw: {
        display: {
          kind: "task_output",
          retrievalStatus: "success",
          taskStatus: "completed",
        },
      },
    });

    expect(html).toContain("任务输出");
    expect(html).toContain("task_alpha");
    expect(html).not.toContain("&lt;retrieval_status&gt;");
  });
});

describe("message and task control tool call details", () => {
  it("renders TaskStop fields from JSON output without raw JSON", () => {
    const html = renderDedicatedToolCall(TaskStopToolCallBlock, {
      toolId: "stop-details",
      toolName: "TaskStop",
      kind: "TaskStop",
      title: "TaskStop",
      input: {
        shell_id: "legacy_shell_alpha",
      },
      output: JSON.stringify({
        message: "Successfully stopped task: task_alpha (pnpm test)",
        task_id: "task_alpha",
        task_type: "background_shell",
        command: "pnpm test",
      }),
      status: "completed",
      raw: {
        rawOutput: {
          message: "raw fallback should not render",
        },
      },
    });

    expect(html).not.toContain("任务 ID");
    expect(html).toContain("task_alpha");
    expect(html).toContain("任务类型");
    expect(html).toContain("background_shell");
    expect(html).toContain("命令");
    expect(html).toContain("pnpm test");
    expect(html).toContain("结果");
    expect(html).toContain("Successfully stopped task: task_alpha");
    expect(html).not.toContain("Successfully stopped task: task_alpha (pnpm test)");
    expect(html.match(/pnpm test/gu)).toHaveLength(1);
    expect(html).not.toContain("raw fallback should not render");
    expect(html).not.toContain("&quot;task_id&quot;");
    expect(html).not.toContain("&quot;task_type&quot;");
  });

  it("renders a projected local agent command as a task description", () => {
    const html = renderDedicatedToolCall(TaskStopToolCallBlock, {
      toolId: "stop-local-agent-description",
      toolName: "TaskStop",
      kind: "TaskStop",
      title: "TaskStop",
      input: {
        task_id: "agent_alpha",
      },
      output: "Successfully stopped task: agent_alpha (检查赔率来源)",
      status: "completed",
      raw: {
        result: {
          display: {
            kind: "task_stop",
            taskId: "agent_alpha",
            taskType: "local_agent",
            command: "检查赔率来源",
            message: "Successfully stopped task: agent_alpha (检查赔率来源)",
          },
        },
      },
    });

    expect(html).toContain("任务描述");
    expect(html).not.toContain(">命令<");
    expect(html).toMatch(/<dt[^>]*>任务描述<\/dt><dd[^>]*>检查赔率来源<\/dd>/u);
  });

  it("does not expose a legacy local agent prompt as a task description", () => {
    const legacyPrompt = "请搜索多个来源并输出完整的世界杯赔率研究报告";
    const html = renderDedicatedToolCall(TaskStopToolCallBlock, {
      toolId: "stop-legacy-local-agent",
      toolName: "TaskStop",
      kind: "TaskStop",
      title: "TaskStop",
      input: {
        task_id: "agent_legacy",
      },
      output: JSON.stringify({
        message: `Successfully stopped task: agent_legacy (${legacyPrompt})`,
        task_id: "agent_legacy",
        task_type: "local_agent",
        command: legacyPrompt,
      }),
      status: "completed",
      raw: {},
    });

    expect(html).toContain("Successfully stopped task: agent_legacy");
    expect(html).not.toContain(legacyPrompt);
    expect(html).not.toContain("任务描述");
  });

  it("keeps a custom TaskStop result unchanged", () => {
    const html = renderDedicatedToolCall(TaskStopToolCallBlock, {
      toolId: "stop-custom-result",
      toolName: "TaskStop",
      kind: "TaskStop",
      title: "TaskStop",
      input: {
        task_id: "task_custom",
      },
      output: JSON.stringify({
        message: "Task stopped after cleanup completed.",
        task_id: "task_custom",
        task_type: "background_shell",
        command: "pnpm test",
      }),
      status: "completed",
      raw: {},
    });

    expect(html).toContain("Task stopped after cleanup completed.");
  });

  it.each([
    {
      name: "a live tool result",
      raw: {
        result: {
          display: {
            kind: "task_stop",
            taskId: "task_display",
            taskType: "background_shell",
            command: "pnpm test",
            message: "Successfully stopped task: task_display (pnpm test)",
          },
        },
      },
    },
    {
      name: "persisted tool metadata",
      raw: {
        display: {
          kind: "task_stop",
          taskId: "task_display",
          taskType: "background_shell",
          command: "pnpm test",
          message: "Successfully stopped task: task_display (pnpm test)",
        },
      },
    },
    {
      name: "a provider raw output",
      raw: {
        rawOutput: {
          display: {
            kind: "task_stop",
            taskId: "task_display",
            taskType: "background_shell",
            command: "pnpm test",
            message: "Successfully stopped task: task_display (pnpm test)",
          },
        },
      },
    },
  ])("renders projected TaskStop details from $name", ({ raw }) => {
    const html = renderDedicatedToolCall(TaskStopToolCallBlock, {
      toolId: "stop-projected-details",
      toolName: "TaskStop",
      kind: "TaskStop",
      title: "TaskStop",
      input: {
        task_id: "task_input",
      },
      output: '{"message":"model content"}\n\n[Hook additional context]\n#1\nextra context',
      status: "completed",
      raw,
    });

    expect(html).toContain("task_display");
    expect(html).toContain("background_shell");
    expect(html).toContain("pnpm test");
    expect(html).toContain("Successfully stopped task: task_display");
    expect(html).not.toContain("Successfully stopped task: task_display (pnpm test)");
    expect(html.match(/pnpm test/gu)).toHaveLength(1);
    expect(html).not.toContain("extra context");
  });

  it("shows when projected TaskStop details were truncated", () => {
    const html = renderDedicatedToolCall(TaskStopToolCallBlock, {
      toolId: "stop-truncated-details",
      toolName: "TaskStop",
      kind: "TaskStop",
      title: "TaskStop",
      input: {
        task_id: "task_large",
      },
      status: "completed",
      raw: {
        result: {
          display: {
            kind: "task_stop",
            taskId: "task_large",
            taskType: "background_shell",
            command: "long command\n...[truncated]",
            message: "Successfully stopped task\n...[truncated]",
            truncated: true,
          },
        },
      },
    });

    expect(html).toContain("部分任务详情已截断");
  });

  it("parses the explicit hook envelope for a legacy TaskStop result", () => {
    const html = renderDedicatedToolCall(TaskStopToolCallBlock, {
      toolId: "stop-legacy-hook-details",
      toolName: "TaskStop",
      kind: "TaskStop",
      title: "TaskStop",
      input: {
        task_id: "task_legacy",
      },
      output:
        '{"message":"Successfully stopped task: task_legacy (pnpm test)","task_id":"task_legacy","task_type":"background_shell","command":"pnpm test"}\n\n[Hook additional context]\n#1\nextra context',
      status: "completed",
      raw: {},
    });

    expect(html).toContain("background_shell");
    expect(html).toContain("pnpm test");
    expect(html).toContain("Successfully stopped task: task_legacy");
    expect(html).not.toContain("Successfully stopped task: task_legacy (pnpm test)");
    expect(html.match(/pnpm test/gu)).toHaveLength(1);
    expect(html).not.toContain("extra context");
  });

  it("uses failure wording when TaskStop execution fails", () => {
    const html = renderDedicatedToolCall(
      TaskStopToolCallBlock,
      {
        toolId: "stop-failure",
        toolName: "TaskStop",
        kind: "TaskStop",
        title: "TaskStop",
        input: {
          task_id: "task_missing",
        },
        status: "failed",
        raw: {},
      },
      {
        statusLabel: "执行失败",
        errorText: "No task found with ID: task_missing",
      },
    );

    expect(html).toContain("停止任务");
    expect(html).toContain("执行失败");
    expect(html).not.toContain("已停止任务");
  });

  it("renders a denied TaskStop reason as the expanded result", () => {
    const html = renderDedicatedToolCall(
      TaskStopToolCallBlock,
      {
        toolId: "stop-denied-details",
        toolName: "TaskStop",
        kind: "TaskStop",
        title: "TaskStop",
        input: {
          task_id: "task_denied",
        },
        status: "denied",
        raw: {},
      },
      {
        errorText: "TaskStop is disabled by policy",
      },
    );

    expect(html).toContain("结果");
    expect(html).toContain("TaskStop is disabled by policy");
  });

  it("does not make a stopped TaskStop expandable when no details exist", () => {
    const html = renderDedicatedToolCall(TaskStopToolCallBlock, {
      toolId: "stop-empty-details",
      toolName: "TaskStop",
      kind: "TaskStop",
      title: "TaskStop",
      input: {
        task_id: "task_stopped",
      },
      status: "stopped",
      raw: {},
    });

    expect(html).not.toContain('role="button"');
  });

  it("renders only bounded TaskOutput output and its truncation notice", () => {
    const output = "x".repeat(2_000);
    const html = renderDedicatedToolCall(TaskOutputToolCallBlock, {
      toolId: "output-details",
      toolName: "TaskOutput",
      kind: "TaskOutput",
      title: "TaskOutput",
      input: {
        task_id: "task_large",
        block: false,
        timeout: 0,
      },
      output: "<retrieval_status>success</retrieval_status>",
      status: "completed",
      raw: {
        result: {
          display: {
            kind: "task_output",
            retrievalStatus: "success",
            output,
            truncated: true,
          },
          description: "must stay hidden",
          error: "must stay hidden",
          outputFile: "/tmp/task.output",
        },
      },
    });

    expect(html).toContain("任务输出");
    expect(html).toContain("已获取");
    expect(html).toContain("task_large");
    expect(html).toContain(output);
    expect(html).toContain("后续内容已省略");
    expect(html).not.toContain("&lt;retrieval_status&gt;");
    expect(html).not.toContain("must stay hidden");
    expect(html).not.toContain("/tmp/task.output");
  });

  it("does not make TaskOutput expandable without projected output", () => {
    const html = renderDedicatedToolCall(TaskOutputToolCallBlock, {
      toolId: "output-empty",
      toolName: "TaskOutput",
      kind: "TaskOutput",
      title: "TaskOutput",
      input: {
        task_id: "task_empty",
        block: false,
        timeout: 0,
      },
      status: "completed",
      raw: {
        display: {
          kind: "task_output",
          retrievalStatus: "success",
        },
      },
    });

    expect(html).toContain("已获取");
    expect(html).not.toContain('role="button"');
  });

  it.each([
    {
      name: "running retrieval",
      status: "completed",
      isRunning: false,
      display: { retrievalStatus: "not_ready", taskStatus: "running" },
      expected: "任务运行中",
    },
    {
      name: "timed out retrieval",
      status: "completed",
      isRunning: false,
      display: { retrievalStatus: "timeout", taskStatus: "running" },
      expected: "等待超时",
    },
    {
      name: "failed task",
      status: "completed",
      isRunning: false,
      display: { retrievalStatus: "success", taskStatus: "failed" },
      expected: "任务失败",
    },
    {
      name: "stopped task",
      status: "completed",
      isRunning: false,
      display: { retrievalStatus: "success", taskStatus: "killed" },
      expected: "任务已停止",
    },
    {
      name: "tool execution",
      status: "in_progress",
      isRunning: true,
      display: undefined,
      expected: "正在获取任务输出",
    },
    {
      name: "tool failure",
      status: "failed",
      isRunning: false,
      display: undefined,
      expected: "执行失败",
    },
    {
      name: "denied tool",
      status: "denied",
      isRunning: false,
      display: undefined,
      expected: "已拒绝",
    },
    {
      name: "stopped tool",
      status: "stopped",
      isRunning: false,
      display: undefined,
      expected: "已停止",
    },
  ])("renders TaskOutput $name status", ({ status, isRunning, display, expected }) => {
    const html = renderDedicatedToolCall(
      TaskOutputToolCallBlock,
      {
        toolId: `output-${status}`,
        toolName: "TaskOutput",
        kind: "TaskOutput",
        title: "TaskOutput",
        input: { task_id: "task_status", block: false, timeout: 0 },
        status,
        raw: display
          ? {
              display: {
                kind: "task_output",
                ...display,
              },
            }
          : {},
      },
      {
        isRunning,
        errorText: status === "failed" ? "TaskOutput execution failed" : undefined,
      },
    );

    expect(html).toContain(expected);
  });
});

describe("message and task control terminal states", () => {
  it.each([
    { status: "stopped", expected: "已停止" },
    { status: "denied", expected: "已拒绝" },
  ])("does not present TaskStop $status as stopped successfully", ({ status, expected }) => {
    const html = renderToolCall({
      toolId: `stop-${status}`,
      toolName: "TaskStop",
      kind: "TaskStop",
      title: "TaskStop",
      input: {
        task_id: "task_alpha",
      },
      status,
      raw: {},
    });

    expect(html).toContain(expected);
    expect(html).toContain("停止任务");
  });
});
