import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { createSessionId, createRootTraceContext, SessionEventType } from "@zcode/contracts";
import { createSqliteSessionStore } from "../../adapters/src/storage/session-store/sqlite-session-store.js";
import { createTestAgentRuntime } from "./test-agent-runtime.js";
import { createTestSessionEventStore } from "./test-event-store.js";
import { createTestModelFactory } from "./test-runtime-model.js";
import type { AgentRuntimeInternal } from "../src/runtime/internal.js";
import { forkStableConversationAtMessage } from "../src/runtime/methods/session-fork.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "refresh-completion-"));
  const dbPath = join(root, "session.sqlite");
  let store = await createSqliteSessionStore({ dbPath });
  const sessionId = createSessionId("refresh-completion");
  const eventStore = createTestSessionEventStore();
  const generate = vi.fn(async () => ({ text: "done", finishReason: "stop" as const, usage: {} }));
  const runtime = createTestAgentRuntime(
    sessionId,
    { workspacePath: root, modelStreaming: "off", titleGeneration: { enabled: false } },
    {
      sessionStore: store,
      eventStore,
      modelFactory: createTestModelFactory({ generateText: generate }),
    },
  );
  onTestFinished(async () => {
    await runtime.closeBrowserSession();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    runtime,
    internal: runtime as unknown as AgentRuntimeInternal,
    sessionId,
    eventStore,
    generate,
    get store() {
      return store;
    },
    async reopen() {
      store.close();
      store = await createSqliteSessionStore({ dbPath });
    },
  };
}

it("persists refresh as an independent provider-hidden timeline without a model request", async () => {
  const f = await fixture();
  await f.runtime.executeTurn("/refresh");
  expect(f.generate).not.toHaveBeenCalled();
  const completed = (await f.eventStore.getEvents(f.sessionId)).filter(
    (event) => event.type === SessionEventType.ForkReloadCompleted,
  );
  expect(completed).toHaveLength(1);
  await f.reopen();
  const messages = await f.store.messages({ sessionID: f.sessionId });
  expect(messages).toHaveLength(1);
  expect(messages[0]?.info).toMatchObject({
    role: "assistant",
    semantics: {
      kind: "timeline_event",
      providerVisibility: "hidden",
      transcriptVisibility: "visible",
    },
  });
  expect(messages[0]?.parts[0]).toMatchObject({
    type: "timeline",
    timelineType: "fork_refresh_completed",
    completionEventId: completed[0]?.id,
  });
});

it("does not publish or retain a successful completion when timeline part persistence fails", async () => {
  const f = await fixture();
  const sink = vi.fn();
  f.runtime.subscribeEvents({ onSessionEvent: sink });
  vi.spyOn(f.store, "savePart").mockRejectedValueOnce(
    new Error("refresh fixture disk write failed"),
  );
  await expect(f.runtime.executeTurn("/refresh")).rejects.toThrow();
  const events = await f.eventStore.getEvents(f.sessionId);
  expect(
    events.filter((event) => event.type === SessionEventType.ForkReloadCompleted),
  ).toHaveLength(0);
  expect(events.some((event) => event.type === SessionEventType.TurnError)).toBe(true);
  expect(f.generate).not.toHaveBeenCalled();
  expect(
    sink.mock.calls.some(([event]) => event.type === SessionEventType.ForkReloadCompleted),
  ).toBe(false);
  const rows = await f.store.messages({ sessionID: f.sessionId });
  expect(rows.every((row) => row.parts.every((part) => part.type !== "timeline"))).toBe(true);
});

it("is idempotent by completion event and forks only independent transcript carriers in the selected prefix", async () => {
  const f = await fixture();
  await f.runtime.executeTurn("/refresh");
  const completion = (await f.eventStore.getEvents(f.sessionId)).find(
    (event) => event.type === SessionEventType.ForkReloadCompleted,
  );
  if (!completion) throw new Error("refresh completion missing");
  await f.internal.appendEvent(completion, createRootTraceContext({ sessionId: f.sessionId }));
  expect(await f.store.messages({ sessionID: f.sessionId })).toHaveLength(1);
  await f.runtime.executeTurn("first real turn");
  const prefix = await f.store.messages({ sessionID: f.sessionId });
  const boundary = prefix.at(-1);
  if (!boundary) throw new Error("fork boundary missing");
  await f.runtime.executeTurn("/refresh");
  const childId = createSessionId("refresh-fork");
  await forkStableConversationAtMessage.call(f.internal, {
    forkedSessionId: childId,
    sourceCommandId: "fork-refresh-prefix",
    goalBoundary: { kind: "none" },
    target: {
      productTurnId: "first-turn",
      transcriptTurnId: "first-transcript",
      orderedMessageIds: prefix.map((row) => String(row.info.id)),
      boundaryMessageId: String(boundary.info.id),
    },
  });
  const child = await f.store.messages({ sessionID: childId });
  const parts = child
    .flatMap((row) => row.parts)
    .filter((part) => part.type === "timeline" && part.timelineType === "fork_refresh_completed");
  expect(parts).toHaveLength(1);
  expect(parts[0]).toMatchObject({ sessionID: childId, completionEventId: completion.id });
  const original = prefix[0]?.parts[0];
  expect(parts[0]?.id).not.toBe(original?.id);
  expect(parts[0]?.messageID).not.toBe(original?.messageID);
  expect(f.generate).toHaveBeenCalledTimes(1);
});
