/**
 * 本地模式（fork local-mode）的集中开关与判定。
 *
 * 见 `FEATURES.md` 的 local-mode 条目与 `docs/features/local-mode/design.md`：
 * 本 fork 不接入云账号体系，只保留自定义提供商。UI 与 host 都从这里取判定，
 * 避免开关在多处漂移；只放常量与纯函数（除同包模块外不引入依赖），
 * 便于 `tsx --test` 直接运行单测。
 */
import { BUILTIN_MODEL_PROVIDER_IDS } from "../model-provider-types.js";
import type { BuiltinModelProviderId } from "../model-provider-types.js";

/** 本地模式总开关。true = 屏蔽云账号体系，只保留自定义提供商。 */
export const FORK_LOCAL_MODE = true;

/** 本地模式下从模型设置隐藏的预置提供商（智谱系列）。 */
export const FORK_HIDDEN_PRESET_PROVIDER_IDS: readonly BuiltinModelProviderId[] = [
  BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
  BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
];

/** 本地模式下从模型设置隐藏的 Coding Plan 套餐行。 */
export const FORK_HIDDEN_CODING_PLAN_PROVIDER_IDS: readonly BuiltinModelProviderId[] = [
  BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
  BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan,
  BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
  BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
  BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
  BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
];

/** 云账号相关界面入口（首屏登录引导、登录页、手动登录、用量、升级）是否展示。 */
export function isCloudAccountSurfaceEnabled(): boolean {
  return !FORK_LOCAL_MODE;
}

/** 云账号后台链路（静默会话恢复、断连提醒、账号 provider 下发）是否启用。 */
export function isCloudAccountBackgroundEnabled(): boolean {
  return !FORK_LOCAL_MODE;
}

export function isForkHiddenPresetProviderId(id: string): boolean {
  return FORK_HIDDEN_PRESET_PROVIDER_IDS.includes(id as BuiltinModelProviderId);
}

export function isForkHiddenCodingPlanProviderId(id: string): boolean {
  return FORK_HIDDEN_CODING_PLAN_PROVIDER_IDS.includes(id as BuiltinModelProviderId);
}

/** 按本地模式过滤预置提供商卡片；非本地模式返回原列表，便于开关回退。 */
export function filterPresetProviderSpecs<T extends { id: string }>(specs: readonly T[]): T[] {
  if (!FORK_LOCAL_MODE) {
    return [...specs];
  }
  return specs.filter((spec) => !isForkHiddenPresetProviderId(spec.id));
}

/** 按本地模式过滤 Coding Plan 套餐行；非本地模式返回原列表。 */
export function filterCodingPlanProviderSpecs<T extends { id: string }>(specs: readonly T[]): T[] {
  if (!FORK_LOCAL_MODE) {
    return [...specs];
  }
  return specs.filter((spec) => !isForkHiddenCodingPlanProviderId(spec.id));
}
