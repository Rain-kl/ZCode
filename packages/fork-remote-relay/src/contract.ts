import type { DurableObjectNamespace, Fetcher } from "@cloudflare/workers-types";

export const FORK_REMOTE_AUTH_LOGIN_PATH = "/api/fork-remote/auth/login";
export const FORK_REMOTE_TICKET_SECONDS = 60;
export const FORK_REMOTE_TENANT_KEY = "single-tenant";

export interface ForkRemoteRelayEnv {
  RELAY: DurableObjectNamespace;
  ASSETS?: Fetcher;
  AUTH_USERNAME: string;
  AUTH_PASSWORD_HASH: string;
  AUTH_SECRET: string;
  AUTH_EPOCH: string;
}

export interface ForkRemoteLoginResult {
  token: string;
  userInfo: { id: string; username: string; displayName: string };
}
