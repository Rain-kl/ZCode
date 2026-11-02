// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
afterEach(cleanup);
import { ZCodeIntlProvider } from "../src/i18n/IntlProvider.js";
import { ToolCallBlock } from "../src/ToolCallBlocks.js";
import { buildAssistantWorkRenderItems } from "../src/v4/conversationAssistantWorkItems.js";
import type { SubagentRow, ToolCallRow } from "@zcode/shared/zcode-protocol-v4";
const names = [
  "spawn_agent",
  "followup_task",
  "send_message",
  "interrupt_agent",
  "list_agents",
  "wait_agent",
];
it.each([
  ["wait_agent", { timeout_ms: 1234 }, "1234"],
  ["list_agents", { path_prefix: "/root/worker" }, "/root/worker"],
  [
    "spawn_agent",
    { task_name: "worker", message: "Work", fork_turns: "none", model: "test-model" },
    "test-model",
  ],
] as const)("shows the actual %s parameters", (toolName, input, value) => {
  render(
    createElement(
      ZCodeIntlProvider,
      { initialLocale: "en-US" },
      createElement(ToolCallBlock, {
        workspacePath: "/workspace",
        toolCallNode: {
          toolCall: {
            toolId: `params-${toolName}`,
            toolName,
            kind: toolName,
            status: "completed",
            input,
            output: "{}",
          },
          childToolCalls: [],
        },
      }),
    ),
  );
  const trigger = screen.queryByRole("button", { name: /tool details/ });
  if (trigger?.getAttribute("aria-expanded") !== "true" && trigger) fireEvent.click(trigger);
  expect(screen.getByText(value)).toBeTruthy();
});
it.each(names)("intentionally renders %s with readable label and details", (toolName) => {
  const element = createElement(
    ZCodeIntlProvider,
    { initialLocale: "en-US" },
    createElement(ToolCallBlock, {
      workspacePath: "/workspace",
      toolCallNode: {
        toolCall: {
          toolId: "call",
          toolName,
          kind: toolName,
          status: "completed",
          input: {
            target: "/root/worker",
            task_name: "worker",
            message: "Continue the verification",
          },
          output: "{}",
        },
        childToolCalls: [],
      },
    }),
  );
  const html = renderToStaticMarkup(element);
  expect(html).not.toContain("Stop Task");
  expect(html).not.toContain("chat.toolCall.collaboration.");
  expect(html).toContain(
    toolName === "spawn_agent"
      ? "worker"
      : toolName === "list_agents"
        ? "List agents"
        : toolName === "wait_agent"
          ? "Wait for agents"
          : "/root/worker",
  );
  if (["send_message", "followup_task", "spawn_agent"].includes(toolName)) {
    render(element);
    const trigger = screen.getByRole("button", { name: /tool details/ });
    if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
    expect(screen.getByText("Continue the verification")).toBeTruthy();
  }
});
describe("spawn-only exact-anchor pairing", () => {
  it("does not attach a child to followup, list, or wait and requires the original anchor", () => {
    const base = { turnId: "turn", createdAt: 1, createdAtSeq: 1 };
    const tool = (rowId: number, toolName: string): ToolCallRow => ({
      ...base,
      rowId,
      kind: "toolCall",
      toolCallId: `call-${rowId}`,
      toolName,
      status: "success",
      inputText: "",
    });
    const child: SubagentRow = {
      ...base,
      rowId: 7,
      kind: "subagent",
      parentToolCallId: "call-1",
      childSessionId: "session-random-f91",
      subagentType: "worker",
      status: "running",
      summaryText: "work",
    };
    const items = buildAssistantWorkRenderItems(
      [
        tool(1, "spawn_agent"),
        tool(2, "followup_task"),
        tool(3, "list_agents"),
        tool(4, "wait_agent"),
        child,
      ],
      { messageStreamShowReasoning: true },
    );
    expect(items.filter((item) => item.kind === "agentToolCall")).toMatchObject([
      { row: { toolName: "spawn_agent" }, subagentRow: { childSessionId: "session-random-f91" } },
    ]);
    const unanchored = buildAssistantWorkRenderItems(
      [tool(1, "spawn_agent"), { ...child, parentToolCallId: undefined }],
      { messageStreamShowReasoning: true },
    );
    expect(unanchored.filter((item) => item.kind === "agentToolCall")).toEqual([]);
  });
});
