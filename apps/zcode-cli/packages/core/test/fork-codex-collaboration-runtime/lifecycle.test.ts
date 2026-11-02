import { describe, expect, it, vi } from "vitest";
import { SessionEventType, modelMessageContentToText, type ModelRequest } from "@zcode/contracts";
import { done, gate, setup, tool, texts } from "./fixture.js";
describe("actual collaboration lifecycle", () => {
  it("does not miss durable mail delivered while the child model is in flight before wait subscribes", async () => {
    const started = gate();
    const release = gate();
    const consumed = gate();
    let calls = 0;
    const { runtime, rootId } = setup(async (request, observation) => {
      if (observation.invocationContext?.traceContext?.sessionId === rootId) return done;
      if (calls++ === 0) {
        started.resolve();
        await release.promise;
        return {
          ...done,
          text: "",
          finishReason: "tool_calls",
          toolCalls: [{ id: "late-wait", name: "wait_agent", input: { timeout_ms: 3_600_000 } }],
        };
      }
      expect(texts(request)).toContain("mail arrived before wait");
      consumed.resolve();
      return done;
    });
    await tool(runtime, "spawn_agent", { task_name: "worker", message: "inspect" });
    await started.promise;
    expect(
      (
        await tool(runtime, "send_message", {
          target: "worker",
          message: "mail arrived before wait",
        })
      ).success,
    ).toBe(true);
    release.resolve();
    await vi.waitFor(() => expect(calls).toBe(2), { timeout: 1000 });
    await consumed.promise;
  });
  it("persists acceptance and raw child task before model IO, and root completion leaves child alive", async () => {
    const childGate = gate();
    const observed = gate();
    let rootCalls = 0;
    const childRequests: ModelRequest[] = [];
    const { runtime, store, rootId } = setup(async (request, observation) => {
      if (observation.invocationContext?.traceContext?.sessionId === rootId) {
        if (rootCalls++ === 0)
          return {
            ...done,
            text: "",
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "spawn-original",
                name: "spawn_agent",
                input: {
                  task_name: "worker",
                  message: "Inspect original task",
                  fork_turns: "none",
                },
              },
            ],
          };
        return done;
      }
      childRequests.push(request);
      const child = (await store.listSessions()).find(
        (session) => session.taskType === "subagent_child",
      );
      expect(child).toBeDefined();
      const entries = await store.sessionEntries?.({
        sessionID: rootId,
        type: "codex_collaboration",
      });
      expect(JSON.stringify(entries)).toContain("spawn-original");
      const transcript = await store.messages({ sessionID: child!.id });
      expect(JSON.stringify(transcript)).toContain("Inspect original task");
      expect(
        request.messages.some(
          (message) =>
            message.role === "assistant" &&
            modelMessageContentToText(message.content).includes("Message Type: NEW_TASK"),
        ),
      ).toBe(true);
      expect(texts(request)).toContain("/root/worker");
      expect(texts(request)).not.toContain("RespondToCoordinator");
      observed.resolve();
      await childGate.promise;
      return done;
    });
    try {
      expect((await runtime.executeTurn("Delegate inspection")).response).toContain("finished");
      await observed.promise;
      expect(childRequests).toHaveLength(1);
      const lifecycle = (await runtime.getSessionEventStore().getEvents(rootId)).find(
        (event) => event.type === SessionEventType.SubagentSpawned,
      );
      expect(lifecycle?.payload).toMatchObject({
        parentToolCallId: "spawn-original",
        path: "/root/worker",
        modelSelection: { providerId: "test", modelId: "default-runtime-model" },
      });
      const parts = (await store.messages({ sessionID: rootId })).flatMap(
        (message) => message.parts,
      );
      const settled = parts.findLast(
        (part) =>
          part.type === "tool" &&
          part.callID === "spawn-original" &&
          part.state.status === "completed",
      );
      expect(
        settled?.type === "tool" && settled.state.status === "completed"
          ? settled.state.metadata
          : undefined,
      ).toMatchObject({
        collaboration: {
          childSessionId: (lifecycle!.payload as { childSessionId: string }).childSessionId,
          toolCallId: "spawn-original",
          path: "/root/worker",
          generation: 1,
        },
      });
      const listed = await tool(runtime, "list_agents", {});
      expect(listed.success).toBe(true);
      expect(listed.modelContent).toContain("running");
    } finally {
      childGate.resolve();
    }
  });
  it("new user steer wakes wait without aborting a running child and native stop targets that child", async () => {
    const waiting = gate();
    const childStarted = gate();
    const childRelease = gate();
    let rootCalls = 0;
    let childAborted = false;
    const { runtime, rootId } = setup(async (request, observation) => {
      if (observation.invocationContext?.traceContext?.sessionId === rootId) {
        if (rootCalls++ === 0)
          return {
            ...done,
            text: "",
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "wait-spawn",
                name: "spawn_agent",
                input: { task_name: "worker", message: "long task", fork_turns: "none" },
              },
            ],
          };
        if (rootCalls === 2) {
          waiting.resolve();
          return {
            ...done,
            text: "",
            finishReason: "tool_calls",
            toolCalls: [{ id: "active-wait", name: "wait_agent", input: { timeout_ms: 60_000 } }],
          };
        }
        return done;
      }
      childStarted.resolve();
      request.abortSignal?.addEventListener(
        "abort",
        () => {
          childAborted = true;
          childRelease.resolve();
        },
        { once: true },
      );
      await childRelease.promise;
      return done;
    });
    const turn = runtime.executeTurn("delegate then wait");
    await waiting.promise;
    await childStarted.promise;
    // ToolCallStarted is emitted before the wait handler; let that call actually subscribe.
    await vi.waitFor(async () =>
      expect(
        (await runtime.getSessionEventStore().getEvents(rootId)).some(
          (event) =>
            event.type === SessionEventType.ToolCallStarted &&
            (event.payload as { toolName?: string }).toolName === "wait_agent",
        ),
      ).toBe(true),
    );
    await runtime.steerTurn({
      input: "new user instruction",
      delivery: "guide",
      inputPresentation: "user_steer",
    });
    await turn;
    expect(childAborted).toBe(false);
    const tasks = Object.values(
      (
        runtime as unknown as {
          runtimeTaskRegistry: { all(): Record<string, { agentId: string }> };
        }
      ).runtimeTaskRegistry.all(),
    );
    expect(tasks).toHaveLength(1);
    expect((await runtime.cancelBackgroundTask(tasks[0]!.agentId)).cancelled).toBe(true);
    await vi.waitFor(() => expect(childAborted).toBe(true));
  });
  it("keeps the child waiting for a legal message tool during parent steer", async () => {
    let calls = 0;
    let parentCalls = 0;
    const waiting = gate();
    const { runtime, store, rootId } = setup(async (_request, observation) => {
      if (observation.invocationContext?.traceContext?.sessionId === rootId) {
        if (parentCalls++ === 0)
          return {
            ...done,
            text: "",
            finishReason: "tool_calls",
            toolCalls: [
              { id: "parent-message-wait", name: "wait_agent", input: { timeout_ms: 60_000 } },
            ],
          };
        return done;
      }
      if (calls++ === 0) {
        waiting.resolve();
        return {
          ...done,
          text: "",
          finishReason: "tool_calls",
          toolCalls: [{ id: "child-wait", name: "wait_agent", input: { timeout_ms: 10_000 } }],
        };
      }
      return done;
    });
    expect(
      (
        await tool(runtime, "spawn_agent", {
          task_name: "worker",
          message: "wait for message",
          fork_turns: "none",
        })
      ).success,
    ).toBe(true);
    await waiting.promise;
    const child = (await store.listSessions()).find(
      (session) => session.taskType === "subagent_child",
    )!;
    await vi.waitFor(async () =>
      expect(
        (await runtime.getSessionEventStore().getEvents(child.id)).some(
          (event) =>
            event.type === SessionEventType.ToolCallStarted &&
            (event.payload as { toolName?: string }).toolName === "wait_agent",
        ),
      ).toBe(true),
    );
    // 显式工具等待由调用自身管理；parent steer 不能终止 child 的合法等待。
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect((await tool(runtime, "list_agents", {}, "waiting-status")).modelContent).toContain(
      '"/root/worker","agent_status":"running"',
    );
    const parentTurn = runtime.executeTurn("Wait for child message boundary");
    await vi.waitFor(async () =>
      expect(
        (await runtime.getSessionEventStore().getEvents(rootId)).some(
          (event) =>
            event.type === SessionEventType.ToolCallStarted &&
            (event.payload as { toolCallId?: string }).toolCallId === "parent-message-wait",
        ),
      ).toBe(true),
    );
    await runtime.steerTurn({
      input: "Continue waiting safely",
      delivery: "guide",
      inputPresentation: "user_steer",
    });
    await parentTurn;
    expect(calls).toBe(1);
    expect((await tool(runtime, "list_agents", {}, "after-message-steer")).modelContent).toContain(
      '"/root/worker","agent_status":"running"',
    );
    await tool(runtime, "send_message", { target: "worker", message: "wake at safe boundary" });
    await vi.waitFor(() => expect(calls).toBe(2));
  });
  it("retries a failed terminal projection without losing or duplicating its lifecycle event", async () => {
    const release = gate();
    const started = gate();
    const { runtime, rootId } = setup(async () => {
      started.resolve();
      await release.promise;
      return done;
    });
    const events = runtime.getSessionEventStore();
    const append = events.append.bind(events);
    let failures = 0;
    events.append = async (event) => {
      if (event.type === SessionEventType.SubagentStopped && failures++ === 0)
        throw new Error("derived lifecycle storage temporarily unavailable");
      return append(event);
    };
    await tool(runtime, "spawn_agent", {
      task_name: "worker",
      message: "finish later",
      fork_turns: "none",
    });
    await started.promise;
    release.resolve();
    await vi.waitFor(() => expect(failures).toBeGreaterThan(0));
    expect((await tool(runtime, "list_agents", {})).success).toBe(true);
    expect(
      (await events.getEvents(rootId)).filter(
        (event) => event.type === SessionEventType.SubagentStopped,
      ),
    ).toHaveLength(1);
  });
  it("shutdown awaits the pending child before returning and closing shared resources", async () => {
    const started = gate();
    const cancelled = gate();
    const released = gate();
    const { runtime } = setup(async (request) => {
      started.resolve();
      request.abortSignal?.addEventListener("abort", () => cancelled.resolve(), { once: true });
      await released.promise;
      return done;
    });
    await tool(runtime, "spawn_agent", {
      task_name: "worker",
      message: "await cancellation",
      fork_turns: "none",
    });
    await started.promise;
    let closed = false;
    const closing = runtime.shutdownCollaboration().then(() => {
      closed = true;
    });
    await cancelled.promise;
    expect(closed).toBe(false);
    released.resolve();
    await closing;
    expect(closed).toBe(true);
  });
});
