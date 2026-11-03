import { describe, expect, it } from "vitest";
import { SessionEventType, type MessageWithParts, type SessionEvent } from "@zcode/contracts";
import { synthesizeEventsFromMessages } from "../src/zcode-protocol-v4/transcript-hydration.js";
import {
  loadPersistedConversationMaterialization,
  mergeColdConversationEvents,
} from "../src/zcode-protocol-v4/cold-event-merge.js";
import { mapMessageWithParts } from "../src/zcode-protocol/message-mapper.js";
import { ProductProjection } from "../src/zcode-protocol-v4/product-projection.js";

function message(id: string, role: "user" | "assistant", text: string): MessageWithParts {
  const created = Number(id.replace(/\D/g, "")) || 1;
  return {
    info:
      role === "user"
        ? {
            id: id as never,
            sessionID: "s1" as never,
            role,
            time: { created },
            agent: "test",
            model: { providerID: "p" as never, modelID: "m" as never },
          }
        : {
            id: id as never,
            sessionID: "s1" as never,
            role,
            time: { created, completed: created },
            parentID: "u1" as never,
            modelID: "m" as never,
            providerID: "p" as never,
            mode: "build",
            agent: "test",
            path: { cwd: "/", root: "/" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
    parts: [
      {
        id: `${id}-p` as never,
        messageID: id as never,
        sessionID: "s1" as never,
        type: "text",
        text,
      },
    ],
  };
}
function refresh(id: string, eventId = `event-${id}`, sourceCommandId?: string): MessageWithParts {
  const host = message(id, "assistant", "");
  host.info.semantics = {
    origin: "system",
    kind: "timeline_event",
    uiVisibility: "visible",
    providerVisibility: "hidden",
    transcriptVisibility: "visible",
  };
  host.parts = [
    {
      id: `${id}-p` as never,
      messageID: id as never,
      sessionID: "s1" as never,
      type: "timeline",
      timelineType: "fork_refresh_completed",
      display: "separator",
      status: "completed",
      completionEventId: eventId,
      ...(sourceCommandId ? { sourceCommandId } : {}),
    },
  ];
  return host;
}
function project(events: SessionEvent[]) {
  const projection = new ProductProjection("s1", "refresh-test");
  events.forEach((event) => projection.applyEvent(event));
  return projection.getSnapshot();
}
const hydrate = (messages: MessageWithParts[]) =>
  synthesizeEventsFromMessages(messages, { sessionId: "s1" });

describe("fork refresh durable timeline contract", () => {
  it("restores each completion at its physical message boundary without empty work turns", () => {
    const messages = [
      refresh("r0"),
      message("u1", "user", "first"),
      message("a2", "assistant", "answer1"),
      refresh("r3", "e3", "cmd3"),
      refresh("r4"),
      message("u5", "user", "second"),
      message("a6", "assistant", "answer2"),
    ];
    const events = hydrate(messages);
    expect(events.filter((event) => event.type === SessionEventType.TurnStarted)).toHaveLength(2);
    expect(events.filter((event) => event.type === SessionEventType.ModelComplete)).toHaveLength(2);
    const markers = events.filter((event) => event.type === SessionEventType.ForkReloadCompleted);
    expect(markers).toHaveLength(3);
    expect(markers[1]?.payload).toMatchObject({ sourceCommandId: "cmd3" });
    const rows = project(events).rows.window;
    expect(
      rows.filter((row) => row.kind === "timelineMarker" && row.marker.type === "reload"),
    ).toHaveLength(3);
    const second = events.findIndex(
      (event) =>
        event.type === SessionEventType.TurnStarted &&
        (event.payload as { input: string }).input === "second",
    );
    expect(events.indexOf(markers[2]!)).toBeLessThan(second);
    expect(events.indexOf(markers[0]!)).toBeLessThan(
      events.findIndex((event) => event.type === SessionEventType.TurnStarted),
    );
  });

  it("deduplicates live + durable completion by event identity, including legacy missing sourceCommandId", () => {
    const live: SessionEvent = {
      id: "same-event" as never,
      type: SessionEventType.ForkReloadCompleted,
      sessionId: "s1" as never,
      timestamp: new Date(5),
      traceId: "trace" as never,
      sequenceNumber: 1,
      payload: {},
    };
    const result = mergeColdConversationEvents({
      sessionId: "s1",
      memoryEvents: [live],
      messages: [refresh("r1", "same-event")],
    });
    expect(
      result.events.filter((event) => event.type === SessionEventType.ForkReloadCompleted),
    ).toHaveLength(1);
    expect(
      result.events.filter((event) => event.type === SessionEventType.TurnStarted),
    ).toHaveLength(0);
    expect(result.events.map((event) => event.sequenceNumber)).toEqual(
      result.events.map((_, index) => index + 1),
    );
  });

  it("rewind removes after-cut markers even when both refreshes share the same conversation anchor", async () => {
    const messages = [
      message("u1", "user", "first"),
      message("a2", "assistant", "answer"),
      refresh("r3"),
      message("u4", "user", "removed"),
      refresh("r5"),
    ];
    const source = await loadPersistedConversationMaterialization({
      sessionId: "s1",
      memoryEvents: [
        {
          id: "old-maintenance-start" as never,
          type: SessionEventType.TurnStarted,
          turnId: "old-maintenance" as never,
          sessionId: "s1" as never,
          timestamp: new Date(4),
          traceId: "trace" as never,
          sequenceNumber: 1,
          payload: {
            input: "/refresh",
            inputVisibility: "model-only",
            executionKind: "controlOnly",
          },
        },
        {
          id: "event-r5" as never,
          type: SessionEventType.ForkReloadCompleted,
          turnId: "old-maintenance" as never,
          sessionId: "s1" as never,
          timestamp: new Date(5),
          traceId: "trace" as never,
          sequenceNumber: 2,
          payload: {},
        },
        {
          id: "old-maintenance-end" as never,
          type: SessionEventType.TurnComplete,
          turnId: "old-maintenance" as never,
          sessionId: "s1" as never,
          timestamp: new Date(6),
          traceId: "trace" as never,
          sequenceNumber: 3,
          payload: { response: "", duration: 0 },
        },
      ],
      store: {
        getSession: async () => ({
          revert: {
            targetMessageID: "u4" as never,
            keptMessageIDs: ["u1", "a2", "r3"] as never[],
            branchCutAfterMessageID: "r5" as never,
            branchGeneration: 1,
          },
        }),
        messages: async () => messages,
        readTarget: async () => null,
      },
    });
    const result = mergeColdConversationEvents({ ...source, sessionId: "s1" });
    expect(
      result.events.filter((event) => event.type === SessionEventType.ForkReloadCompleted),
    ).toHaveLength(1);
    expect(
      project(result.events).rows.window.filter((row) => row.kind === "userInput"),
    ).toHaveLength(1);
    expect(
      result.events.filter((event) => event.type === SessionEventType.TurnStarted),
    ).toHaveLength(1);
  });

  it("ignores orphan timeline-only carrier after failed part write instead of inventing a turn", () => {
    const orphan = refresh("r1");
    orphan.parts = [];
    const events = hydrate([orphan]);
    expect(events.filter((event) => event.type === SessionEventType.TurnStarted)).toHaveLength(0);
    expect(
      events.filter((event) => event.type === SessionEventType.ForkReloadCompleted),
    ).toHaveLength(0);
  });
  it("full live control maintenance chain plus durable carrier has one marker and no work shell", () => {
    const base: SessionEvent = {
      id: "refresh-live" as never,
      type: SessionEventType.ForkReloadCompleted,
      sessionId: "s1" as never,
      turnId: "maintenance" as never,
      timestamp: new Date(5),
      traceId: "trace" as never,
      sequenceNumber: 2,
      payload: {},
    };
    const result = mergeColdConversationEvents({
      sessionId: "s1",
      messages: [refresh("r1", "refresh-live")],
      memoryEvents: [
        {
          ...base,
          id: "start" as never,
          sequenceNumber: 1,
          type: SessionEventType.TurnStarted,
          payload: {
            input: "/refresh",
            inputVisibility: "model-only",
            executionKind: "controlOnly",
          },
        },
        base,
        {
          ...base,
          id: "end" as never,
          sequenceNumber: 3,
          type: SessionEventType.TurnComplete,
          payload: { response: "", duration: 0, toolCallCount: 0 },
        },
      ],
    });
    const rows = project(result.events).rows.window;
    expect(
      rows.filter((row) => row.kind === "timelineMarker" && row.marker.type === "reload"),
    ).toHaveLength(1);
    expect(
      rows.filter((row) => row.kind === "userInput" || row.kind === "turnHeader"),
    ).toHaveLength(0);
  });

  it.each(["time", "sourceCommandId"])(
    "rejects malformed persisted %s with session/message/part context",
    (field) => {
      const row = refresh("r1");
      const part = row.parts[0];
      if (part?.type !== "timeline") throw new Error("invalid fixture");
      if (field === "time") part.time = { end: Number.NaN };
      else part.sourceCommandId = "";
      expect(() => hydrate([row])).toThrow(/session=s1 message=r1 part=r1-p/);
    },
  );

  it("preserves completion identity and optional command provenance through the typed message mapper", () => {
    const mapped = mapMessageWithParts(refresh("r1", "event-mapper", "command-mapper"));
    expect(mapped.parts[0]).toMatchObject({
      type: "timeline",
      timelineType: "fork_refresh_completed",
      completionEventId: "event-mapper",
      sourceCommandId: "command-mapper",
    });
    expect(mapMessageWithParts(refresh("r2")).parts[0]).not.toHaveProperty(
      "sourceCommandId",
      "command-mapper",
    );
  });
  it("does not append a second marker for a repeated identical live event", () => {
    const event: SessionEvent = {
      id: "same-live" as never,
      type: SessionEventType.ForkReloadCompleted,
      sessionId: "s1" as never,
      timestamp: new Date(1),
      traceId: "trace" as never,
      sequenceNumber: 1,
      payload: {},
    };
    const projection = new ProductProjection("s1", "duplicate-test");
    projection.applyEvent(event);
    projection.applyEvent(event);
    expect(
      projection
        .getSnapshot()
        .rows.window.filter((row) => row.kind === "timelineMarker" && row.marker.type === "reload"),
    ).toHaveLength(1);
  });
});
