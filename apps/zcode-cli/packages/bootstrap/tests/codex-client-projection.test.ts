import { describe, expect, it } from "vitest";
import { SessionEventType, type SessionEvent } from "@zcode/contracts";
import { ProductProjection } from "../src/zcode-protocol-v4/product-projection.js";
import { conversationSnapshotSchema } from "@zcode/shared/zcode-protocol-v4";

describe.each(["desktop-continuous", "web-remote-replayable"])("collaboration lifecycle %s", () => {
  it("retains one opaque child/anchor across followup and rejects stale generations", () => {
    const projection = new ProductProjection("root-session", "epoch");
    let seq = 0;
    const apply = (type: SessionEvent["type"], extra: Record<string, unknown> = {}) =>
      projection.applyEvent({
        id: `e${++seq}`,
        sessionId: "root-session",
        traceId: "trace",
        sequenceNumber: seq,
        timestamp: new Date(seq * 1000),
        type,
        payload: {
          agentId: "agent-opaque-a7",
          childSessionId: "session-random-f91",
          parentToolCallId: "spawn-call-6",
          path: "/root/worker",
          generation: 1,
          background: true,
          ...extra,
        },
      } as SessionEvent);
    apply(SessionEventType.SubagentSpawned);
    apply(SessionEventType.SubagentStopped, { status: "completed" });
    apply(SessionEventType.SubagentSpawned, { generation: 2, resumed: true });
    apply(SessionEventType.SubagentStopped, { generation: 1, status: "completed" });
    apply(SessionEventType.SubagentStopped, { generation: undefined, status: "completed" });
    const snapshot = conversationSnapshotSchema.parse(projection.getSnapshot());
    expect(snapshot.rows.window.filter((row) => row.kind === "subagent")).toMatchObject([
      {
        status: "running",
        generation: 2,
        childSessionId: "session-random-f91",
        parentToolCallId: "spawn-call-6",
      },
    ]);
    expect(snapshot.subagents.running).toHaveLength(1);
    expect(snapshot.backgroundWorks).toMatchObject([
      { workId: "agent-opaque-a7", status: "running", childSessionId: "session-random-f91" },
    ]);
    apply(SessionEventType.SubagentStopped, { generation: 2, status: "cancelled" });
    apply(SessionEventType.SubagentSpawned, { generation: 2, resumed: true });
    expect(
      projection.getSnapshot().rows.window.filter((row) => row.kind === "subagent"),
    ).toMatchObject([{ status: "cancelled", generation: 2 }]);
  });
});

it("hydrates an accepted spawn crash gap from canonical seed without inventing child completion", () => {
  const p = new ProductProjection("root-session", "epoch");
  const fact = {
    version: 1 as const,
    agentId: "agent-opaque-a7",
    childSessionId: "session-random-f91",
    parentId: "root-agent",
    parentSessionId: "root-session",
    path: "/root/worker",
    generation: 2,
    toolCallId: "spawn-call-6",
    parentToolCallId: "spawn-call-6",
    agentType: "worker",
    status: "running" as const,
    summaryText: "work",
  };
  p.seedSubagents({
    revision: 1,
    childSessionIds: [fact.childSessionId],
    running: [
      {
        childSessionId: fact.childSessionId,
        subagentType: "worker",
        title: "work",
        status: "running",
      },
    ],
    lifecycle: [fact],
  });
  expect(
    conversationSnapshotSchema
      .parse(p.getSnapshot())
      .rows.window.filter((row) => row.kind === "subagent"),
  ).toMatchObject([
    {
      agentId: fact.agentId,
      childSessionId: fact.childSessionId,
      generation: 2,
      status: "running",
    },
  ]);
  p.seedSubagents({
    revision: 2,
    childSessionIds: [fact.childSessionId],
    running: [],
    lifecycle: [{ ...fact, status: "cancelled" }],
  });
  expect(p.getSnapshot().rows.window.filter((row) => row.kind === "subagent")).toMatchObject([
    { status: "cancelled" },
  ]);
  expect(p.getSnapshot().backgroundWorks).toMatchObject([
    { cancellable: false, status: "cancelled" },
  ]);
  p.seedSubagents({ revision: 3, childSessionIds: [], running: [], lifecycle: [] });
  expect(p.getSnapshot().rows.window.filter((row) => row.kind === "subagent")).toEqual([]);
  expect(p.getSnapshot().backgroundWorks).toEqual([]);
});

it("diagnoses different opaque identities claiming the same spawn anchor", () => {
  const p = new ProductProjection("root-session", "epoch");
  const event = {
    sessionId: "root-session",
    turnId: "turn",
    timestamp: new Date(0),
    type: SessionEventType.SubagentSpawned,
    payload: {
      agentId: "agent-opaque-a7",
      childSessionId: "session-random-f91",
      parentToolCallId: "spawn-call-6",
      generation: 1,
    },
  } as SessionEvent;
  p.applyEvent(event);
  expect(() =>
    p.applyEvent({
      ...event,
      payload: { ...(event.payload as object), agentId: "different-agent" },
    }),
  ).toThrow(/identity.*agent/i);
});
