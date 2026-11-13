import { expect, it, vi } from "vitest";
import { type BrowserControlPort } from "@zcode/contracts";
import type { AgentRuntimeInternal } from "../../src/runtime/internal.js";
import { createTestAgentRuntime } from "../../tests/test-agent-runtime.js";
import { createTestModelFactory } from "../../tests/test-runtime-model.js";
import { createTestSessionEventStore } from "../../tests/test-event-store.js";
import { roots, setup, tool, done } from "./fixture.js";

function browserFixture(closeChild = vi.fn(async () => {})) {
  const browser: BrowserControlPort = {
    list: async () => [],
    execute: async () => {
      throw new Error("unused browser command");
    },
    closeSession: async () => {},
    forChildSession: vi.fn(() => ({
      list: async () => [],
      execute: async () => {
        throw new Error("unused browser command");
      },
      closeSession: closeChild,
    })),
  };
  return { browser, closeChild };
}
function causes(error: unknown): unknown[] {
  if (!(error instanceof Error)) return [error];
  return [
    error,
    ...causes(error.cause),
    ...(error instanceof AggregateError ? error.errors.flatMap(causes) : []),
  ];
}
it("releases a constructed child when initial child-settings persistence fails, with no model IO", async () => {
  const { browser, closeChild } = browserFixture();
  const generate = vi.fn(async () => done);
  const { runtime, store } = setup(generate, browser);
  const save = store.saveSessionEntry;
  if (!save) throw new Error("recording store must support entries");
  store.saveSessionEntry = async (entry) => {
    if (entry.type === "codex_collaboration_child_settings")
      throw new Error("settings disk failed");
    await save(entry);
  };
  const result = await tool(runtime, "spawn_agent", {
    task_name: "worker",
    message: "inspect",
    fork_turns: "none",
  });
  expect(result.success).toBe(false);
  expect(result.error?.message).toContain("settings disk failed");
  expect(generate).not.toHaveBeenCalled();
  expect(browser.forChildSession).toHaveBeenCalledTimes(1);
  expect(closeChild).toHaveBeenCalledTimes(1);
});
it("cleans a constructed cold child after hydration fails while retaining accepted history", async () => {
  const { browser, closeChild } = browserFixture();
  const generate = vi.fn(async () => done);
  const { runtime, store, rootId } = setup(generate, browser);
  await tool(runtime, "spawn_agent", {
    task_name: "worker",
    message: "accepted task",
    fork_turns: "none",
  });
  await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
  await runtime.shutdownCollaboration();
  const child = (await store.listSessions()).find(
    (session) => session.taskType === "subagent_child",
  );
  if (!child) throw new Error("accepted child missing");
  const history = await store.messages({ sessionID: child.id });
  const getSession = store.getSession;
  store.getSession = async (sessionId) => {
    if (sessionId === child.id) throw new Error("cold hydration read failed");
    return getSession(sessionId);
  };
  const restored = createTestAgentRuntime(
    rootId,
    { mode: "yolo", memory: { enabled: false } },
    {
      sessionStore: store,
      eventStore: createTestSessionEventStore(),
      browserControlPort: browser,
      modelFactory: createTestModelFactory({ generateText: generate }),
    },
  );
  roots.push(restored);
  const result = await tool(restored, "followup_task", { target: "worker", message: "continue" });
  expect(result.success).toBe(false);
  expect(result.error?.message).toContain("cold hydration read failed");
  expect(closeChild).toHaveBeenCalledTimes(2);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(await store.messages({ sessionID: child.id })).toEqual(history);
});
it("preserves prepare and cleanup causes and retries the same retained resource handle on shutdown", async () => {
  const diskFailure = new Error("settings disk failed");
  const closeFailure = new Error("browser release failed");
  const closeChild = vi
    .fn()
    .mockRejectedValueOnce(closeFailure)
    .mockRejectedValueOnce(closeFailure)
    .mockResolvedValue(undefined);
  const { browser } = browserFixture(closeChild);
  const { runtime, store } = setup(async () => done, browser);
  const save = store.saveSessionEntry;
  if (!save) throw new Error("recording store must support entries");
  store.saveSessionEntry = async (entry) => {
    if (entry.type === "codex_collaboration_child_settings") throw diskFailure;
    await save(entry);
  };
  const binding = (runtime as unknown as AgentRuntimeInternal).collaboration;
  if (!binding) throw new Error("collaboration binding missing");
  const failure = await binding.port
    .spawn(
      { task_name: "worker", message: "inspect", fork_turns: "none" },
      {
        toolCallId: "spawn",
        signal: new AbortController().signal,
      },
    )
    .catch((error: unknown) => error);
  expect(causes(failure)).toContain(diskFailure);
  expect(causes(failure)).toContain(closeFailure);
  expect(closeChild).toHaveBeenCalledTimes(2);
  await runtime.shutdownCollaboration();
  expect(closeChild).toHaveBeenCalledTimes(3);
});
