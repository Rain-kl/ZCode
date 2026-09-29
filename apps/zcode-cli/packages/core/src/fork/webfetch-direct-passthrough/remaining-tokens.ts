/**
 * 剩余上下文预算的投影（二开，见 docs/features/webfetch-direct-passthrough/design.md）。
 *
 * 口径由 runtime 唯一决定：`contextWindow − 本次请求的估算输入`，与
 * `resolveModelStepMaxOutputTokens` 使用的 `estimatedCurrentUsage` 同源同值。
 * 工具侧只读这个快照，不自行重算，避免出现第二套「剩余量」事实。
 */
export function resolveForkRemainingContextTokens(input: {
  contextWindow: number | undefined;
  estimatedCurrentUsage: number;
}): number | undefined {
  const { contextWindow, estimatedCurrentUsage } = input;
  if (contextWindow === undefined || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return undefined;
  }
  if (!Number.isFinite(estimatedCurrentUsage) || estimatedCurrentUsage < 0) {
    return undefined;
  }
  // 用量已超出窗口时给 0 而不是负数：调用方只做阈值比较，0 已经表达「没有余量」。
  return Math.max(0, Math.floor(contextWindow) - Math.floor(estimatedCurrentUsage));
}
