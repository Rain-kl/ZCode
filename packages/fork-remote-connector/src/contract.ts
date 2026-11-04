import type { WebRemoteControlAppPayload, WebRemoteControlWorkspaceTarget } from "@zcode/shared";

export interface ForkRemoteConnectorLogger {
  info: (message: string, details?: unknown) => void;
  warn: (message: string, details?: unknown) => void;
  error: (message: string, details?: unknown) => void;
}

export interface ForkRemoteCoreBridge {
  onMessage: (listener: (bytes: Uint8Array) => void) => () => void;
  send: (bytes: Uint8Array) => void;
  setFlowState: (state: "saturated" | "drained") => void;
  close: () => void;
}

export interface ForkRemoteWorkspaceSnapshot {
  workspaces: WebRemoteControlWorkspaceTarget[];
  activeWorkspaceKey?: string;
  activeTaskId?: string;
}

export interface ForkRemoteAppRouterOptions {
  deviceSid: string;
  appVersion: string;
  listWorkspaces: () => Promise<ForkRemoteWorkspaceSnapshot>;
  openCoreBridge: (input: {
    workspaceKey: string;
    taskId?: string;
  }) => Promise<ForkRemoteCoreBridge>;
  sendPayload: (payload: WebRemoteControlAppPayload) => boolean;
  logger: ForkRemoteConnectorLogger;
}

export interface ForkRemoteAppRouter {
  handle: (payload: WebRemoteControlAppPayload) => Promise<boolean>;
  replayUnacknowledged: () => boolean;
  dispose: (reason?: string) => void;
}

export interface ForkRemoteConnectorOptions extends Omit<
  ForkRemoteAppRouterOptions,
  "sendPayload"
> {
  endpoint: string;
  sessionToken: string;
  deviceMid: string;
  deviceName: string;
  platform: string;
  startupTimeoutMs?: number;
}

export interface ForkRemoteConnector {
  start: () => Promise<void>;
  stop: () => void;
}
