import { ModelRetryBudget } from "@zcode/contracts";
import type { ResolvedAiSdkModelRetryOptions } from "./retry-policy.js";

/**
 * FORK(codex-collaboration): legacy unbounded 档位只保留兼容识别，所有 API 请求统一有界。
 * single-attempt 只限制当前 provider invocation；共享 chain budget 包含后续声明式 fallback。
 * auth、签名修复和排队探测均为物理请求，不再拥有额外预算。
 */

/** 旧状态事件「无上限」的兼容哨兵；新执行路径只发布有限的 maxAttempts。 */
export const UNBOUNDED_RETRY_MAX_ATTEMPTS = 0;
/** `single-attempt` 预算下本次请求允许的总尝试数（含首次）。 */
export const SINGLE_ATTEMPT_MAX_ATTEMPTS = 1;

export function isUnboundedRetryBudget(budget: ModelRetryBudget | undefined): boolean {
  return budget === ModelRetryBudget.Unbounded;
}

export function isSingleAttemptRetryBudget(budget: ModelRetryBudget | undefined): boolean {
  return budget === ModelRetryBudget.SingleAttempt;
}

/**
 * 按预算档位解析本次请求实际生效的 retry 选项。runner 入口统一走这里，避免在 attempt 循环、
 * 失败闸门、empty completion 与状态事件四处分别特判档位。
 */
export function resolveRetryOptionsForBudget(
  retry: ResolvedAiSdkModelRetryOptions,
  budget: ModelRetryBudget | undefined,
): ResolvedAiSdkModelRetryOptions {
  return isSingleAttemptRetryBudget(budget)
    ? { ...retry, maxAttempts: SINGLE_ATTEMPT_MAX_ATTEMPTS }
    : retry;
}

/** 失败之后还允许再试一次吗（等价于既有的 `retryBudgetAttempt < maxAttempts`，兼容旧档位也受硬上限约束）。 */
export function retryBudgetAllows(
  // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
  _budget: ModelRetryBudget | undefined,
  retryBudgetAttempt: number,
  maxAttempts: number,
): boolean {
  // FORK(codex-collaboration): 兼容旧档位，但工作流也遵守硬预算。
  return retryBudgetAttempt < Math.min(maxAttempts, 21);
}

/** attempt 循环的继续条件（等价于既有的 `attempt <= loopMaxAttempts`，兼容旧档位也受硬上限约束）。 */
export function retryAttemptLoopContinues(
  // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
  _budget: ModelRetryBudget | undefined,
  attempt: number,
  loopMaxAttempts: number,
): boolean {
  // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
  return attempt <= Math.min(loopMaxAttempts, 21);
}

/** 写进新状态事件 / 日志的有限 maxAttempts。 */
export function retryBudgetMaxAttempts(
  // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
  _budget: ModelRetryBudget | undefined,
  maxAttempts: number,
): number {
  // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
  return Math.min(maxAttempts, 21);
}
