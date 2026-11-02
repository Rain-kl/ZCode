import { expect, it, vi } from "vitest";
import { createSessionId } from "@zcode/contracts";
import { taskOutputToolEntry } from "../../src/tool/handlers/task-output.js";
import { taskStopToolEntry } from "../../src/tool/handlers/task-stop.js";
import { InMemoryRuntimeTaskRegistry } from "../../src/runtime-task/registry.js";
import type { ToolExecutionContext } from "../../src/tool/types.js";

it("TaskOutput and TaskStop reject child identities before invoking background control", async () => {
  const registry = new InMemoryRuntimeTaskRegistry();
  registry.register({
    taskId: "child",
    agentId: "child",
    agentType: "worker",
    type: "local_agent",
    description: "child",
    status: "running",
    startedAt: new Date(),
  });
  const stop = vi.fn(async () => ({ ok: true, taskId: "child", type: "local_agent" }));
  const context: ToolExecutionContext = {
    abortSignal: new AbortController().signal,
    sessionId: createSessionId("tool-removal"),
    toolCallId: "call",
    traceId: "trace",
    workingDirectory: ".",
    workspaceRoot: ".",
    runtimeTaskRegistry: registry,
    backgroundTaskControlPort: { stopBackgroundTask: stop },
  };
  const output = await taskOutputToolEntry.handler(
    { task_id: "child", block: false, timeout: 0 },
    context,
  );
  expect(output).toEqual(expect.objectContaining({ result: false }));
  await expect(taskStopToolEntry.handler({ task_id: "child" }, context)).rejects.toThrow(
    "interrupt_agent",
  );
  expect(stop).not.toHaveBeenCalled();
});
