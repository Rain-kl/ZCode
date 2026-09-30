import assert from "node:assert/strict";
import test from "node:test";

import {
  FORK_TOOL_MODES,
  buildForkToolModeState,
  isForkToolMode,
  parseForkToolModeStateFile,
} from "@zcode/shared";

test("档位全集与判定函数同源", () => {
  // 顺序是产品决定（能力递增：标准 ⊃ 基础 ⊃ 极简），设置页的卡片顺序也读这个数组。
  assert.deepEqual([...FORK_TOOL_MODES], ["minimal", "basic", "standard"]);
  assert.equal(new Set(FORK_TOOL_MODES).size, FORK_TOOL_MODES.length, "档位全集不应有重复项");

  for (const mode of FORK_TOOL_MODES) {
    // 判定读同一个数组：往数组里加档位却忘了改判定，这一条会红。
    assert.equal(isForkToolMode(mode), true);
    assert.equal(parseForkToolModeStateFile({ schemaVersion: 1, mode }).mode, mode);
  }

  for (const rejected of ["turbo", "MINIMAL", "", null, 42, undefined, { mode: "minimal" }]) {
    assert.equal(isForkToolMode(rejected), false);
  }

  // 缺省档位必须在全集里，否则界面上会出现「一张卡片都不是选中态」。
  assert.ok(FORK_TOOL_MODES.includes(parseForkToolModeStateFile(undefined).mode));
});

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
