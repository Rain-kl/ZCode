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
  const command = await readFile(
    new URL("../src/zcode-protocol-v4/command.ts", import.meta.url),
    "utf8",
  );
  const helper = await readFile(
    new URL(
      "../../../apps/zcode-cli/packages/core/src/runtime/helpers/commands.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const handler = await readFile(
    new URL(
      "../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/commands/handlers/reload.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(command, /refresh: z\.object\(\{\}\)/);
  assert.match(helper, /input\.trim\(\) === "\/refresh"/);
  assert.match(handler, /commandKind: "refresh"/);
  assert.match(handler, /enqueueDeferredInputForBusyWork\(record, "\/refresh"/);
  assert.match(handler, /submitPrompt\("\/refresh"/);
  assert.doesNotMatch(handler, /"\/reload"/);
});

// App-local reload 不进入 native 命令表，但仍要阻止 custom command 同名抢占。
test("App restart and fork refresh both reserve their slash names", async () => {
  const surface = await readFile(
    new URL(
      "../../../apps/zcode-cli/packages/bootstrap/src/slash-command-surface.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(surface, /EXTRA_RESERVED_SLASH_COMMAND_NAMES = \[[^\]]*"reload"/);
  assert.match(surface, /APP_PROTOCOL_VISIBLE_BUILTIN_SLASH_COMMAND_NAMES = \[[^\]]*"refresh"/);
});

test("refresh input intent cannot silently downgrade to ordinary sendText", async () => {
  const intent = await readFile(
    new URL(
      "../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/commands/input-intent.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(intent, /envelope.type === "refresh"\s*\? "refresh"/);
});

test("queued refresh retains its maintenance projection and cannot be edited", async () => {
  const projection = await readFile(
    new URL(
      "../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/product-projection.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const queue = await readFile(
    new URL(
      "../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/commands/handlers/queue.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    projection,
    /payload\.intent\?\.kind === "refresh" \|\| payload\.commandKind === "refresh"/,
  );
  assert.match(queue, /queueItem\?\.kind === "compact" \|\| queueItem\?\.kind === "refresh"/);
});
