import { describe, expect, it, vi } from "vitest";
import { createSessionId, SessionEventType, type ModelRequest } from "@zcode/contracts";
import { createTestAgentRuntime } from "../../tests/test-agent-runtime.js";
import { createTestModelFactory } from "../../tests/test-runtime-model.js";
import { createRecordingSubagentSessionStore } from "../../tests/subagent-test-store.js";
import { createTestSessionEventStore } from "../../tests/test-event-store.js";
import { roots, done, gate, setup, tool, texts } from "./fixture.js";
describe("actual collaboration recovery", () => {
  it("keeps allowed execution material transient and fails cold followup when that material is absent", async () => {
    const material = {};
    const selection = { providerId: "test", modelId: "execution-child" };
    const seen: unknown[] = [];
    const { runtime, store, rootId } = setup(async (_request, observation) => {
      seen.push(observation.factoryInput.requestDependencies);
      return done;
    });
    const spawned = await runtime.getToolExecutor().execute(
      {
        id: "execution-spawn",
        name: "spawn_agent",
        input: { task_name: "worker", message: "execution-scoped child", fork_turns: "none" },
      },
      {
        subagentModelOverride: { selection, requestDependencies: material, background: "allow" },
      },
    );
    expect(spawned.success, spawned.error?.message).toBe(true);
    await vi.waitFor(() => expect(seen).toEqual([material]));
    await vi.waitFor(async () =>
      expect((await tool(runtime, "list_agents", {})).modelContent).toContain(
        '"/root/worker","agent_status":{"completed"',
      ),
    );
    await runtime.shutdownCollaboration();
    const generate = vi.fn(async () => done);
    const restored = createTestAgentRuntime(
      rootId,
      { mode: "yolo", memory: { enabled: false } },
      {
        sessionStore: store,
        eventStore: createTestSessionEventStore(),
        modelFactory: createTestModelFactory({ generateText: generate }),
      },
    );
    roots.push(restored);
    const result = await tool(restored, "followup_task", {
      target: "worker",
      message: "cannot borrow parent identity",
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("Execution context required");
    expect(result.error?.message).toContain("test/execution-child");
    expect(generate).not.toHaveBeenCalled();
    expect(runtime.getSessionModelSelection()?.modelId).toBe("default-runtime-model");
  });
  it("restores canonical root identity, exact child history and original child model after a parent switch", async () => {
    const requests: { request: ModelRequest; model: string }[] = [];
    const generate: NonNullable<
      Parameters<typeof createTestModelFactory>[0]["generateText"]
    > = async (request, observation) => {
      requests.push({ request, model: observation.factoryInput.selection.modelId });
      return done;
    };
    const { runtime, store, rootId } = setup(generate);
    expect(
      (
        await tool(runtime, "spawn_agent", {
          task_name: "worker",
          message: "retained task",
          fork_turns: "none",
        })
      ).success,
    ).toBe(true);
    await vi.waitFor(async () =>
      expect((await tool(runtime, "list_agents", {}, "cold-list")).modelContent).toContain(
        "completed",
      ),
    );
    const before = await store.sessionEntries?.({ sessionID: rootId, type: "codex_collaboration" });
    const child = (await store.listSessions()).find(
      (session) => session.taskType === "subagent_child",
    )!;
    await runtime.shutdownCollaboration();
    const restored = createTestAgentRuntime(
      rootId,
      {
        mode: "yolo",
        workingDirectory: "/tmp",
        modelSelection: { providerId: "test", modelId: "parent-switched" },
        memory: { enabled: false },
      },
      {
        eventStore: createTestSessionEventStore(),
        sessionStore: store,
        modelFactory: createTestModelFactory({ generateText: generate }),
      },
    );
    roots.push(restored);
    const result = await tool(restored, "followup_task", {
      target: "worker",
      message: "restored followup",
    });
    expect(result.success, result.error?.message).toBe(true);
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]!.model).toBe("default-runtime-model");
    expect(texts(requests[1]!.request)).toContain("retained task");
    expect(texts(requests[1]!.request)).toContain("restored followup");
    const after = await store.sessionEntries?.({ sessionID: rootId, type: "codex_collaboration" });
    const savedBefore = before!.at(-1)!.data as {
      snapshot: { agents: { agentId: string; traceId: string }[] };
    };
    const savedAfter = after!.at(-1)!.data as typeof savedBefore;
    expect(savedAfter.snapshot.agents[0]!.agentId).toBe(savedBefore.snapshot.agents[0]!.agentId);
    expect(savedAfter.snapshot.agents[0]!.traceId).toBe(savedBefore.snapshot.agents[0]!.traceId);
    expect(
      (await store.listSessions())
        .filter((session) => session.taskType === "subagent_child")
        .map((session) => session.id),
    ).toEqual([child.id]);
  });
  it("retains accepted child after a model error and followup uses the same transcript", async () => {
    let calls = 0;
    const requests: ModelRequest[] = [];
    const { runtime, store } = setup(async (request) => {
      requests.push(request);
      if (calls++ === 0) throw new Error("child-provider-failed");
      return done;
    });
    expect(
      (
        await tool(runtime, "spawn_agent", {
          task_name: "worker",
          message: "initial error task",
          fork_turns: "none",
        })
      ).success,
    ).toBe(true);
    await vi.waitFor(async () =>
      expect((await tool(runtime, "list_agents", {}, "error-status")).modelContent).toContain(
        "errored",
      ),
    );
    const first = (await store.listSessions()).filter(
      (session) => session.taskType === "subagent_child",
    );
    expect(
      (await tool(runtime, "followup_task", { target: "worker", message: "retry with context" }))
        .success,
    ).toBe(true);
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(texts(requests[1]!)).toContain("initial error task");
    expect(
      (await store.listSessions())
        .filter((session) => session.taskType === "subagent_child")
        .map((session) => session.id),
    ).toEqual(first.map((session) => session.id));
  });
  it("rejects accepted child with missing transcript instead of creating a blank resume", async () => {
    const { runtime, store, rootId } = setup(async () => done);
    expect(
      (
        await tool(runtime, "spawn_agent", {
          task_name: "worker",
          message: "must remain",
          fork_turns: "none",
        })
      ).success,
    ).toBe(true);
    await vi.waitFor(async () =>
      expect((await tool(runtime, "list_agents", {}, "missing-status")).modelContent).toContain(
        '"/root/worker","agent_status":{"completed"',
      ),
    );
    const child = (await store.listSessions()).find(
      (session) => session.taskType === "subagent_child",
    )!;
    await runtime.shutdownCollaboration();
    for (const message of await store.messages({ sessionID: child.id }))
      await store.removeMessage({ sessionID: child.id, messageID: message.info.id });
    const generate = vi.fn(async () => done);
    const restored = createTestAgentRuntime(
      rootId,
      { mode: "yolo", memory: { enabled: false } },
      {
        eventStore: createTestSessionEventStore(),
        sessionStore: store,
        modelFactory: createTestModelFactory({ generateText: generate }),
      },
    );
    roots.push(restored);
    const result = await tool(restored, "followup_task", {
      target: "worker",
      message: "try restore",
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("Accepted child transcript missing");
    expect(generate).not.toHaveBeenCalled();
  });
  it("cold projection does not append duplicate terminal lifecycle events", async () => {
    const { runtime, store, rootId } = setup(async () => done);
    await tool(runtime, "spawn_agent", {
      task_name: "worker",
      message: "finish",
      fork_turns: "none",
    });
    await vi.waitFor(async () =>
      expect((await tool(runtime, "list_agents", {})).modelContent).toContain(
        '"/root/worker","agent_status":{"completed"',
      ),
    );
    await runtime.shutdownCollaboration();
    const events = createTestSessionEventStore();
    const restored = createTestAgentRuntime(
      rootId,
      { mode: "yolo", memory: { enabled: false } },
      {
        eventStore: events,
        sessionStore: store,
        modelFactory: createTestModelFactory({ generateText: async () => done }),
      },
    );
    roots.push(restored);
    expect((await tool(restored, "list_agents", {})).success).toBe(true);
    expect(
      (await events.getEvents(rootId)).filter(
        (event) => event.type === SessionEventType.SubagentStopped,
      ),
    ).toEqual([]);
  });
  it("rejects a malformed accepted task receipt with no durable task body before model IO", async () => {
    const { runtime, store, rootId } = setup(async () => done);
    await tool(runtime, "spawn_agent", {
      task_name: "worker",
      message: "must retain body",
      fork_turns: "none",
    });
    await vi.waitFor(async () =>
      expect((await tool(runtime, "list_agents", {})).modelContent).toContain(
        '"/root/worker","agent_status":{"completed"',
      ),
    );
    await runtime.shutdownCollaboration();
    const read = store.messages.bind(store);
    store.messages = async (input) =>
      (await read(input)).map((message) =>
        message.info.role === "user" &&
        message.info.metadata &&
        "collaboration" in message.info.metadata
          ? { ...message, parts: [] }
          : message,
      );
    const generate = vi.fn(async () => done);
    const restored = createTestAgentRuntime(
      rootId,
      { mode: "yolo", memory: { enabled: false } },
      {
        eventStore: createTestSessionEventStore(),
        sessionStore: store,
        modelFactory: createTestModelFactory({ generateText: generate }),
      },
    );
    roots.push(restored);
    const result = await tool(restored, "followup_task", { target: "worker", message: "resume" });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("Accepted child transcript missing");
    expect(generate).not.toHaveBeenCalled();
  });
  it("cold followup preserves the accepted profile and injected instructions after parent configuration changes", async () => {
    const store = createRecordingSubagentSessionStore();
    const rootId = createSessionId("saved-profile-parent");
    const requests: ModelRequest[] = [];
    const modelFactory = createTestModelFactory({
      generateText: async (request) => {
        requests.push(request);
        return done;
      },
    });
    const profile = {
      name: "auditor",
      description: "audit",
      source: "user" as const,
      systemPrompt: "Retained reviewer instructions",
      tools: ["Read"],
    };
    const runtime = createTestAgentRuntime(
      rootId,
      { mode: "yolo", memory: { enabled: false }, subagents: { profiles: [profile] } },
      { eventStore: createTestSessionEventStore(), sessionStore: store, modelFactory },
    );
    roots.push(runtime);
    expect(
      (
        await tool(runtime, "spawn_agent", {
          task_name: "worker",
          message: "review",
          agent_type: "auditor",
          fork_turns: "none",
        })
      ).success,
    ).toBe(true);
    await vi.waitFor(async () =>
      expect((await tool(runtime, "list_agents", {})).modelContent).toContain(
        '"/root/worker","agent_status":{"completed"',
      ),
    );
    await runtime.shutdownCollaboration();
    const restored = createTestAgentRuntime(
      rootId,
      { mode: "yolo", memory: { enabled: false }, subagents: { profiles: [] } },
      { eventStore: createTestSessionEventStore(), sessionStore: store, modelFactory },
    );
    roots.push(restored);
    const result = await tool(restored, "followup_task", {
      target: "worker",
      message: "same reviewer",
    });
    expect(result.success, result.error?.message).toBe(true);
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(texts(requests[1]!)).toContain("Retained reviewer instructions");
    expect(requests[1]!.tools?.map((entry) => entry.name)).toContain("Read");
    expect(requests[1]!.tools?.map((entry) => entry.name)).not.toContain("Bash");
  });
  it("routes a grandchild terminal to its exact unloaded parent and refuses to borrow root history for resume", async () => {
    const store = createRecordingSubagentSessionStore();
    const events = createTestSessionEventStore();
    const rootId = createSessionId("nested-root");
    const started = gate();
    const released = gate();
    let parentCalls = 0;
    const runtime = createTestAgentRuntime(
      rootId,
      {
        mode: "yolo",
        memory: { enabled: false },
        subagents: { maxDepth: 2, maxLoadedChildren: 2, maxTotalAgents: 4 },
      },
      {
        sessionStore: store,
        eventStore: events,
        modelFactory: createTestModelFactory({
          generateText: async (request) => {
            if (texts(request).includes("Grandchild active")) {
              started.resolve();
              await released.promise;
              return done;
            }
            if (texts(request).includes("Make grandchild") && parentCalls++ === 0)
              return {
                ...done,
                text: "",
                finishReason: "tool_calls",
                toolCalls: [
                  {
                    id: "nested-spawn",
                    name: "spawn_agent",
                    input: {
                      task_name: "grandchild",
                      message: "Grandchild active",
                      fork_turns: "none",
                    },
                  },
                ],
              };
            return done;
          },
        }),
      },
    );
    roots.push(runtime);
    try {
      expect(
        (
          await tool(runtime, "spawn_agent", {
            task_name: "parent",
            message: "Make grandchild",
            fork_turns: "none",
          })
        ).success,
      ).toBe(true);
      await started.promise;
      await vi.waitFor(async () =>
        expect((await tool(runtime, "list_agents", {})).modelContent).toContain(
          '"/root/parent","agent_status":{"completed"',
        ),
      );
      expect(runtime.hasResidencyBlockingWork()).toBe(true);
      const parent = (await store.listSessions()).find(
        (session) => session.title === "/root/parent",
      )!;
      expect(parent).toBeDefined();
      expect(
        (
          await tool(
            runtime,
            "spawn_agent",
            { task_name: "sibling", message: "force unload terminal parent", fork_turns: "none" },
            "sibling-spawn",
          )
        ).success,
      ).toBe(true);
      expect(runtime.hasResidencyBlockingWork()).toBe(true);
      expect(
        (await tool(runtime, "interrupt_agent", { target: "/root/parent/grandchild" })).success,
      ).toBe(true);
      await new Promise<void>((resolve) => setImmediate(resolve));
      // 已显示 interrupted 仍有实际 provider IO，不能因直系 parent 已完成就关闭整棵树。
      expect(runtime.hasResidencyBlockingWork()).toBe(true);
      released.resolve();
      await vi.waitFor(async () =>
        expect(
          (await events.getEvents(parent.id)).some(
            (event) =>
              event.type === SessionEventType.SubagentStopped &&
              (event.payload as { path?: string }).path === "/root/parent/grandchild",
          ),
        ).toBe(true),
      );
      expect(
        (await events.getEvents(rootId)).filter(
          (event) =>
            event.type === SessionEventType.SubagentStopped &&
            (event.payload as { path?: string }).path === "/root/parent/grandchild",
        ),
      ).toEqual([]);
      await vi.waitFor(() => expect(runtime.hasResidencyBlockingWork()).toBe(false));
      await runtime.shutdownCollaboration();
      const restored = createTestAgentRuntime(
        rootId,
        { mode: "yolo", memory: { enabled: false } },
        {
          sessionStore: store,
          eventStore: createTestSessionEventStore(),
          modelFactory: createTestModelFactory({ generateText: async () => done }),
        },
      );
      roots.push(restored);
      const resumed = await tool(restored, "followup_task", {
        target: "/root/parent/grandchild",
        message: "resume unavailable parent",
      });
      expect(resumed.success).toBe(false);
      expect(resumed.error?.message).toContain("parent runtime");
      expect(resumed.error?.message).toContain("unloaded");
    } finally {
      released.resolve();
    }
  });
});
