import type { Logger } from "@zcode/contracts";
import type { ZCodeApp, ZCodeAppOptions } from "../../app/types.js";

export type ProtocolAppFactory = (
  options?: Omit<ZCodeAppOptions, "providerRegistry">,
) => ZCodeApp | Promise<ZCodeApp>;

/** 进程边界的有限关闭端口；业务会话和进程 deadline 仍由现有所有者维护。 */
export interface ProtocolRuntimeCleanupOptions {
  logger: Pick<Logger, "warn">;
  deadlineAt?: number;
  server?: { shutdown(): Promise<void>; disposeProjections(): void };
  processResourceSampler?: { stop(): unknown };
  mcpTelemetryTracker?: { stop(): unknown };
  nodeReplBrowserBroker?: { close(): unknown };
  mcpPort?: { close(): unknown };
  mcpConnectionPool?: { close(): unknown };
  sessionStore?: { close(): unknown };
  providerRegistryRuntime?: { dispose(): unknown };
}
