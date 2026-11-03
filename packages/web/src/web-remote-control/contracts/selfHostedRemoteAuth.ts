export interface SelfHostedRemoteCredentials {
  username: string;
  password: string;
}

export interface SelfHostedRemoteAccount {
  displayName: string;
  provider: "self-hosted";
}

export interface SelfHostedRemoteAuth {
  getZCodeJwtToken(): string | null;
  getActiveAccount(): SelfHostedRemoteAccount | null;
  startLogin(credentials: SelfHostedRemoteCredentials): Promise<void>;
  logout(): Promise<void>;
}
