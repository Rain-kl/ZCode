import type {
  SelfHostedRemoteAccount,
  SelfHostedRemoteAuth,
  SelfHostedRemoteCredentials,
} from "#src/web-remote-control/contracts/selfHostedRemoteAuth.js";

const LOGIN_PATH = "/api/fork-remote/auth/login";
const SESSION_STORAGE_KEY = "zcode:self-hosted-remote-session";

interface SelfHostedRemoteSession {
  token: string;
  expiresAt: string;
  userInfo: {
    id: string;
    username: string;
    displayName: string;
  };
}

interface SelfHostedRemoteAuthOptions {
  origin: string;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  fetcher?: typeof fetch;
  now?: () => number;
}

export class SelfHostedRemoteAuthError extends Error {
  constructor(
    readonly reason: "invalid-credentials" | "relay-unavailable",
    message: string = reason,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SelfHostedRemoteAuthError";
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseSession(value: unknown, now: number): SelfHostedRemoteSession | null {
  if (!value || typeof value !== "object") return null;
  const session = value as Partial<SelfHostedRemoteSession>;
  const userInfo = session.userInfo;
  if (
    !isNonEmptyString(session.token) ||
    !isNonEmptyString(session.expiresAt) ||
    !userInfo ||
    !isNonEmptyString(userInfo.id) ||
    !isNonEmptyString(userInfo.username) ||
    !isNonEmptyString(userInfo.displayName)
  )
    return null;
  const expiresAt = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return {
    token: session.token.trim(),
    expiresAt: new Date(expiresAt).toISOString(),
    userInfo: {
      id: userInfo.id.trim(),
      username: userInfo.username.trim(),
      displayName: userInfo.displayName.trim(),
    },
  };
}

function browserStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  return {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
  };
}

export function createSelfHostedRemoteAuth(
  options: SelfHostedRemoteAuthOptions,
): SelfHostedRemoteAuth {
  const storage = options.storage ?? browserStorage();
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const clear = () => {
    try {
      storage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // localStorage 不可用时只能按未登录处理；不能因此保留半套内存会话。
    }
  };
  const load = (): SelfHostedRemoteSession | null => {
    try {
      const raw = storage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const session = parseSession(JSON.parse(raw), now());
      if (!session) clear();
      return session;
    } catch {
      clear();
      return null;
    }
  };

  return {
    getZCodeJwtToken: () => load()?.token ?? null,
    getActiveAccount: (): SelfHostedRemoteAccount | null => {
      const session = load();
      return session
        ? { displayName: session.userInfo.displayName, provider: "self-hosted" }
        : null;
    },
    async startLogin(credentials: SelfHostedRemoteCredentials): Promise<void> {
      const username = credentials.username.trim();
      if (!username || !credentials.password)
        throw new SelfHostedRemoteAuthError("invalid-credentials");
      let response: Response;
      try {
        response = await fetcher(new URL(LOGIN_PATH, options.origin), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password: credentials.password }),
          cache: "no-store",
          redirect: "error",
        });
      } catch (error) {
        throw new SelfHostedRemoteAuthError(
          "relay-unavailable",
          `Relay login request failed: ${new URL(LOGIN_PATH, options.origin)}`,
          { cause: error },
        );
      }
      if (response.status === 401) throw new SelfHostedRemoteAuthError("invalid-credentials");
      if (!response.ok)
        throw new SelfHostedRemoteAuthError(
          "relay-unavailable",
          `Relay login failed with HTTP ${response.status}`,
        );
      let session: SelfHostedRemoteSession | null = null;
      let parseError: unknown;
      try {
        session = parseSession(await response.json(), now());
      } catch (error) {
        parseError = error;
      }
      if (!session)
        throw new SelfHostedRemoteAuthError(
          "relay-unavailable",
          "Relay login response did not contain a valid unexpired session",
          { cause: parseError },
        );
      try {
        storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      } catch {
        clear();
        throw new SelfHostedRemoteAuthError(
          "relay-unavailable",
          "Relay login succeeded but the browser could not persist the session",
        );
      }
    },
    async logout(): Promise<void> {
      clear();
    },
  };
}
