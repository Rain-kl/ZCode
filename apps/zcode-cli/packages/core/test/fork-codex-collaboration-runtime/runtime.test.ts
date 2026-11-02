import { describe, expect, it, vi } from "vitest";
import {
  createSessionId,
  SessionEventType,
  type ModelRequest,
  type PermissionBrokerRequest,
  type PermissionBrokerResult,
} from "@zcode/contracts";
import { createTestAgentRuntime } from "../../tests/test-agent-runtime.js";
import { createTestModelFactory } from "../../tests/test-runtime-model.js";
import { createRecordingSubagentSessionStore } from "../../tests/subagent-test-store.js";
import { createTestSessionEventStore } from "../../tests/test-event-store.js";
import { roots, done, gate, setup, tool, texts } from "./fixture.js";
import "../../src/fork/codex-collaboration-runtime/contract.test.js";
describe("actual collaboration runtime", () => {
  it("does not require optional session-entry writes for an ordinary turn before collaboration is used", async () => {
    const { runtime, store } = setup(async () => done);
    store.saveSessionEntry = undefined;
    store.sessionEntries = undefined;
    expect((await runtime.executeTurn("ordinary isolated turn")).response).toBe("finished");
    expect(
      (await store.listSessions()).filter((session) => session.taskType === "subagent_child"),
    ).toEqual([]);
    const rejected = await tool(runtime, "spawn_agent", {
      task_name: "worker",
      message: "must require persistence",
    });
    expect(rejected.success).toBe(false);
    expect(rejected.error?.message).toContain(
      "Persistent collaboration requires session-entry read/write",
    );
  });
  it("registers only the new six tools by default", () => {
    const { runtime } = setup(async () => done);
    const names = runtime.getToolRegistry().list();
    expect(names).toEqual(
      expect.arrayContaining([
        "spawn_agent",
        "send_message",
        "followup_task",
        "interrupt_agent",
        "list_agents",
        "wait_agent",
      ]),
    );
    expect(
      names.filter((name) =>
        ["Agent", "Task", "SendMessage", "RespondToCoordinator"].includes(name),
      ),
    ).toEqual([]);
  });
  it("uses finite host injection for an isolated workflow without restoring old model tools", () => {
    const runtime = createTestAgentRuntime(
      createSessionId(),
      {},
      {
        eventStore: createTestSessionEventStore(),
        createCollaborationBinding: () => undefined,
      },
    );
    roots.push(runtime);
    expect(runtime.getToolRegistry().list()).not.toContain("spawn_agent");
    expect(runtime.getToolRegistry().list()).not.toContain("Agent");
  });
  it.each(["Agent", "Task", "SendMessage", "RespondToCoordinator"])(
    "rejects removed direct tool %s without legacy execution",
    async (name) => {
      const generate = vi.fn(async () => done);
      const { runtime } = setup(generate);
      const result = await tool(runtime, name, {});
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain(name);
      expect(generate).not.toHaveBeenCalled();
    },
  );
  it("rejects unknown profile and model using actual available collections", async () => {
    const { runtime } = setup(async () => done);
    const profile = await tool(runtime, "spawn_agent", {
      task_name: "unknown_profile",
      message: "inspect",
      agent_type: "missing-profile",
    });
    expect(profile.success).toBe(false);
    expect(profile.error?.message).toContain("missing-profile");
    expect(profile.error?.message).toContain("general-purpose");
    const model = await tool(
      runtime,
      "spawn_agent",
      {
        task_name: "unknown_model",
        message: "inspect",
        fork_turns: "none",
        model: "missing-model",
      },
      "bad-model",
    );
    expect(model.success).toBe(false);
    expect(model.error?.message).toContain("missing-model");
    expect(model.error?.message).toContain("test/default-runtime-model");
    const effort = await tool(
      runtime,
      "spawn_agent",
      {
        task_name: "unknown_effort",
        message: "inspect",
        fork_turns: "none",
        reasoning_effort: "high",
      },
      "bad-effort",
    );
    expect(effort.success).toBe(false);
    expect(effort.error?.message).toContain("Unsupported reasoning_effort high");
    expect(effort.error?.message).toContain("disabled");
  });
  it("sends without triggering idle child and followup reuses its session", async () => {
    const requests: ModelRequest[] = [];
    const { runtime, store } = setup(async (request) => {
      requests.push(request);
      return done;
    });
    expect(
      (
        await tool(runtime, "spawn_agent", {
          task_name: "worker",
          message: "first",
          fork_turns: "none",
        })
      ).success,
    ).toBe(true);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await vi.waitFor(async () =>
      expect((await tool(runtime, "list_agents", {}, "list-terminal")).modelContent).toContain(
        "completed",
      ),
    );
    const childBefore = (await store.listSessions()).find(
      (session) => session.taskType === "subagent_child",
    );
    const sent = await tool(runtime, "send_message", { target: "worker", message: "queue only" });
    expect(sent.success).toBe(true);
    expect(sent.modelContent).toBe("");
    expect(requests).toHaveLength(1);
    const followup = await tool(runtime, "followup_task", {
      target: "worker",
      message: "continue now",
    });
    expect(followup.success).toBe(true);
    expect(followup.modelContent).toBe("");
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(texts(requests[1]!)).toContain("first");
    expect(texts(requests[1]!)).toContain("queue only");
    expect(texts(requests[1]!)).toContain("continue now");
    expect(
      (await store.listSessions())
        .filter((session) => session.taskType === "subagent_child")
        .map((session) => session.id),
    ).toEqual([childBefore!.id]);
  });
  it("full fork retains completed history with tool pairs while excluding its active spawn batch", async () => {
    let rootCalls = 0;
    const childSeen = gate();
    let childRequest: ModelRequest | undefined;
    const { runtime, rootId } = setup(async (request, observation) => {
      if (observation.invocationContext?.traceContext?.sessionId !== rootId) {
        childRequest = request;
        childSeen.resolve();
        return done;
      }
      rootCalls++;
      if (rootCalls === 1)
        return {
          ...done,
          text: "",
          finishReason: "tool_calls",
          toolCalls: [{ id: "completed-list", name: "list_agents", input: {} }],
        };
      if (rootCalls === 2)
        return {
          ...done,
          text: "",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "active-spawn",
              name: "spawn_agent",
              input: { task_name: "forked", message: "fork task" },
            },
            { id: "active-sibling", name: "list_agents", input: {} },
          ],
        };
      return done;
    });
    await runtime.executeTurn("Historical user context");
    await childSeen.promise;
    const calls = childRequest!.messages.flatMap((message) => message.toolCalls ?? []);
    const results = childRequest!.messages.filter((message) => message.role === "tool");
    expect(texts(childRequest!)).toContain("Historical user context");
    expect(calls.map((call) => call.id)).toContain("completed-list");
    expect(calls.map((call) => call.id)).not.toContain("active-spawn");
    expect(calls.map((call) => call.id)).not.toContain("active-sibling");
    for (const call of calls)
      expect(results.filter((message) => message.toolCallId === call.id)).toHaveLength(1);
  });
  it("keeps a real child permission request alive during parent steer and routes it through the parent", async () => {
    let calls = 0;
    let parentCalls = 0;
    let permission: PermissionBrokerRequest | undefined;
    let permissionSignal: AbortSignal | undefined;
    let approve!: (result: PermissionBrokerResult) => void;
    const permissionStarted = gate();
    const store = createRecordingSubagentSessionStore();
    const rootId = createSessionId("permission-root");
    const runtime = createTestAgentRuntime(
      rootId,
      {
        mode: "yolo",
        workingDirectory: "/tmp",
        memory: { enabled: false },
        subagents: { inactivityTimeoutMs: 1 },
      },
      {
        sessionStore: store,
        eventStore: createTestSessionEventStore(),
        permissionBroker: {
          requestPermission: async (request, options) => {
            permission = request;
            permissionSignal = options?.signal;
            permissionStarted.resolve();
            return new Promise<PermissionBrokerResult>((resolve) => {
              approve = resolve;
            });
          },
        },
        modelFactory: createTestModelFactory({
          generateText: async (_request, observation) => {
            if (observation.invocationContext?.traceContext?.sessionId === rootId) {
              if (parentCalls++ === 0)
                return {
                  ...done,
                  text: "",
                  finishReason: "tool_calls",
                  toolCalls: [
                    {
                      id: "parent-permission-wait",
                      name: "wait_agent",
                      input: { timeout_ms: 60_000 },
                    },
                  ],
                };
              return done;
            }
            if (calls++ === 0)
              return {
                ...done,
                text: "",
                finishReason: "tool_calls",
                toolCalls: [
                  {
                    id: "ask-child",
                    name: "AskUserQuestion",
                    input: {
                      questions: [
                        {
                          header: "Choice",
                          question: "Which option?",
                          multiSelect: false,
                          options: [
                            { label: "A", description: "First" },
                            { label: "B", description: "Second" },
                          ],
                        },
                      ],
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
    expect(
      (
        await tool(runtime, "spawn_agent", {
          task_name: "worker",
          message: "ask permission",
          fork_turns: "none",
        })
      ).success,
    ).toBe(true);
    await permissionStarted.promise;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(permission!.sessionId).toBe(rootId);
    expect(permission!.origin).toMatchObject({ kind: "subagent" });
    expect((await tool(runtime, "list_agents", {}, "permission-status")).modelContent).toContain(
      '"/root/worker","agent_status":"running"',
    );
    const parentTurn = runtime.executeTurn("Wait while child asks permission");
    await vi.waitFor(async () =>
      expect(
        (await runtime.getSessionEventStore().getEvents(rootId)).some(
          (event) =>
            event.type === SessionEventType.ToolCallStarted &&
            (event.payload as { toolCallId?: string }).toolCallId === "parent-permission-wait",
        ),
      ).toBe(true),
    );
    await runtime.steerTurn({
      input: "Keep the pending permission request",
      delivery: "guide",
      inputPresentation: "user_steer",
    });
    await parentTurn;
    expect(calls).toBe(1);
    expect(permissionSignal?.aborted).not.toBe(true);
    expect(
      (await tool(runtime, "list_agents", {}, "after-permission-steer")).modelContent,
    ).toContain('"/root/worker","agent_status":"running"');
    approve({
      decision: "allow",
      modifiedInput: {
        questions: [
          {
            header: "Choice",
            question: "Which option?",
            multiSelect: false,
            options: [
              { label: "A", description: "First" },
              { label: "B", description: "Second" },
            ],
          },
        ],
        answers: { "Which option?": "A" },
      },
      resolvedAt: new Date(),
    });
    await vi.waitFor(() => expect(calls).toBe(2));
  });
  it("failed durable acceptance performs zero model IO and discards only the unaccepted child transcript", async () => {
    const generate = vi.fn(async () => done);
    const { runtime, store } = setup(generate);
    const save = store.saveSessionEntry!.bind(store);
    store.saveSessionEntry = async (entry) => {
      const data = entry.data as { snapshot?: { accepted?: unknown[] } };
      if (entry.type === "codex_collaboration" && data.snapshot?.accepted?.length)
        throw new Error("root acceptance storage unavailable");
      await save(entry);
    };
    const result = await tool(runtime, "spawn_agent", {
      task_name: "worker",
      message: "never run",
      fork_turns: "none",
    });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("root acceptance storage unavailable");
    expect(generate).not.toHaveBeenCalled();
    const child = (await store.listSessions()).find(
      (session) => session.taskType === "subagent_child",
    )!;
    expect(await store.messages({ sessionID: child.id })).toEqual([]);
  });
  it("forks completed in-memory history without a session store", async () => {
    let rootCalls = 0;
    let childRequest: ModelRequest | undefined;
    const observed = gate();
    const rootId = createSessionId("memory-fork-root");
    const runtime = createTestAgentRuntime(
      rootId,
      { mode: "yolo", workingDirectory: "/tmp", memory: { enabled: false } },
      {
        eventStore: createTestSessionEventStore(),
        modelFactory: createTestModelFactory({
          generateText: async (request, observation) => {
            if (observation.invocationContext?.traceContext?.sessionId !== rootId) {
              childRequest = request;
              observed.resolve();
              return done;
            }
            if (rootCalls++ === 0) return done;
            if (rootCalls === 2)
              return {
                ...done,
                text: "",
                finishReason: "tool_calls",
                toolCalls: [
                  {
                    id: "memory-spawn",
                    name: "spawn_agent",
                    input: { task_name: "worker", message: "inspect inherited history" },
                  },
                ],
              };
            return done;
          },
        }),
      },
    );
    roots.push(runtime);
    await runtime.executeTurn("completed memory history");
    await runtime.executeTurn("now delegate");
    await observed.promise;
    expect(texts(childRequest!)).toContain("completed memory history");
    expect(
      childRequest!.messages
        .flatMap((message) => message.toolCalls ?? [])
        .some((call) => call.id === "memory-spawn"),
    ).toBe(false);
  });
  it("honors host background denial only when a tool would start a new child run", async () => {
    const release = gate();
    const started = gate();
    const { runtime } = setup(async () => {
      started.resolve();
      await release.promise;
      return done;
    });
    const override = {
      selection: { providerId: "test", modelId: "default-runtime-model" },
      background: "deny" as const,
    };
    try {
      const denied = await runtime.getToolExecutor().execute(
        {
          id: "denied-spawn",
          name: "spawn_agent",
          input: { task_name: "denied", message: "must not run", fork_turns: "none" },
        },
        { subagentModelOverride: override },
      );
      expect(denied.success).toBe(false);
      expect(denied.error?.message).toContain("background: deny");
      expect(
        (
          await tool(runtime, "spawn_agent", {
            task_name: "worker",
            message: "accepted independent run",
            fork_turns: "none",
          })
        ).success,
      ).toBe(true);
      await started.promise;
      const input = { target: "worker", message: "message during independent run" };
      expect(
        (
          await runtime
            .getToolExecutor()
            .execute(
              { id: "running-followup", name: "followup_task", input },
              { subagentModelOverride: override },
            )
        ).success,
      ).toBe(true);
      release.resolve();
      await vi.waitFor(async () =>
        expect((await tool(runtime, "list_agents", {})).modelContent).toContain(
          '"/root/worker","agent_status":{"completed"',
        ),
      );
      const deniedFollowup = await runtime
        .getToolExecutor()
        .execute(
          { id: "denied-followup", name: "followup_task", input },
          { subagentModelOverride: override },
        );
      expect(deniedFollowup.success).toBe(false);
      expect(deniedFollowup.error?.message).toContain("background: deny");
      expect(
        (
          await runtime
            .getToolExecutor()
            .execute(
              { id: "allowed-send", name: "send_message", input },
              { subagentModelOverride: override },
            )
        ).success,
      ).toBe(true);
    } finally {
      release.resolve();
    }
  });
});
