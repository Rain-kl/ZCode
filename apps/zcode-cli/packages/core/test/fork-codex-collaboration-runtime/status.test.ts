import { expect, it, vi } from "vitest";
import { createTestAgentRuntime } from "../../tests/test-agent-runtime.js";
import { createTestModelFactory } from "../../tests/test-runtime-model.js";
import { createTestSessionEventStore } from "../../tests/test-event-store.js";
import type { AgentRuntime } from "../../src/runtime/agent-runtime.js";
import { done, gate, roots, setup, tool } from "./fixture.js";

function status(runtime: AgentRuntime, agentId: string): unknown {
  return runtime.getCollaborationAgentStatus(agentId);
}

it("reads exact live child state without lazy initialization, saved-graph inference or additional model IO", async () => {
  const started = gate();
  const released = gate();
  let calls = 0;
  const { runtime, store, rootId } = setup(async (_request, observation) => {
    if (observation.invocationContext?.traceContext?.sessionId === rootId) return done;
    calls += 1;
    started.resolve();
    await released.promise;
    return done;
  });
  const entries = vi.spyOn(store, "sessionEntries");
  const save = vi.spyOn(store, "saveSessionEntry");
  expect(status(runtime, "unknown")).toBeUndefined();
  expect(entries).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(calls).toBe(0);
  await tool(runtime, "spawn_agent", {
    task_name: "worker",
    message: "hold model",
    fork_turns: "none",
  });
  await started.promise;
  const saved = await store.sessionEntries!({ sessionID: rootId, type: "codex_collaboration" });
  const snapshot = saved[0]!.data as {
    snapshot: { agents: Array<{ agentId: string; path: string }> };
  };
  const child = snapshot.snapshot.agents.find((record) => record.path === "/root/worker")!;
  const root = snapshot.snapshot.agents.find((record) => record.path === "/root")!;
  entries.mockClear();
  save.mockClear();
  expect(status(runtime, child.agentId)).toBe("running");
  expect(status(runtime, root.agentId)).toBeUndefined();
  expect(status(runtime, "sibling-not-in-tree")).toBeUndefined();
  expect(entries).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(calls).toBe(1);

  const restoredModel = vi.fn(async () => done);
  const restored = createTestAgentRuntime(
    rootId,
    { mode: "yolo", memory: { enabled: false } },
    {
      sessionStore: store,
      eventStore: createTestSessionEventStore(),
      modelFactory: createTestModelFactory({ generateText: restoredModel }),
    },
  );
  roots.push(restored);
  entries.mockClear();
  save.mockClear();
  expect(status(restored, child.agentId)).toBeUndefined();
  expect(entries).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(restoredModel).not.toHaveBeenCalled();

  expect((await tool(runtime, "interrupt_agent", { target: "worker" })).success).toBe(true);
  try {
    expect(status(runtime, child.agentId)).toBe("interrupted");
    expect(runtime.hasResidencyBlockingWork()).toBe(true);
    expect(calls).toBe(1);
  } finally {
    released.resolve();
  }
  await vi.waitFor(() => expect(runtime.hasResidencyBlockingWork()).toBe(false));
  expect(
    (await tool(runtime, "followup_task", { target: "worker", message: "complete" })).success,
  ).toBe(true);
  await vi.waitFor(() => expect(status(runtime, child.agentId)).toBe("completed"));
  expect(calls).toBe(2);
  await runtime.shutdownCollaboration();
});

it("keeps an errored child's exact state while another accepted child is running", async () => {
  const released = gate();
  let calls = 0;
  const { runtime, store, rootId } = setup(async () => {
    if (calls++ === 0) throw new Error("exact-status-child-failure");
    await released.promise;
    return done;
  });
  await tool(runtime, "spawn_agent", { task_name: "failed", message: "fail", fork_turns: "none" });
  const saved = await store.sessionEntries!({ sessionID: rootId, type: "codex_collaboration" });
  const entry = saved[0]!.data as {
    snapshot: { agents: Array<{ agentId: string; path: string }> };
  };
  const failedId = entry.snapshot.agents.find((record) => record.path === "/root/failed")!.agentId;
  await vi.waitFor(() => expect(status(runtime, failedId)).toBe("errored"));
  try {
    await tool(
      runtime,
      "spawn_agent",
      { task_name: "sibling", message: "wait", fork_turns: "none" },
      "sibling",
    );
    await vi.waitFor(() => expect(calls).toBe(2));
    expect(runtime.hasResidencyBlockingWork()).toBe(true);
    expect(status(runtime, failedId)).toBe("errored");
  } finally {
    released.resolve();
  }
  await runtime.shutdownCollaboration();
});
