import type { ProtocolRuntimeCleanupOptions } from "./contract.js";

/** 调用方保留进程 deadline，清理函数只消费该绝对时间。 */
export function protocolCleanupExample(
  logger: ProtocolRuntimeCleanupOptions["logger"],
  deadlineAt: number,
): ProtocolRuntimeCleanupOptions {
  return { logger, deadlineAt };
}
