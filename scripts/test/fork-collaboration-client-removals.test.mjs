import assert from "node:assert/strict";
import { test } from "node:test";
import { REGISTRY } from "../fork-removal-rules.mjs";

test("collaboration client removals survive an upstream merge", () => {
  const rule = REGISTRY.find((entry) => entry.featureId === "codex-collaboration");
  assert.ok(rule);
  for (const name of ["send-message", "respond-to-coordinator"]) {
    assert.ok(
      rule.absentFiles.some(
        (entry) => entry.path === `packages/ui/src/ToolCallBlocks/renderers/${name}.tsx`,
      ),
    );
  }
  for (const path of [
    "apps/zcode-cli/packages/contracts/src/tools/tool-result-metadata.ts",
    "packages/shared/src/zcode-protocol-v4/toolDisplay.ts",
    "packages/shared/src/conversation-share-tool-presentation.ts",
    "packages/ui/src/ToolCallBlocks/toolResultDisplay.ts",
  ]) {
    for (const discriminant of ["local_agent_message", "respond_to_coordinator"]) {
      assert.ok(
        rule.absentPatternsInFile.some(
          (entry) => entry.path === path && entry.pattern.test(discriminant),
        ),
        `${path}: ${discriminant}`,
      );
    }
  }
  for (const name of ["Agent", "Task", "SendMessage", "RespondToCoordinator"]) {
    assert.ok(
      rule.absentPatternsInFile.some(
        (entry) =>
          entry.path === "packages/shared/src/tool-identity.ts" && entry.pattern.test(`"${name}"`),
      ),
      name,
    );
  }
});

test("removed legacy completion notifications cannot return as a second child owner", () => {
  const rule = REGISTRY.find((entry) => entry.featureId === "codex-collaboration");
  assert.ok(rule);
  assert.ok(rule.absentFiles.some((entry) =>
    entry.path === "apps/zcode-cli/packages/core/src/subagent/completion-notification.ts"));
});
