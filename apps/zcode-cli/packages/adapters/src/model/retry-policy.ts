// FORK(codex-collaboration): adapter 配置复用共享恢复合同的请求数与等待硬上限。
import { MODEL_RECOVERY_MAX_ATTEMPTS, MODEL_RECOVERY_MAX_DELAY_MS } from "@zcode/contracts";

export interface AiSdkModelRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  backoffFactor?: number;
  maxDelayMs?: number;
  jitter?: boolean;
}

export type ResolvedAiSdkModelRetryOptions = Required<AiSdkModelRetryOptions>;

type EnvRecord = Record<string, string | undefined>;

// FORK(codex-collaboration): 用户恢复上限必须约束配置与 provider hints，见 FEATURES.md。
const DEFAULT_MAX_RETRIES = MODEL_RECOVERY_MAX_ATTEMPTS - 1;
const DEFAULT_RETRY_BASE_DELAY_MS = 2_000;
const DEFAULT_RETRY_BACKOFF_FACTOR = 2;
// FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
const DEFAULT_RETRY_MAX_DELAY_MS = MODEL_RECOVERY_MAX_DELAY_MS;

const ENV_MODEL_RETRY_MAX_RETRIES = "ZCODE_MODEL_RETRY_MAX_RETRIES";
const ENV_MODEL_RETRY_BASE_DELAY_MS = "ZCODE_MODEL_RETRY_BASE_DELAY_MS";
const ENV_MODEL_RETRY_BACKOFF_FACTOR = "ZCODE_MODEL_RETRY_BACKOFF_FACTOR";
const ENV_MODEL_RETRY_MAX_DELAY_MS = "ZCODE_MODEL_RETRY_MAX_DELAY_MS";

const DEFAULT_RETRY_OPTIONS: ResolvedAiSdkModelRetryOptions = {
  backoffFactor: DEFAULT_RETRY_BACKOFF_FACTOR,
  baseDelayMs: DEFAULT_RETRY_BASE_DELAY_MS,
  jitter: true,
  // maxAttempts includes the first request; env/config names expose retry count.
  maxAttempts: DEFAULT_MAX_RETRIES + 1,
  maxDelayMs: DEFAULT_RETRY_MAX_DELAY_MS,
};

export function resolveAiSdkModelRetryOptions(
  options: AiSdkModelRetryOptions | undefined,
  env: EnvRecord,
): ResolvedAiSdkModelRetryOptions {
  const envOptions = readRetryOptionsFromEnv(env);
  return {
    backoffFactor: normalizePositiveNumber(
      options?.backoffFactor,
      normalizePositiveNumber(envOptions.backoffFactor, DEFAULT_RETRY_OPTIONS.backoffFactor),
    ),
    baseDelayMs: normalizeNonNegativeInteger(
      options?.baseDelayMs,
      normalizeNonNegativeInteger(envOptions.baseDelayMs, DEFAULT_RETRY_OPTIONS.baseDelayMs),
    ),
    jitter: options?.jitter ?? DEFAULT_RETRY_OPTIONS.jitter,
    // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
    maxAttempts: Math.min(
      MODEL_RECOVERY_MAX_ATTEMPTS,
      normalizePositiveInteger(
        options?.maxAttempts,
        normalizePositiveInteger(envOptions.maxAttempts, DEFAULT_RETRY_OPTIONS.maxAttempts),
        // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
      ),
    ),
    maxDelayMs: Math.min(
      MODEL_RECOVERY_MAX_DELAY_MS,
      normalizeNonNegativeInteger(
        options?.maxDelayMs,
        normalizeNonNegativeInteger(envOptions.maxDelayMs, DEFAULT_RETRY_OPTIONS.maxDelayMs),
        // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
      ),
    ),
  };
}

function readRetryOptionsFromEnv(env: EnvRecord): AiSdkModelRetryOptions {
  const maxRetries = parseNonNegativeInteger(env[ENV_MODEL_RETRY_MAX_RETRIES]);
  return {
    backoffFactor: parsePositiveNumber(env[ENV_MODEL_RETRY_BACKOFF_FACTOR]),
    baseDelayMs: parseNonNegativeInteger(env[ENV_MODEL_RETRY_BASE_DELAY_MS]),
    maxAttempts: maxRetries === undefined ? undefined : maxRetries + 1,
    maxDelayMs: parseNonNegativeInteger(env[ENV_MODEL_RETRY_MAX_DELAY_MS]),
  };
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.floor(parsed);
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function normalizePositiveNumber(value: number | undefined, fallback: number): number {
  // FORK(codex-collaboration): 指数恢复必须递增；恒定/递减覆盖回退既有配置优先级。
  if (value === undefined || !Number.isFinite(value) || value <= 1) {
    return fallback;
  }
  return value;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}
