export interface ServerCloudWebAccessLayout {
  readonly remoteConnectionFile: string;
  readonly logsDir: string;
}

export interface RemoteConnectionUserInfo {
  id: string;
  username: string;
  displayName: string;
}

export interface RemoteConnectionConfig {
  version: 2;
  endpoint: string;
  username: string;
  sessionToken: string;
  /** Relay V2 wire identity; independent from the Source Server installation id. */
  deviceMid: string;
  deviceSid: string;
  userInfo: RemoteConnectionUserInfo;
  updatedAt: string;
}

export interface ConfigureRemoteConnectionOptions {
  layout: ServerCloudWebAccessLayout;
  endpoint: string;
  username: string;
  password: string;
  fetcher?: typeof fetch;
}

export interface ServerLogSnapshot {
  lines: string[];
  offsets: ReadonlyMap<string, number>;
}

export interface FollowServerLogsOptions {
  layout: ServerCloudWebAccessLayout;
  signal: AbortSignal;
  writeLine: (line: string) => void;
  offsets?: ReadonlyMap<string, number>;
}

export interface ServerCloudWebAccessPort {
  configureRemoteConnection(
    options: ConfigureRemoteConnectionOptions,
  ): Promise<RemoteConnectionConfig>;
  readRemoteConnectionConfig(
    layout: ServerCloudWebAccessLayout,
  ): Promise<RemoteConnectionConfig | null>;
  requireRemoteConnectionConfig(
    layout: ServerCloudWebAccessLayout,
  ): Promise<RemoteConnectionConfig>;
  readServerLogSnapshot(
    layout: ServerCloudWebAccessLayout,
    limit?: number,
  ): Promise<ServerLogSnapshot>;
  followServerLogs(options: FollowServerLogsOptions): Promise<void>;
  installPersistentServerLogger(layout: ServerCloudWebAccessLayout): Promise<() => Promise<void>>;
}
