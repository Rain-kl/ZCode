import { CollaborationError, type CollaborationClock, type WaitResult } from "../contract.js";
const DEFAULT_WAIT = 30_000;
const MIN_WAIT = 10_000;
const MAX_WAIT = 3_600_000;
/** Owns ephemeral subscriptions only; accepted state remains in the root controller. */
export class ActivityWaiters {
  private readonly listeners = new Map<string, Set<(kind: "activity" | "steered") => void>>();
  constructor(private readonly clock: CollaborationClock) {}
  notify(agentId: string, kind: "activity" | "steered"): void {
    for (const listener of this.listeners.get(agentId) ?? []) listener(kind);
  }
  close(): void {
    for (const agentId of this.listeners.keys()) this.notify(agentId, "steered");
    this.listeners.clear();
  }
  wait(
    callerId: string,
    hasUnread: () => boolean,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<WaitResult> {
    return new Promise((resolve, reject) => {
      try {
        const requested = options?.timeoutMs ?? DEFAULT_WAIT;
        if (!Number.isFinite(requested) || requested < 0 || requested > MAX_WAIT)
          throw new CollaborationError("INVALID_INPUT", "timeoutMs must be between 0 and 3600000");
        const timeoutMs = Math.max(MIN_WAIT, requested);
        let cancelTimer = () => {};
        let settled = false;
        const listeners = this.listeners.get(callerId) ?? new Set();
        this.listeners.set(callerId, listeners);
        const cleanup = () => {
          cancelTimer();
          listeners.delete(listener);
          options?.signal?.removeEventListener("abort", onAbort);
        };
        const finish = (reason: WaitResult["reason"]) => {
          if (settled) return;
          settled = true;
          cleanup();
          const text = {
            activity: "Wait completed.",
            steered: "Wait interrupted by new input.",
            timeout: "Wait timed out.",
          }[reason];
          resolve({
            reason,
            timedOut: reason === "timeout",
            timeoutMs,
            message: `${text}${requested < MIN_WAIT ? " Timeout clamped to 10000ms." : ""}`,
          });
        };
        const listener = (kind: "activity" | "steered") => finish(kind);
        const onAbort = () => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(
            new CollaborationError(
              "CANCELLED",
              "Collaboration wait cancelled",
              {},
              { cause: options?.signal?.reason },
            ),
          );
        };
        // 先订阅再检查，避免 terminal/steer 在检查与注册之间丢失。
        listeners.add(listener);
        options?.signal?.addEventListener("abort", onAbort, { once: true });
        if (options?.signal?.aborted) {
          onAbort();
          return;
        }
        if (hasUnread()) {
          finish("activity");
          return;
        }
        try {
          cancelTimer = this.clock.schedule(timeoutMs, () => finish("timeout"));
        } catch (error) {
          settled = true;
          cleanup();
          throw error;
        }
        if (settled) cancelTimer();
      } catch (error) {
        reject(error);
      }
    });
  }
}
