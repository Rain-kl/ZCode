export {
  clearRemoteConnectionConfig,
  configureRemoteConnection,
  readRemoteConnectionConfig,
  requireRemoteConnectionConfig,
} from "./connectionConfig.js";
export { installPersistentServerLogger } from "./persistentLogger.js";
export { followServerLogs, readServerLogSnapshot, readServerLogTail } from "./serverLogs.js";
export { createHeadlessRemoteWorkspaceHost } from "./workspaceHost.js";
export {
  CLOUD_WEB_ACCESS_REQUIRED_ENV,
  CLOUD_WEB_ACCESS_UPDATE_FALLBACK_ENV,
  hasActiveServerUpdate,
  isCloudWebAccessRequired,
  isCloudWebAccessUpdateFallback,
  shouldAllowRelayStartupFallback,
} from "./mode.js";
export type {
  ConfigureRemoteConnectionOptions,
  FollowServerLogsOptions,
  HeadlessRemoteWorkspaceHost,
  HeadlessRemoteWorkspaceHostOptions,
  RemoteConnectionConfig,
  RemoteConnectionUserInfo,
  ServerCloudWebAccessLayout,
  ServerCloudWebAccessPort,
  ServerLogSnapshot,
} from "./contract.js";

export const serverCloudWebAccessModule = {
  id: "server-cloud-web-access",
  provides: ["server-remote-config", "server-persistent-logs", "server-remote-workspace-host"],
  requires: ["fork-remote-connector", "services", "shared"],
} as const;
