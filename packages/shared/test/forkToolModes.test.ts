import assert from "node:assert/strict";
import test from "node:test";

import {
  FORK_TOOL_MODE_ALL_BUILTIN_TOOL_NAMES,
  buildForkToolModeState,
  parseForkToolModeStateFile,
  resolveForkToolModeDenylist,
  resolveForkToolModeToolNames,
} from "@zcode/shared";

test("三档是包含关系，且工具名不重复", () => {
  const minimal = resolveForkToolModeToolNames("minimal");
  const basic = resolveForkToolModeToolNames("basic");
  const standard = resolveForkToolModeToolNames("standard");

  assert.equal(minimal.length, 8);
  assert.equal(basic.length, 33);
  assert.equal(standard.length, 38);
  for (const name of minimal) assert.ok(basic.includes(name) && standard.includes(name));
  for (const name of basic) assert.ok(standard.includes(name));
  assert.equal(new Set(FORK_TOOL_MODE_ALL_BUILTIN_TOOL_NAMES).size, 38);
});

test("denylist 由档位与注入开关派生：标准为空、极简 30 个、关闭注入为全部", () => {
  assert.deepEqual(resolveForkToolModeDenylist({ mode: "standard", injectTools: true }), []);
  assert.equal(resolveForkToolModeDenylist({ mode: "minimal", injectTools: true }).length, 30);
  assert.equal(resolveForkToolModeDenylist({ mode: "basic", injectTools: true }).length, 5);
  assert.equal(resolveForkToolModeDenylist({ mode: "minimal", injectTools: false }).length, 38);

  const minimalDeny = resolveForkToolModeDenylist({ mode: "minimal", injectTools: true });
  assert.ok(!minimalDeny.includes("Read"));
  assert.ok(minimalDeny.includes("js"));
  assert.ok(minimalDeny.includes("CronCreate"));
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
  assert.equal(standard.disabledToolNames.length, 0);

  const basic = buildForkToolModeState({ schemaVersion: 1, injectTools: true, mode: "basic" });
  assert.equal(basic.mcpEnabled, false);
  assert.deepEqual(basic.disabledToolNames, [
    "js",
    "Task",
    "submit_result",
    "escalate",
    "RespondToCoordinator",
  ]);

  const off = buildForkToolModeState({ schemaVersion: 1, injectTools: false, mode: "standard" });
  assert.equal(off.mcpEnabled, false);
  assert.equal(off.enabledToolNames.length, 0);
  assert.equal(off.disabledToolNames.length, 38);
});
