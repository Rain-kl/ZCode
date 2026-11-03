// FORK-BEGIN(cloud-web-access): headless Server 使用本机 home 作为无项目时的会话目录。
import { homedir, hostname } from "node:os";
// FORK-END(cloud-web-access)
// FORK-BEGIN(cloud-web-access): 独立连接器复用既有 Core bridge 与项目快照，不复制服务容器。
import {
  buildHeadlessWorkspaceSnapshot,
  createForkRemoteConnector,
  openLoopbackCoreBridge,
} from "@zcode/fork-remote-connector/module";
// FORK-END(cloud-web-access)
import {
  createServerHostServices,
  disposeServiceResourcesAndWait,
  materializeZCodeBuiltinProviderConfig,
  getAppConfigDir,
  ZCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV,
  createTopicResourcePeers,
} from "@zcode/services/node";
// FORK(cloud-web-access): connector 读取现有项目服务的 primary root，不建立第二份项目事实。
import { IProjectService, IZCodeAgentService } from "@zcode/services";
import { ZCODE_APP_VERSION_ENV, ZCODE_VERSION } from "@zcode/shared";
import { createCoreHttpServer } from "./http.js";
import { createIngressToken } from "./ingressToken.js";
import { installParentDisconnectHandler } from "./parentDisconnect.js";
import { resolveCoreServerId } from "./serverIdentity.js";
import { createTaskActivityTracker } from "./taskActivityTracker.js";
import { CORE_HEARTBEAT_INTERVAL_MS } from "../contracts.js";
// FORK(cloud-web-access): Relay 配置由独立 managed 模块读取；Core 不解析或写入凭据文件。
import {
  isCloudWebAccessRequired,
  readRemoteConnectionConfig,
  requireRemoteConnectionConfig,
} from "../fork/cloud-web-access/module.js";
import { resolveServerLayout } from "../runtime/paths.js";

declare const __ZCODE_BUILTIN_PROVIDER_CONFIG_JSON__: string | undefined;

// FORK(cloud-web-access): Relay 启动失败时按外部 attachment、HTTP、服务的所有者顺序清理。
export async function cleanupFailedRelayStartup(options: {
  stopConnector: () => void;
  closeHttp: () => Promise<void>;
  disposeServices: () => Promise<void>;
}): Promise<void> {
  // Relay may already own socket callbacks into the loopback Core; revoke it before closing the
  // HTTP bridge or service collection. Cleanup errors cannot prevent later owners from releasing.
  try {
    options.stopConnector();
  } catch {
    // The original startup error remains authoritative; continue releasing the remaining owners.
  }
  await options.closeHttp().catch(() => undefined);
  await options.disposeServices().catch(() => undefined);
}

export async function runServerCore(
  generation: number,
  // FORK(cloud-web-access): 进程退出前等待 canonical 日志队列落盘。
  beforeExit?: () => Promise<void>,
): Promise<void> {
  // Bug 原因：Agent 的模型请求头从 ZCODE_APP_VERSION 读 App 版本，缺失时回退到 CLI 包版本
  // （0.17.0）。本地由 Desktop main 注入；远端 Core 由 SSH/WSL/Docker exec → Supervisor fork 拉起，
  // 整条链都没有这个 env，远端请求于是报 0.17.0（按客户端版本拦截的网关会拒绝）。升级时旧 Supervisor
  // 会拉起新 release 的 Core，所以只能由 Core 用自身编译期版本写入，Agent spawn 时继承。
  process.env[ZCODE_APP_VERSION_ENV] = ZCODE_VERSION;
  let shutdown: ((reason: string) => Promise<void>) | undefined;
  let parentDisconnected = false;
  let disposeParentDisconnectHandler = (): void => undefined;
  disposeParentDisconnectHandler = installParentDisconnectHandler(() => {
    if (shutdown) void shutdown("parent-disconnected");
    else parentDisconnected = true;
  });
  const layout = resolveServerLayout(process.env.ZCODE_SERVER_ROOT?.trim());
  // FORK-BEGIN(cloud-web-access): server up 强制 Relay；普通 serve 无配置时保持原生命周期。
  const remoteConnectionRequired = isCloudWebAccessRequired(process.env);
  const configuredRemoteConnection = remoteConnectionRequired
    ? await requireRemoteConnectionConfig({
        remoteConnectionFile: layout.remoteConnectionFile,
        logsDir: layout.logsDir,
      })
    : await readRemoteConnectionConfig({
        remoteConnectionFile: layout.remoteConnectionFile,
        logsDir: layout.logsDir,
      });
  const remoteConnection =
    configuredRemoteConnection && Date.parse(configuredRemoteConnection.expiresAt) > Date.now()
      ? configuredRemoteConnection
      : undefined;
  if (!remoteConnection && remoteConnectionRequired) {
    throw new Error("ZCode Server Relay configuration is missing or expired");
  }
  if (configuredRemoteConnection && !remoteConnection) {
    console.warn(
      "ZCode Server Relay login has expired; ordinary serve continues without remote access",
    );
  }
  // FORK-END(cloud-web-access)
  const topicResourcePeers = createTopicResourcePeers();
  const explicitZCodeBuiltinProviderConfigFilePath =
    process.env[ZCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV]?.trim();
  // Built-in Config 物化到所属 Environment 配置根（~/.zcode/v2）而不是 release 自带的 runtime 目录：
  // release 目录是不可变的，同一 releaseId 重装时 assertExistingReleaseMatches 会重算整棵树的
  // 内容哈希，多出的物化文件会让校验失败。
  const zcodeBuiltinProviderConfigFilePath = explicitZCodeBuiltinProviderConfigFilePath
    ? explicitZCodeBuiltinProviderConfigFilePath
    : typeof __ZCODE_BUILTIN_PROVIDER_CONFIG_JSON__ === "string"
      ? await materializeZCodeBuiltinProviderConfig({
          environmentConfigRoot: getAppConfigDir(),
          content: __ZCODE_BUILTIN_PROVIDER_CONFIG_JSON__,
        })
      : undefined;
  if (!zcodeBuiltinProviderConfigFilePath) {
    throw new Error(
      `当前构建未嵌入 ZCode Built-in Provider Config，且未设置 ${ZCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV}`,
    );
  }
  const sourceServerId = (await resolveCoreServerId()) ?? hostname() ?? "zcode-server";
  const { services, workspaceIdentityMapper, migrationFailedPathCount } =
    await createServerHostServices({
      sourceServerId,
      zcodeBuiltinProviderConfigFilePath,
      providerProvisioningTargetEnabled: true,
      topicResourceRelayChannel: (request) => topicResourcePeers.getChannel(request),
    });
  const taskActivityTracker = createTaskActivityTracker(services.getOptional(IZCodeAgentService));
  const ingressToken = await createIngressToken(layout);
  const http = await createCoreHttpServer(services, {
    serverId: sourceServerId,
    ingressToken,
    migrationFailedPathCount,
    workspaceIdentityMapper,
    topicResourcePeers,
  });
  // FORK-BEGIN(cloud-web-access): 只有有效配置存在时才挂接 Relay owner。
  let connector: ReturnType<typeof createForkRemoteConnector> | undefined;
  if (remoteConnection) {
    const projectService = services.get(IProjectService);
    connector = createForkRemoteConnector({
      endpoint: remoteConnection.endpoint,
      sessionToken: remoteConnection.sessionToken,
      deviceMid: remoteConnection.deviceMid,
      deviceSid: remoteConnection.deviceSid,
      deviceName: hostname() || "zcode-server",
      platform: process.platform,
      appVersion: ZCODE_VERSION,
      logger: {
        info: (message, details) => console.log(message, details ?? ""),
        warn: (message, details) => console.warn(message, details ?? ""),
        error: (message, details) => console.error(message, details ?? ""),
      },
      async listWorkspaces() {
        return buildHeadlessWorkspaceSnapshot({
          sourceServerId,
          fallbackWorkspacePath: homedir(),
          projects: await projectService.readProjects(),
        });
      },
      openCoreBridge: async () =>
        await openLoopbackCoreBridge({ host: http.host, port: http.port, ingressToken }),
    });
    try {
      await connector.start();
    } catch (error) {
      await cleanupFailedRelayStartup({
        stopConnector: () => {
          connector?.stop();
        },
        closeHttp: () => http.close(),
        disposeServices: () => disposeServiceResourcesAndWait(services),
      });
      throw new Error(`ZCode Server Relay startup failed for ${remoteConnection.endpoint}`, {
        cause: error,
      });
    }
  }
  // FORK-END(cloud-web-access)
  const send = (message: unknown): Promise<void> => {
    if (typeof process.send !== "function" || process.connected === false) return Promise.resolve();
    return new Promise((resolve) => {
      try {
        process.send?.(message, () => resolve());
      } catch {
        // 父进程断连后的最后一条生命周期消息不应阻塞资源释放。
        resolve();
      }
    });
  };
  // ready.version 的语义是 Core 版本；不能误发 Node runtime 版本常量
  // （22.16.0），否则消费方读取会拿到错误值。
  await send({
    type: "ready",
    host: http.host,
    port: http.port,
    version: ZCODE_VERSION,
    ...(process.env.ZCODE_SERVER_RELEASE_ID?.trim()
      ? { releaseId: process.env.ZCODE_SERVER_RELEASE_ID.trim() }
      : {}),
    generation,
  });
  let shutdownStarted = false;
  let lastRunningTaskCount = taskActivityTracker.readRunningTaskCount();
  const activitySubscription = taskActivityTracker.onDidChangeRunningTaskCount(
    (runningTaskCount) => {
      lastRunningTaskCount = runningTaskCount;
      void send({
        type: "task-activity",
        runningTasks: taskActivityTracker.readRunningTasks(),
        runningTaskCount,
      });
    },
  );
  let heartbeatInFlight: Promise<void> | undefined;
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = Promise.resolve(taskActivityTracker.readRunningTaskCount())
      .then((runningTaskCount) => {
        if (runningTaskCount !== lastRunningTaskCount) {
          lastRunningTaskCount = runningTaskCount;
          void send({
            type: "task-activity",
            runningTasks: taskActivityTracker.readRunningTasks(),
            runningTaskCount,
          });
        }
        void send({
          type: "heartbeat",
          runningTasks: taskActivityTracker.readRunningTasks(),
          at: Date.now(),
          runningTaskCount,
        });
      })
      .catch(() => {
        void send({
          type: "heartbeat",
          runningTasks: taskActivityTracker.readRunningTasks(),
          at: Date.now(),
          runningTaskCount: lastRunningTaskCount,
        });
      })
      .finally(() => {
        heartbeatInFlight = undefined;
      });
  }, CORE_HEARTBEAT_INTERVAL_MS);
  shutdown = async (reason: string): Promise<void> => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    disposeParentDisconnectHandler();
    clearInterval(heartbeat);
    activitySubscription.dispose();
    taskActivityTracker.dispose();
    // FORK(cloud-web-access): 先停止外部 attachment，再关闭 loopback Core。
    connector?.stop();
    await http.close().catch(() => undefined);
    await disposeServiceResourcesAndWait(services).catch(() => undefined);
    await send({ type: "shutdown-ack" });
    await send({ type: "exit", reason });
    try {
      process.disconnect?.();
    } catch {
      // 父进程已断连时 disconnect 可能报告 IPC_CHANNEL_CLOSED；不影响资源已释放后的退出。
    }
    await beforeExit?.();
    // 仅设置 exitCode 无法关闭 Agent/SQLite 等仍持有的事件循环；Supervisor 的有界停止
    // 会因此等待到超时。资源释放完成后显式退出，确保 stop/restart/uninstall 真正收口。
    process.exit(0);
  };
  if (parentDisconnected) void shutdown("parent-disconnected");
  process.on("message", (message: unknown) => {
    if (
      typeof message === "object" &&
      message !== null &&
      "command" in message &&
      message.command === "shutdown"
    ) {
      void shutdown("requested");
    }
  });
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}
