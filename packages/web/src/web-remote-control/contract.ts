import type { WebRemoteControlFailure, WebRemoteControlV2QrParams } from "@zcode/shared";
import type { WebRemoteControlRelayV2Device } from "@zcode/shared/web-remote-relay";
import type { SelfHostedRemoteAuth } from "#src/web-remote-control/contracts/selfHostedRemoteAuth.js";

export interface WebRemoteControlDeviceGroup {
  deviceMid: string;
  name?: string;
  /** relay meta.platform（darwin / win32 / linux 等），离线时回退到本机记住的平台。 */
  platform?: string;
  onlineConnections: WebRemoteControlRelayV2Device[];
}

/** 本机见过的在线设备展示信息；name / platform 至少一项非空。 */
export interface KnownDevice {
  name?: string;
  platform?: string;
}

/** 设备页账号行的只读展示资料；不是登录事实，登录门禁仍以 JWT 为准。 */
export interface WebRemoteControlDeviceListAccount {
  displayName: string;
  avatarUrl?: string;
  // FORK(cloud-web-access): 自建 Relay 账号必须作为独立身份展示，不能伪装成官方 OAuth provider。
  provider: "zai" | "bigmodel" | "self-hosted";
}

export type WebRemoteControlDeviceListView = {
  kind: "devices";
  devices: WebRemoteControlDeviceGroup[];
  loading: boolean;
  error: boolean;
  account?: WebRemoteControlDeviceListAccount;
};

// FORK(cloud-web-access): 远控入口只保留 Relay 登录态，官方 OAuth callback view 仅属于分享页。
export type WebRemoteControlEntryView =
  | { kind: "login" }
  | WebRemoteControlDeviceListView
  | { kind: "failure"; failure: WebRemoteControlFailure };

export interface WebRemoteControlEntryConnection {
  params: WebRemoteControlV2QrParams & { deviceSid: string };
  signal: AbortSignal;
  getToken(signal: AbortSignal): Promise<string>;
  onPaired(): void;
  onFailure(failure: WebRemoteControlFailure): void;
}

export interface WebRemoteControlEntryOptions {
  // 浏览器 location/history/storage 经现有边界注入，不另存一份登录事实。
  // FORK(cloud-web-access): /remote/v4 只依赖 Relay 自有认证端口，官方 OAuth 继续留给分享页。
  auth: SelfHostedRemoteAuth;
  getHref(): string;
  replaceHref(href: string): void;
  storage: Pick<Storage, "getItem" | "setItem">;
  locale: "zh-CN" | "en-US";
  devices(jwt: string, signal: AbortSignal): Promise<WebRemoteControlRelayV2Device[]>;
  subscribeVisible(listener: () => void): () => void;
  token(jwt: string, signal: AbortSignal): Promise<string>;
  connect(connection: WebRemoteControlEntryConnection): void;
  onView(view: WebRemoteControlEntryView): void;
}

export type * from "#src/web-remote-control/contracts/transport.js";
