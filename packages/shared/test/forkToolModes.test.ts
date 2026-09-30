import assert from "node:assert/strict";
import test from "node:test";

import {
  FORK_TOOL_MODE_ALL_BUILTIN_TOOL_NAMES,
  buildForkToolModeState,
  parseForkToolModeStateFile,
  resolveForkToolModeAllowlist,
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

test("allowlist 由档位与注入开关派生：标准不下发、极简 8 个、关闭注入为空", () => {
  // undefined = 不下发 = 不加约束（标准档 = 现状，含全部 MCP 与插件工具）。
  assert.equal(resolveForkToolModeAllowlist({ mode: "standard", injectTools: true }), undefined);
  // 空数组 = 一条工具都不注册；MCP 一并消失（白名单覆盖 MCP 注册）。
  assert.deepEqual(resolveForkToolModeAllowlist({ mode: "standard", injectTools: false }), []);

  const minimal = resolveForkToolModeAllowlist({ mode: "minimal", injectTools: true });
  assert.deepEqual(minimal, [
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "Bash",
    "WebFetch",
    "WebSearch",
  ]);
  const basic = resolveForkToolModeAllowlist({ mode: "basic", injectTools: true });
  assert.equal(basic?.length, 33);
  // 极简档不含工作流、定时任务、脚本运行时——白名单是封闭的，新增工具也不会自己溜进来。
  assert.ok(!minimal?.includes("CreateWorkflow"));
  assert.ok(!minimal?.includes("CronCreate"));
  assert.ok(!minimal?.includes("js"));
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
