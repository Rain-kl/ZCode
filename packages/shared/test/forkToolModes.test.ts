import assert from "node:assert/strict";
import test from "node:test";

import { buildForkToolModeState, parseForkToolModeStateFile } from "@zcode/shared";

test("状态文件解析：缺失与损坏一律回落到「标准 + 注入」", () => {
  const fallback = { schemaVersion: 1, injectTools: true, mode: "standard" };
  assert.deepEqual(parseForkToolModeStateFile(undefined), fallback);
  assert.deepEqual(parseForkToolModeStateFile("nope"), fallback);
  assert.deepEqual(parseForkToolModeStateFile({ schemaVersion: 99, mode: "minimal" }), fallback);
  assert.deepEqual(parseForkToolModeStateFile({ schemaVersion: 1, mode: "turbo" }), fallback);
  assert.deepEqual(parseForkToolModeStateFile({ schemaVersion: 1, mode: "minimal" }), {
    schemaVersion: 1,
    injectTools: true,
    mode: "minimal",
  });
  assert.deepEqual(
    parseForkToolModeStateFile({ schemaVersion: 1, mode: "minimal", injectTools: false }),
    { schemaVersion: 1, injectTools: false, mode: "minimal" },
  );
});

test("给 UI 的状态：只有标准档且注入开启时才下发 MCP", () => {
  const standard = buildForkToolModeState({
    schemaVersion: 1,
    injectTools: true,
    mode: "standard",
  });
  assert.equal(standard.mcpEnabled, true);

  const basic = buildForkToolModeState({ schemaVersion: 1, injectTools: true, mode: "basic" });
  assert.equal(basic.mcpEnabled, false);

  const off = buildForkToolModeState({ schemaVersion: 1, injectTools: false, mode: "standard" });
  assert.equal(off.mcpEnabled, false);
});
