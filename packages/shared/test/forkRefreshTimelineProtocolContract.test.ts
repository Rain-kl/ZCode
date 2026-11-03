import assert from "node:assert/strict";
import test from "node:test";
import {
  zcodeMessagePartSchema,
  zcodeTimelinePartSchema,
} from "../src/zcode-protocol-legacy-types.js";

const completion = {
  partId: "refresh-part",
  messageId: "refresh-message",
  sessionId: "refresh-session",
  type: "timeline",
  timelineType: "fork_refresh_completed",
  display: "separator",
  status: "completed",
  completionEventId: "refresh-event",
  sourceCommandId: "refresh-command",
};

test("legacy timeline protocol preserves the typed refresh completion and command identity", () => {
  assert.deepEqual(zcodeTimelinePartSchema.parse(completion), completion);
  assert.deepEqual(zcodeMessagePartSchema.parse(completion), completion);
});

test("legacy completions may omit command/event metadata without losing their timeline type", () => {
  const { sourceCommandId: _command, completionEventId: _event, ...legacy } = completion;
  assert.deepEqual(zcodeMessagePartSchema.parse(legacy), legacy);
});

test("refresh protocol remains strict about identity types and unsupported payload fields", () => {
  for (const invalid of [
    { ...completion, completionEventId: 42 },
    { ...completion, completionEventId: "" },
    { ...completion, sourceCommandId: 42 },
    { ...completion, sourceCommandId: "" },
    { ...completion, unexpected: true },
  ]) {
    assert.equal(zcodeTimelinePartSchema.safeParse(invalid).success, false);
  }
});
