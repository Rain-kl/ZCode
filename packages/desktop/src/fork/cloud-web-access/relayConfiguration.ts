import { randomUUID } from "node:crypto";
import type {
  DesktopSelfHostedRemoteRelayConfiguration,
  DesktopSelfHostedRemoteRelayInput,
  DesktopSelfHostedRemoteRelayLogin,
  DesktopSelfHostedRemoteRelaySetting,
  DesktopSelfHostedRemoteRelaySettings,
  DesktopSelfHostedRemoteRelayStatus,
} from "./contract.js";

const LOGIN_PATH = "/api/fork-remote/auth/login";
const CREDENTIAL_KEY_PREFIX = "web-remote-control:self-hosted:session:";

interface Dependencies {
  loadSettings(): Promise<DesktopSelfHostedRemoteRelaySettings>;
  patchSettings(patch: Partial<DesktopSelfHostedRemoteRelaySettings>): Promise<void>;
  credentialStore: {
    load(key: string): Promise<string | null>;
    save(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
  randomId?: () => string;
  fetcher?: typeof fetch;
}

interface LoginResponse {
  token: string;
  userInfo: { id: string; username: string; displayName: string };
}

function normalizeEndpoint(value: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value.trim());
  } catch (error) {
    throw new Error("Relay URL is invalid", { cause: error });
  }
  const loopback = endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1";
  if (endpoint.protocol !== "https:" && !(loopback && endpoint.protocol === "http:")) {
    throw new Error("Relay URL must use HTTPS (HTTP is allowed only for localhost)");
  }
  if (endpoint.username || endpoint.password)
    throw new Error("Relay URL must not contain credentials");
  if (endpoint.search || endpoint.hash)
    throw new Error("Relay URL must not contain query or fragment");
  if (endpoint.pathname !== "/") throw new Error("Relay URL must be an origin without a path");
  return endpoint.origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    keys
      .slice()
      .sort()
      .every((key, index) => actual[index] === key)
  );
}

function parseLoginResponse(value: unknown): LoginResponse {
  if (!isRecord(value) || !hasExactKeys(value, ["token", "userInfo"])) {
    throw new Error("Relay authentication returned an invalid response");
  }
  const userInfo = value.userInfo;
  if (
    typeof value.token !== "string" ||
    value.token.length < 1 ||
    value.token.length > 16_384 ||
    !isRecord(userInfo) ||
    !hasExactKeys(userInfo, ["id", "username", "displayName"]) ||
    typeof userInfo.id !== "string" ||
    !userInfo.id.trim() ||
    typeof userInfo.username !== "string" ||
    !userInfo.username.trim() ||
    typeof userInfo.displayName !== "string" ||
    !userInfo.displayName.trim()
  ) {
    throw new Error("Relay authentication returned an invalid response");
  }
  return {
    token: value.token,
    userInfo: {
      id: userInfo.id.trim(),
      username: userInfo.username.trim(),
      displayName: userInfo.displayName.trim(),
    },
  };
}

function statusFor(
  setting: DesktopSelfHostedRemoteRelaySetting | undefined,
  authenticated: boolean,
): DesktopSelfHostedRemoteRelayStatus {
  return setting
    ? {
        configured: true,
        authenticated,
        endpoint: setting.endpointOrigin,
        username: setting.username,
      }
    : { configured: false, authenticated: false };
}

async function authenticate(
  endpointOrigin: string,
  username: string,
  password: string,
  fetcher: typeof fetch,
): Promise<LoginResponse> {
  let response: Response;
  try {
    response = await fetcher(new URL(LOGIN_PATH, endpointOrigin), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(`Relay authentication request failed for ${endpointOrigin}`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Relay authentication failed"
        : `Relay authentication failed with HTTP ${response.status}`,
    );
  }
  let login: LoginResponse;
  try {
    login = parseLoginResponse(await response.json());
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Relay authentication returned")) {
      throw error;
    }
    throw new Error("Relay authentication returned an invalid response", {
      cause: error,
    });
  }
  if (login.userInfo.username !== username) {
    throw new Error("Relay authentication returned a different account identity");
  }
  return login;
}

export function createDesktopSelfHostedRemoteRelayConfiguration(
  dependencies: Dependencies,
): DesktopSelfHostedRemoteRelayConfiguration {
  const randomId = dependencies.randomId ?? randomUUID;
  let restored:
    | { key: string; value: Promise<DesktopSelfHostedRemoteRelayLogin | undefined> }
    | undefined;

  async function readLogin(): Promise<{
    setting: DesktopSelfHostedRemoteRelaySetting | undefined;
    login: DesktopSelfHostedRemoteRelayLogin | undefined;
  }> {
    const setting = (await dependencies.loadSettings()).webRemoteControlSelfHostedRelay;
    if (!setting) return { setting, login: undefined };
    const token = await dependencies.credentialStore.load(setting.tokenCredentialKey);
    return {
      setting,
      login: token ? { userId: setting.userId, jwt: token } : undefined,
    };
  }

  return {
    async configure(input: DesktopSelfHostedRemoteRelayInput, fetcher = fetch) {
      const endpointOrigin = normalizeEndpoint(input.endpoint);
      const username = input.username.trim();
      if (!username) throw new Error("Relay username is required");
      if (!input.password) throw new Error("Relay password is required");
      if (input.password.length > 4_096) throw new Error("Relay password is too long");

      const login = await authenticate(endpointOrigin, username, input.password, fetcher);

      const previous = (await dependencies.loadSettings()).webRemoteControlSelfHostedRelay;
      const tokenCredentialKey = `${CREDENTIAL_KEY_PREFIX}${randomId()}`;
      const setting: DesktopSelfHostedRemoteRelaySetting = {
        endpointOrigin,
        username,
        userId: login.userInfo.id,
        tokenCredentialKey,
      };
      await dependencies.credentialStore.save(tokenCredentialKey, login.token);
      try {
        await dependencies.credentialStore.save(`${tokenCredentialKey}:password`, input.password);
        await dependencies.patchSettings({
          webRemoteControlSelfHostedRelay: setting,
        });
      } catch (error) {
        await dependencies.credentialStore.delete(tokenCredentialKey).catch(() => {});
        await dependencies.credentialStore.delete(`${tokenCredentialKey}:password`).catch(() => {});
        throw error;
      }
      restored = {
        key: tokenCredentialKey,
        value: Promise.resolve({ userId: setting.userId, jwt: login.token }),
      };
      if (previous?.tokenCredentialKey && previous.tokenCredentialKey !== tokenCredentialKey) {
        await dependencies.credentialStore.delete(previous.tokenCredentialKey).catch(() => {});
        await dependencies.credentialStore
          .delete(`${previous.tokenCredentialKey}:password`)
          .catch(() => {});
      }
      return statusFor(setting, true);
    },
    async getLogin() {
      const { setting, login } = await readLogin();
      if (!setting) return undefined;
      const key = setting.tokenCredentialKey;
      if (!restored || restored.key !== key) {
        // Bugfix: 重启后需要重新使用安全存储的密码登录，同一次启动并发请求共享认证结果。
        const value = (async () => {
          const password = await dependencies.credentialStore.load(`${key}:password`);
          if (!password) return login;
          const response = await authenticate(
            setting.endpointOrigin,
            setting.username,
            password,
            dependencies.fetcher ?? fetch,
          );
          if (response.userInfo.id !== setting.userId)
            throw new Error("Relay authentication returned a different account identity");
          return { userId: response.userInfo.id, jwt: response.token };
        })();
        restored = { key, value };
        void value.catch(() => {
          if (restored?.value === value) restored = undefined;
        });
      }
      const current = restored;
      const result = await current.value;
      const latest = (await dependencies.loadSettings()).webRemoteControlSelfHostedRelay;
      if (latest?.tokenCredentialKey !== key) return this.getLogin();
      return result;
    },
    async getStatus() {
      const { setting, login } = await readLogin();
      return statusFor(setting, Boolean(login));
    },
    async getEndpointOrigin() {
      return (await dependencies.loadSettings()).webRemoteControlSelfHostedRelay?.endpointOrigin;
    },
  };
}
