import assert from "node:assert/strict";
import test from "node:test";

import { builtInTools } from "../src/tool/handlers/index.js";
import {
  FORK_TOOL_MODE_CLASSIFICATION,
  resolveForkToolModeToolNames,
} from "../src/fork/tool-modes/mode-tools.js";

test("注册表里的每个工具都被归类且只归一次", () => {
  const registered = builtInTools.map((entry) => entry.metadata.name);
  const classified = FORK_TOOL_MODE_CLASSIFICATION.flatMap((entry) => entry.toolNames);

  // 重复归类：同一个工具出现在两档里，说明分类自相矛盾。
  assert.equal(
    new Set(classified).size,
    classified.length,
    `工具被重复归类：${classified.filter((name, index) => classified.indexOf(name) !== index).join(", ")}`,
  );

  // 上游新增工具时这里变红——必须显式决定它属于哪一档，而不是让它静默落进极简/基础。
  const unclassified = registered.filter((name) => !classified.includes(name));
  assert.deepEqual(unclassified, [], `新增工具未归类：${unclassified.join(", ")}`);

  // 改名或下架时这里变红——分类里留着一个注册表没有的名字，档位会表达一个不存在的工具。
  const stale = classified.filter((name) => !registered.includes(name));
  assert.deepEqual(stale, [], `分类里的工具已不在注册表：${stale.join(", ")}`);
});

test("档位解析：极简 8 个、基础 33 个、标准不下发", () => {
  const minimal = resolveForkToolModeToolNames("minimal");
  assert.equal(minimal?.length, 8);
  assert.ok(minimal?.includes("Read"));
  assert.ok(!minimal?.includes("Agent"));
  assert.ok(!minimal?.includes("CronCreate"));

  const basic = resolveForkToolModeToolNames("basic");
  assert.equal(basic?.length, 33);
  assert.ok(basic?.includes("Agent") && basic?.includes("Skill"));
  assert.ok(!basic?.includes("js"));

  // undefined = 不下发 = 不加约束（标准档等于改动前的行为）。
  assert.equal(resolveForkToolModeToolNames("standard"), undefined);
});
