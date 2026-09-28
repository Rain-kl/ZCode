import assert from "node:assert/strict";
import test from "node:test";
import {
  FORK_HIDDEN_CODING_PLAN_PROVIDER_IDS,
  FORK_HIDDEN_PRESET_PROVIDER_IDS,
  filterCodingPlanProviderSpecs,
  filterPresetProviderSpecs,
  isCloudAccountBackgroundEnabled,
  isCloudAccountSurfaceEnabled,
  isForkHiddenCodingPlanProviderId,
  isForkHiddenPresetProviderId,
} from "../src/fork/flags.js";
import { BUILTIN_MODEL_PROVIDER_IDS } from "../src/model-provider-types.js";

test("本地模式下云账号入口与后台链路都关闭", () => {
  assert.equal(isCloudAccountSurfaceEnabled(), false);
  assert.equal(isCloudAccountBackgroundEnabled(), false);
});

test("预置提供商过滤只去掉智谱两家，保留其他", () => {
  const specs = [
    { id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan },
    { id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan },
    { id: "personal-provider-a" },
  ];
  assert.deepEqual(
    filterPresetProviderSpecs(specs).map((spec) => spec.id),
    ["personal-provider-a"],
  );
});

test("Coding Plan 行过滤覆盖六个账号套餐 id", () => {
  const specs = Object.values(BUILTIN_MODEL_PROVIDER_IDS).map((id) => ({ id }));
  assert.deepEqual(filterCodingPlanProviderSpecs(specs), []);
});

test("隐藏 id 列表都是内置账号 id，避免与上游常量漂移", () => {
  const builtinIds = new Set<string>(Object.values(BUILTIN_MODEL_PROVIDER_IDS));
  for (const id of [...FORK_HIDDEN_PRESET_PROVIDER_IDS, ...FORK_HIDDEN_CODING_PLAN_PROVIDER_IDS]) {
    assert.equal(builtinIds.has(id), true, `${id} 不在 BUILTIN_MODEL_PROVIDER_IDS 中`);
  }
});

test("判定函数对非账号 id 返回 false", () => {
  assert.equal(isForkHiddenPresetProviderId("personal-provider-a"), false);
  assert.equal(isForkHiddenCodingPlanProviderId("personal-provider-a"), false);
  assert.equal(isForkHiddenCodingPlanProviderId(BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan), true);
});
