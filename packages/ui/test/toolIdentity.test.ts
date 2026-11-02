import { describe, expect, it } from "vitest";
import {
  isFileContentWriteToolCall,
  isFileDiffToolCall,
  resolveToolCallIdentity,
} from "../src/lib/toolIdentity.js";

describe("toolIdentity", () => {
  it("keeps fixed AskUserQuestion name while routing it as user-question family", () => {
    expect(
      resolveToolCallIdentity({
        toolName: "AskUserQuestion",
        kind: "AskUserQuestion",
        title: "AskUserQuestion",
        input: {
          questions: [
            {
              id: "q1",
              question: "选哪个方向？",
              options: [{ id: "a", label: "A" }],
            },
          ],
        },
      }),
    ).toMatchObject({
      toolName: "AskUserQuestion",
      family: "ask-user-question",
      isLegacy: false,
    });
  });

  it("does not classify TodoWrite as a file write tool", () => {
    const identity = resolveToolCallIdentity({
      kind: "TodoWrite",
      title: "TodoWrite",
      input: {
        todos: [{ content: "更新 UI", status: "pending", priority: "high" }],
      },
    });

    expect(identity).toMatchObject({
      toolName: "TodoWrite",
      family: "todo",
      isLegacy: false,
    });
    expect(isFileContentWriteToolCall({ kind: "TodoWrite" }, identity)).toBe(false);
    expect(isFileDiffToolCall({ kind: "TodoWrite" }, identity)).toBe(false);
  });

  it("classifies current fixed file tools without regex collisions", () => {
    const writeTool = { kind: "Write", input: { path: "a.ts" } };
    const editTool = { kind: "Edit", input: { path: "a.ts" } };
    const patchTool = { kind: "ApplyPatch", input: { patch: "..." } };

    expect(isFileContentWriteToolCall(writeTool)).toBe(true);
    expect(isFileDiffToolCall(writeTool)).toBe(false);
    expect(isFileContentWriteToolCall(editTool)).toBe(false);
    expect(isFileDiffToolCall(editTool)).toBe(true);
    expect(isFileDiffToolCall(patchTool)).toBe(true);
  });

  it.each(["Agent", "Task", "SendMessage", "RespondToCoordinator"])(
    "retires %s identity without legacy routing",
    (toolName) => {
      expect(resolveToolCallIdentity({ toolName, kind: "think", title: toolName })).toMatchObject({
        family: "unknown",
      });
    },
  );

  it.each([
    "spawn_agent",
    "followup_task",
    "send_message",
    "interrupt_agent",
    "list_agents",
    "wait_agent",
  ])("recognizes current collaboration tool %s", (toolName) => {
    expect(resolveToolCallIdentity({ toolName })).toMatchObject({
      toolName,
      family: toolName === "spawn_agent" ? "agent" : "collaboration",
      isLegacy: false,
    });
  });

  it.each(["TaskOutput", "TaskStop"])("preserves non-child task control %s", (toolName) => {
    expect(resolveToolCallIdentity({ toolName })).toMatchObject({
      toolName,
      family: "task-control",
    });
  });

  it("recognizes the snake_case submit_result as a workflow tool", () => {
    // 唯一一个 snake_case 现役工具名：下划线必须字面登记，否则动态工作流 actor 的提交
    // 会退回 unknown fallback。
    expect(
      resolveToolCallIdentity({
        toolName: "submit_result",
        kind: "submit_result",
        title: "submit_result",
      }),
    ).toMatchObject({
      toolName: "submit_result",
      family: "workflow",
      isLegacy: false,
    });
  });

  it("routes node repl tools through their dedicated presentation family", () => {
    for (const toolName of [
      "js",
      "js_reset",
      "js_add_node_module_dir",
      "mcp__node_repl__js",
      "mcp__node_repl__js_reset",
      "mcp__node_repl__js_add_node_module_dir",
    ]) {
      expect(
        resolveToolCallIdentity({
          toolName,
          kind: toolName,
          title: toolName,
        }),
      ).toMatchObject({
        toolName,
        family: "node-repl",
        isLegacy: false,
      });
    }
  });

  it("routes current no-separator ExitPlanMode names as switch mode", () => {
    expect(
      resolveToolCallIdentity({
        toolName: "ExitPlanMode",
        kind: "ExitPlanMode",
        title: "ExitPlanMode",
      }),
    ).toMatchObject({
      toolName: "switch_mode",
      family: "switch-mode",
      isLegacy: true,
    });
  });
});
