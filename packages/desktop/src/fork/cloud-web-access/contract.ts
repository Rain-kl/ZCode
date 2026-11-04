export interface DesktopSelfHostedRemoteRelaySetting {
  endpointOrigin: string;
  username: string;
  userId: string;
  tokenCredentialKey: string;
}

export interface DesktopSelfHostedRemoteRelaySettings {
  webRemoteControlSelfHostedRelay?: DesktopSelfHostedRemoteRelaySetting;
}

export interface DesktopSelfHostedRemoteRelayInput {
  endpoint: string;
  username: string;
  password: string;
}

export interface DesktopSelfHostedRemoteRelayStatus {
  configured: boolean;
  authenticated: boolean;
  endpoint?: string;
  username?: string;
}

export interface DesktopSelfHostedRemoteRelayLogin {
  userId: string;
  jwt: string;
}

export interface DesktopSelfHostedRemoteRelayConfiguration {
  configure(
    input: DesktopSelfHostedRemoteRelayInput,
    fetcher?: typeof fetch,
  ): Promise<DesktopSelfHostedRemoteRelayStatus>;
  getLogin(): Promise<DesktopSelfHostedRemoteRelayLogin | undefined>;
  getStatus(): Promise<DesktopSelfHostedRemoteRelayStatus>;
  getEndpointOrigin(): Promise<string | undefined>;
}
