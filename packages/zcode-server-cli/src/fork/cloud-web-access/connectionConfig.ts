import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { z } from "zod";
import type {
  ConfigureRemoteConnectionOptions,
  RemoteConnectionConfig,
  ServerCloudWebAccessLayout,
} from "./contract.js";

const loginResponseSchema = z.strictObject({
  token: z.string().min(1).max(16_384),
  userInfo: z.strictObject({
    id: z.string().min(1).max(256),
    username: z.string().min(1).max(256),
    displayName: z.string().min(1).max(256),
  }),
});

const remoteConnectionConfigSchema = z.strictObject({
  version: z.literal(2),
  endpoint: z.string().url(),
  username: z.string().min(1).max(256),
  sessionToken: z.string().min(1).max(16_384),
  // 旧版 connect 写入过会话过期时间；会话不再随时间失效，这里只兼容读取旧文件，不再写回。
  expiresAt: z.string().datetime().optional(),
  deviceMid: z.string().uuid(),
  deviceSid: z.string().min(1).max(128),
  userInfo: loginResponseSchema.shape.userInfo,
  updatedAt: z.string().datetime(),
});

const deviceRegistrationResponseSchema = z.strictObject({
  code: z.literal(0),
  msg: z.string(),
  data: z.object({
    device_sid: z.string().min(1).max(128),
    device_mid: z.string().uuid(),
  }),
});

function normalizeEndpoint(value: string): string {
  const endpoint = new URL(value);
  const localhost = endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1";
  if (endpoint.protocol !== "https:" && !(localhost && endpoint.protocol === "http:")) {
    throw new Error("Relay URL must use HTTPS (HTTP is allowed only for localhost)");
  }
  if (endpoint.username || endpoint.password)
    throw new Error("Relay URL must not contain credentials");
  if (endpoint.search || endpoint.hash)
    throw new Error("Relay URL must not contain query or fragment");
  if (endpoint.pathname !== "/") throw new Error("Relay URL must be an origin without a path");
  return endpoint.origin;
}

async function writeRestrictedJson(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(directory, 0o700);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    if (process.platform !== "win32") await chmod(temporary, 0o600);
    await rename(temporary, path);
    if (process.platform !== "win32") await chmod(path, 0o600);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new Error(`Failed to save relay connection config at ${path}`, { cause: error });
  }
}

export async function readRemoteConnectionConfig(
  layout: ServerCloudWebAccessLayout,
): Promise<RemoteConnectionConfig | null> {
  try {
    const { expiresAt: _legacyExpiresAt, ...config } = remoteConnectionConfigSchema.parse(
      JSON.parse(await readFile(layout.remoteConnectionFile, "utf8")),
    );
    return config;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw new Error(`Failed to read relay connection config at ${layout.remoteConnectionFile}`, {
      cause: error,
    });
  }
}

export async function requireRemoteConnectionConfig(
  layout: ServerCloudWebAccessLayout,
): Promise<RemoteConnectionConfig> {
  const config = await readRemoteConnectionConfig(layout);
  if (!config) {
    throw new Error("ZCode Server is not connected; run `zcode server connect` first");
  }
  return config;
}

export async function clearRemoteConnectionConfig(
  layout: ServerCloudWebAccessLayout,
): Promise<boolean> {
  const directory = dirname(layout.remoteConnectionFile);
  const filename = basename(layout.remoteConnectionFile);
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw new Error(`Failed to inspect relay connection credentials at ${directory}`, {
      cause: error,
    });
  }
  const credentialFiles = entries.filter(
    (entry) => entry === filename || (entry.startsWith(`${filename}.`) && entry.endsWith(".tmp")),
  );
  let removed = false;
  for (const entry of credentialFiles) {
    try {
      await unlink(`${directory}/${entry}`);
      removed = true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw new Error(`Failed to remove relay connection credential at ${directory}/${entry}`, {
        cause: error,
      });
    }
  }
  return removed;
}

export async function configureRemoteConnection(
  options: ConfigureRemoteConnectionOptions,
): Promise<RemoteConnectionConfig> {
  const endpoint = normalizeEndpoint(options.endpoint);
  const username = options.username.trim();
  if (!username) throw new Error("Relay username is required");
  if (!options.password) throw new Error("Relay password is required");
  if (options.password.length > 4_096) throw new Error("Relay password is too long");

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(new URL("/api/fork-remote/auth/login", endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: options.password }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(`Relay authentication request failed for ${endpoint}`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Relay authentication failed"
        : `Relay authentication failed with HTTP ${response.status}`,
    );
  }
  let login: z.infer<typeof loginResponseSchema>;
  try {
    login = loginResponseSchema.parse(await response.json());
  } catch (error) {
    throw new Error("Relay authentication returned an invalid response", { cause: error });
  }
  if (login.userInfo.username !== username) {
    throw new Error("Relay authentication returned a different account identity");
  }
  // Wire identity belongs to the Relay protocol. It must not reuse sourceServerId, which owns
  // Source Server installation/routing identity in a different contract.
  const deviceMid = randomUUID();
  let registrationResponse: Response;
  try {
    registrationResponse = await (options.fetcher ?? fetch)(
      new URL("/api/v1/remote/device", endpoint),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${login.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ device_mid: deviceMid }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (error) {
    throw new Error(`Relay device registration request failed for ${endpoint}`, { cause: error });
  }
  if (!registrationResponse.ok) {
    throw new Error(
      `Relay device registration failed for ${endpoint} with HTTP ${registrationResponse.status}`,
    );
  }
  let deviceSid: string;
  try {
    const registration = deviceRegistrationResponseSchema.parse(await registrationResponse.json());
    if (registration.data.device_mid !== deviceMid) {
      throw new Error("Relay device registration returned a different device MID");
    }
    deviceSid = registration.data.device_sid;
  } catch (error) {
    throw new Error(`Relay device registration returned an invalid response for ${endpoint}`, {
      cause: error,
    });
  }
  const config: RemoteConnectionConfig = {
    version: 2,
    endpoint,
    username,
    sessionToken: login.token,
    deviceMid,
    deviceSid,
    userInfo: login.userInfo,
    updatedAt: new Date().toISOString(),
  };
  await writeRestrictedJson(options.layout.remoteConnectionFile, config);
  return config;
}
