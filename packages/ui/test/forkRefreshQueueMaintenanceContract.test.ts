import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("refresh queue cards remain maintenance commands rather than editable messages", async () => {
  const source = await readFile(
    new URL("../src/v4/ConversationQueuePanel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /const isMaintenance = item.kind === "compact" \|\| item.kind === "refresh"/,
  );
  assert.match(source, /onEditItem && !isMaintenance/);
  assert.match(source, /id: isMaintenance \? "chat.queue.runNow" : "chat.queue.sendNow"/);
  assert.match(
    source,
    /text=\{isMaintenance \? `\/\$\{item.kind\}` : parsedInput.visibleContent\}/,
  );
});
