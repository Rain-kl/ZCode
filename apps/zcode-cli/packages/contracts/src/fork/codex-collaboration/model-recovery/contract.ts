/** One logical model step owns this counter; each physical provider request claims once. */
export interface ModelRecoveryBudget {
  readonly attempts: number;
  readonly maxAttempts: number;
  claimAttempt(): number | undefined;
  constrainMaxAttempts(maxAttempts: number): void;
}

export const MODEL_RECOVERY_MAX_ATTEMPTS = 21;
export const MODEL_RECOVERY_MAX_DELAY_MS = 30_000;
export const MODEL_RECOVERY_MAX_RETRY_AFTER_MS = 300_000;

/** Provider hints are independent of ordinary backoff; invalid hints never freeze admission. */
export function isModelRecoveryRetryAfterMs(value: number | undefined): value is number {
  return (
    value !== undefined &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MODEL_RECOVERY_MAX_RETRY_AFTER_MS
  );
}

/** Lower overrides tighten the global bound; no caller can increase it. */
export function createModelRecoveryBudget(
  maxAttempts = MODEL_RECOVERY_MAX_ATTEMPTS,
): ModelRecoveryBudget {
  let limit = Number.isFinite(maxAttempts)
    ? Math.min(MODEL_RECOVERY_MAX_ATTEMPTS, Math.max(1, Math.floor(maxAttempts)))
    : MODEL_RECOVERY_MAX_ATTEMPTS;
  let attempts = 0;
  return Object.freeze({
    get attempts() {
      return attempts;
    },
    get maxAttempts() {
      return limit;
    },
    constrainMaxAttempts(maxAttempts: number) {
      if (Number.isFinite(maxAttempts))
        limit = Math.min(limit, Math.max(1, Math.floor(maxAttempts)));
    },
    claimAttempt() {
      if (attempts >= limit) return undefined;
      attempts += 1;
      return attempts;
    },
  });
}
