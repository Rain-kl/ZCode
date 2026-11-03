import { expect, it, vi } from "vitest";
import { createSessionId, SESSION_ENTRY_MODEL_SELECTION, SessionEventType } from "@zcode/contracts";
import { AgentRuntime } from "../../src/runtime/agent-runtime.js";
import type { AgentRuntimeInternal } from "../../src/runtime/internal.js";
import * as controllerModule from "../../src/fork/codex-collaboration/module.js";
import type { CollaborationController } from "../../src/fork/codex-collaboration/contract.js";
import { createTestAgentRuntime } from "../../tests/test-agent-runtime.js";
import { createTestModelFactory } from "../../tests/test-runtime-model.js";
import { createRecordingSubagentSessionStore } from "../../tests/subagent-test-store.js";
import { createTestSessionEventStore } from "../../tests/test-event-store.js";
import { done, gate, tool } from "./fixture.js";

it.each(["eviction", "unload"] as const)(
  "%s drains an interrupted command waiting at its second model boundary without a controller lane cycle",
  async (operation) => {
    const boundaryReached = gate();
    const modelStarted = gate();
    const releaseModel = gate();
    const projectionStarted = gate();
    const releaseProjection = gate();
    const toolEnded = gate();
    const releaseStarted = gate();
    const store = createRecordingSubagentSessionStore();
    const entries = store.sessionEntries!.bind(store);
    const rootId = createSessionId(`eviction-boundary-${operation}`);
    let blockProjection = false;
    store.sessionEntries = async (input) => {
      if (
        blockProjection &&
        input.type === SESSION_ENTRY_MODEL_SELECTION &&
        input.sessionID !== rootId
      ) {
        projectionStarted.resolve();
        await releaseProjection.promise;
      }
      return entries(input);
    };
    const events = createTestSessionEventStore();
    const append = events.append.bind(events);
    events.append = async (event) => {
      if (event.sessionId !== rootId && event.type === SessionEventType.ToolCallResult)
        toolEnded.resolve();
      return append(event);
    };
    let tree: CollaborationController | undefined;
    let rootAgentId = "";
    const create = controllerModule.createCollaborationController;
    const controllerSpy = vi
      .spyOn(controllerModule, "createCollaborationController")
      .mockImplementation(async (options) => {
        rootAgentId = options.root.agentId;
        tree = await create(options);
        return tree;
      });
    const getTools = AgentRuntime.prototype.getTools;
    let boundaryCalls = 0;
    let wrapped = false;
    const toolsSpy = vi.spyOn(AgentRuntime.prototype, "getTools").mockImplementation(function (
      ...args
    ) {
      if (this.sessionId !== rootId && !wrapped) {
        const binding = (this as unknown as AgentRuntimeInternal).collaboration;
        if (binding) {
          wrapped = true;
          const before = binding.beforeModel.bind(binding);
          binding.beforeModel = (...parameters) => {
            if (++boundaryCalls === 2) boundaryReached.resolve();
            return before(...parameters);
          };
        }
      }
      return getTools.apply(this, args);
    });
    const beginShutdown = AgentRuntime.prototype.beginShutdown;
    const shutdownSpy = vi
      .spyOn(AgentRuntime.prototype, "beginShutdown")
      .mockImplementation(function () {
        if (this.sessionId !== rootId) releaseStarted.resolve();
        return beginShutdown.call(this);
      });
    const browserClosed = vi.fn(async () => {});
    let calls = 0;
    const modelSessions: string[] = [];
    const runtime = createTestAgentRuntime(
      rootId,
      {
        mode: "yolo",
        memory: { enabled: false },
        subagents: { maxLoadedChildren: 1, maxTotalAgents: 3 },
      },
      {
        sessionStore: store,
        eventStore: events,
        browserControlPort: {
          list: async () => [],
          execute: async () => {
            throw new Error("Browser not requested");
          },
          closeSession: browserClosed,
        },
        modelFactory: createTestModelFactory({
          generateText: async (_request, observation) => {
            modelSessions.push(String(observation.invocationContext?.traceContext?.sessionId));
            if (calls++ === 0) {
              modelStarted.resolve();
              await releaseModel.promise;
              return {
                ...done,
                text: "",
                finishReason: "tool_calls",
                toolCalls: [{ id: "todo-before-interrupt", name: "TodoRead", input: {} }],
              };
            }
            return done;
          },
        }),
      },
    );
    try {
      expect(
        (
          await tool(runtime, "spawn_agent", {
            task_name: "worker",
            message: "work",
            fork_turns: "none",
          })
        ).success,
      ).toBe(true);
      await modelStarted.promise;
      blockProjection = true;
      expect(
        (await tool(runtime, "send_message", { target: "worker", message: "wake" })).success,
      ).toBe(true);
      await projectionStarted.promise;
      releaseModel.resolve();
      await toolEnded.promise;
      await boundaryReached.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      const interrupted = tool(runtime, "interrupt_agent", { target: "worker" });
      const controller = tree!;
      await vi.waitFor(() =>
        expect(controller.get(rootAgentId, "worker").status).toBe("interrupted"),
      );
      const closing =
        operation === "eviction"
          ? tool(
              runtime,
              "spawn_agent",
              { task_name: "replacement", message: "next", fork_turns: "none" },
              "replacement",
            )
          : controller.unload(rootAgentId, "worker");
      await releaseStarted.promise;
      expect(browserClosed).not.toHaveBeenCalled();
      releaseProjection.resolve();
      const settled = Promise.all([interrupted, closing]);
      // 测试deadline只用于暴露死锁；产品没有新增timeout或提前释放资源。
      const result = await Promise.race([
        settled.then(() => "settled"),
        new Promise<string>((resolve) => setTimeout(() => resolve("blocked"), 1000)),
      ]);
      expect(result).toBe("settled");
      expect((await interrupted).success).toBe(true);
      const output = await closing;
      if (output) expect(output.success, output.error?.message).toBe(true);
      expect(browserClosed).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(calls).toBe(operation === "eviction" ? 2 : 1));
      if (operation === "eviction") expect(modelSessions[1]).not.toBe(modelSessions[0]);
      await runtime.shutdownCollaboration();
    } finally {
      releaseModel.resolve();
      releaseProjection.resolve();
      toolsSpy.mockRestore();
      shutdownSpy.mockRestore();
      controllerSpy.mockRestore();
    }
  },
);
