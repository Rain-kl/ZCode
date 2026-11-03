import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { parseV4VisibleSlashCommand } from "../../ui/src/v4/slashCommands.js";

test("fork settings refresh has a distinct command from upstream task restart", () => {
  assert.deepEqual(parseV4VisibleSlashCommand("/refresh"), {
    kind: "refresh",
    displayText: "/refresh",
  });
  assert.equal(parseV4VisibleSlashCommand("/reload"), null);
});

test("settings refresh does not consume arguments or attachments", () => {
  assert.equal(parseV4VisibleSlashCommand("/refresh extra"), null);
  assert.equal(parseV4VisibleSlashCommand("/refresh", [{}]), null);
  assert.equal(parseV4VisibleSlashCommand("/refresh", [], { contextAttachmentCount: 1 }), null);
});

// 命令协议与队列文本同时隔离，避免 UI 改名但后端仍消费上游 /reload。
test("refresh wire route and FIFO input remain settings-only", async () => {
  const command = await readFile(new URL("../src/zcode-protocol-v4/command.ts", import.meta.url), "utf8");
  const helper = await readFile(new URL("../../../apps/zcode-cli/packages/core/src/runtime/helpers/commands.ts", import.meta.url), "utf8");
  const handler = await readFile(new URL("../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/commands/handlers/reload.ts", import.meta.url), "utf8");
  assert.match(command, /refresh: z\.object\(\{\}\)/);
  assert.match(helper, /input\.trim\(\) === "\/refresh"/);
  assert.match(handler, /commandKind: "refresh"/);
  assert.match(handler, /enqueueDeferredInputForBusyWork\(record, "\/refresh"/);
  assert.match(handler, /submitPrompt\("\/refresh"/);
  assert.doesNotMatch(handler, /"\/reload"/);
});
