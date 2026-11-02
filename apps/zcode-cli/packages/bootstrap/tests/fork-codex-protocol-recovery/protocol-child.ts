import { join } from "node:path";
import { createSqliteSessionStore } from "@zcode/adapters/storage";
import { createZCodeApp } from "../../src/app/create-app.js";
import { ZCodeProtocolAgentServer } from "../../src/zcode-protocol/server.js";
import { ZCodeProtocolNdjsonConnection } from "../../src/zcode-protocol/transport.js";
import { createFaultModelFactory, FAULT_MODEL_SELECTION } from "../helpers/fault-provider-model.js";
import { createProtocolProcessLifecycle } from "../../../cli/src/protocol-lifecycle.js";
import { installCliProcessErrorBoundary } from "../../../cli/src/process-errors.js";
import { installProtocolStderrBoundary } from "../../../cli/src/protocol-stderr.js";
import { installStderrConsoleBoundary } from "../../../cli/src/protocol-console.js";

// 独立进程使用真实协议/会话/runtime；只替换测试 provider 和重试等待时间。
installProtocolStderrBoundary(process.stderr);
installStderrConsoleBoundary(process.stderr);
const lifecycle = createProtocolProcessLifecycle();
installCliProcessErrorBoundary({
  onFatal: (reason) =>
    lifecycle.requestShutdown(new Error("Recovery fixture process failed", { cause: reason })),
});
const [baseURL, workspace] = process.argv.slice(2);
if (!baseURL || !workspace) throw new Error("Recovery fixture requires provider URL and workspace");
const model = createFaultModelFactory({
  baseURL,
  apiFormat: "openai-chat-completions",
  retry: { maxAttempts: 21, baseDelayMs: 1, maxDelayMs: 2, backoffFactor: 2, jitter: false },
  streamIdleTimeoutMs: 15_000,
});
const store = await createSqliteSessionStore({ dbPath: join(workspace, "sessions.sqlite") });
const server = new ZCodeProtocolAgentServer({
  cwd: workspace,
  env: {},
  sessionStore: store,
  createZCodeApp: (options) =>
    createZCodeApp({
      ...options,
      sessionStore: store,
      providerRegistry: model.registry,
      modelAdapter: model.adapter,
      configuredDefaultModelSelection: FAULT_MODEL_SELECTION,
      skipUserConfig: true,
      env: {},
      runtimeConfig: { ...options.runtimeConfig, titleGeneration: { enabled: false } },
    }),
});
const connection = new ZCodeProtocolNdjsonConnection({
  signal: lifecycle.signal,
  input: lifecycle.input,
  output: process.stdout,
  handleMessage: (message) => server.handleMessage(message),
  onTransportClosed: (error) => server.disconnectClient(error),
  clearPostResponseMessages: () => server.clearPostResponseMessages(),
  takePostResponseBatch: (requestId) => server.takePostResponseBatch(requestId),
});
server.setNotificationSink((message) => connection.send(message));
let exitCode = 0;
try {
  connection.start();
  await connection.waitForClose();
} catch (error) {
  exitCode = 1;
  console.error(error);
  lifecycle.requestShutdown(new Error("Recovery fixture transport failed", { cause: error }));
} finally {
  lifecycle.requestShutdown();
  try {
    await server.shutdown();
    server.disposeProjections();
    await store.close();
    model.dispose();
    // 区分真正完成资源清理与 lifecycle 的兜底退出 deadline。
    process.stderr.write("RECOVERY_FIXTURE_SHUTDOWN_COMPLETE\n");
  } catch (error) {
    exitCode = 1;
    console.error(error);
  }
  await lifecycle.complete(exitCode);
}
