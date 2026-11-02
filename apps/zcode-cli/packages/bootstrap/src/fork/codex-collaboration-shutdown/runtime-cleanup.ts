import { shutdownPreparedModelTelemetry } from "@zcode/telemetry";
import type { ProtocolRuntimeCleanupOptions } from "./contract.js";

const DEFAULT_CLEANUP_BUDGET_MS = 1_200;
const CLEANUP_STEP_BUDGET_MS = 400;

// 超时只代表停止等待，不能作为子会话停止使用共享依赖的证据。
export async function cleanupProtocolRuntime(
  options: ProtocolRuntimeCleanupOptions,
): Promise<void> {
  const deadline = options.deadlineAt ?? Date.now() + DEFAULT_CLEANUP_BUDGET_MS;
  const step = async (resource: string, cleanup: () => unknown | Promise<unknown>) => {
    let timeout: NodeJS.Timeout | undefined;
    try {
      // 共用绝对 deadline；某项失败/挂起不阻止其余资源被尝试，也不逐项续时。
      await Promise.race([
        Promise.resolve().then(cleanup),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Protocol cleanup timed out")),
            Math.max(0, Math.min(CLEANUP_STEP_BUDGET_MS, deadline - Date.now())),
          );
        }),
      ]);
      return true;
    } catch (error) {
      options.logger.warn(`ZCode Protocol ${resource} shutdown failed`, {
        errorType: error instanceof Error ? error.name : typeof error,
        error: cleanupFailureContext(error),
        event: `zcode_protocol.${resource}.shutdown.failed`,
        module: "bootstrap.zcode_protocol",
      });
      return false;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
  await Promise.all([
    step("sampler", () => options.processResourceSampler?.stop()),
    step("mcp_telemetry", () => options.mcpTelemetryTracker?.stop()),
  ]);
  const drained = await step("sessions", () => options.server?.shutdown());
  await step("projections", () => options.server?.disposeProjections());
  if (drained) {
    await Promise.all([
      step("node_repl_browser_broker", () => options.nodeReplBrowserBroker?.close()),
      step("mcp", () => options.mcpPort?.close()),
      step("mcp_pool", () => options.mcpConnectionPool?.close()),
    ]);
    await Promise.all([
      step("session_store", () => options.sessionStore?.close()),
      step("provider_registry", () => options.providerRegistryRuntime?.dispose()),
    ]);
  } else {
    options.logger.warn(
      "ZCode Protocol retains shared resources until process exit because app drain did not complete",
      {
        event: "zcode_protocol.dependencies.retained",
        module: "bootstrap.zcode_protocol",
        deadlineAt: deadline,
        resources: [
          "node_repl_browser_broker",
          "mcp",
          "mcp_pool",
          "session_store",
          "provider_registry",
        ],
      },
    );
  }
  await step("telemetry", () => shutdownPreparedModelTelemetry());
}

function cleanupFailureContext(error: unknown, seen = new Set<unknown>()): unknown {
  if (!(error instanceof Error)) return { thrown: String(error) };
  if (seen.has(error)) return { name: error.name, message: "Circular error cause" };
  seen.add(error);
  return {
    name: error.name,
    message: error.message,
    ...(error.cause === undefined ? {} : { cause: cleanupFailureContext(error.cause, seen) }),
    ...(error instanceof AggregateError
      ? { errors: error.errors.map((cause: unknown) => cleanupFailureContext(cause, seen)) }
      : {}),
  };
}
