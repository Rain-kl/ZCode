import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createToolRegistry, registerBuiltInTools } from "../src/tool/index.js";

/**
 * 契约：闲时任务（off-peak）在本 fork 不可用——它需要云端取号服务与 Coding Plan 连接，
 * 而本项目的用户只用自定义服务提供商。所以这不是「灰度开关关了」，而是工具面里根本不存在
 * 这两个工具：模型的每一次请求都不应为它们付出 token，模型也不该看到一个必然失败的工具。
 *
 * 见 docs/features/offpeak-removal/design.md。
 */

const OFF_PEAK_TOOL_NAMES = ["OffPeakCreate", "OffPeakList"] as const;

function registeredToolNames(options: Parameters<typeof registerBuiltInTools>[1]): string[] {
  const registry = createToolRegistry();
  registerBuiltInTools(registry, options);
  return registry.list();
}

/** provider 契约就是模型请求里的 `tools`：断言要落在这一层，而不是只看注册表。 */
function providerContractNames(options: Parameters<typeof registerBuiltInTools>[1]): string[] {
  const registry = createToolRegistry();
  registerBuiltInTools(registry, options);
  return registry.toContracts().map((contract) => contract.name);
}

test("常规装配下闲时工具不注册", () => {
  const names = registeredToolNames({});
  for (const toolName of OFF_PEAK_TOOL_NAMES) {
    assert.equal(names.includes(toolName), false, `${toolName} 不应出现在工具面`);
  }
});

test("把所有可选工具面开关都打开，闲时工具依然不注册", () => {
  const names = registeredToolNames({
    includeAgent: true,
    includeAutomation: true,
    includeBrowserUse: true,
    includeDynamicWorkflow: true,
    includeEscalate: true,
    includeNodeRepl: true,
    includeRespondToCoordinator: true,
    includeSendMessage: true,
    includeSkill: true,
    includeSubmitResult: true,
    includeWorkflow: true,
  });
  for (const toolName of OFF_PEAK_TOOL_NAMES) {
    assert.equal(names.includes(toolName), false, `${toolName} 不应被任何开关打开`);
  }
});

test("provider 契约（模型请求的 tools）里没有闲时工具", () => {
  const names = providerContractNames({ includeAutomation: true });
  for (const toolName of OFF_PEAK_TOOL_NAMES) {
    assert.equal(names.includes(toolName), false);
  }
});

/**
 * 源码级不变量：注册表文件与运行时工具装配里都不该再出现闲时概念。
 * 上游把条目加回来（或新增第三个闲时工具）时，这两条会直接红——比只断言两个名字更耐久。
 *
 * 直接扫原文（不剥注释）：FORK 标记里写的是「闲时工具 / off-peak」，被禁的标识符一个都不许出现，
 * 这样 grep 一个文件就能确认移除没有被合并回滚。
 */
test("注册表文件不再引用闲时工具", () => {
  const source = readFileSync(new URL("../src/tool/handlers/index.ts", import.meta.url), "utf8");
  assert.equal(
    /offPeak|OffPeak|OFF_PEAK/.test(source),
    false,
    "工具注册表不应再引用闲时工具（上游条目被合回来会让它重新进入模型上下文）",
  );
});

test("运行时工具装配不再有闲时开关", () => {
  const source = readFileSync(
    new URL("../src/runtime/helpers/runtime-tools.ts", import.meta.url),
    "utf8",
  );
  assert.equal(/includeOffPeak/.test(source), false, "工具装配不应再有 includeOffPeak 开关");
});
