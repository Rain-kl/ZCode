import type { DurableObjectNamespace, Fetcher, R2Bucket } from "@cloudflare/workers-types";

export const FORK_REMOTE_AUTH_LOGIN_PATH = "/api/fork-remote/auth/login";
export const FORK_REMOTE_TICKET_SECONDS = 60;
export const FORK_REMOTE_TENANT_KEY = "single-tenant";

export interface ForkRemoteRelayEnv {
  RELAY: DurableObjectNamespace;
  ASSETS?: Fetcher;
  REMOTE_WEB_ARCHIVE?: R2Bucket;
  AUTH_USERNAME: string;
  AUTH_PASSWORD_HASH: string;
  AUTH_SECRET: string;
  AUTH_EPOCH: string;
}

export interface ForkRemoteLoginResult {
  token: string;
  userInfo: { id: string; username: string; displayName: string };
}

export const REMOTE_WEB_MANIFEST_PATH = "/fork-remote-web-manifest.json";
export const REMOTE_WEB_VERSION_PREFIX = "/remote/v4/";

export interface RemoteWebAsset {
  size: number;
  sha256: string;
  md5: string;
  contentType: string;
}

export interface RemoteWebManifest {
  schemaVersion: 1;
  version: string;
  files: Record<string, RemoteWebAsset>;
}

export function isRemoteWebVersion(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 160) return false;
  const match = value.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
  );
  return Boolean(
    match &&
    (/^dev\.[a-f0-9]{8}$/.test(match[4] ?? "") ||
      !match[4]?.split(".").some((part) => /^0\d+$/.test(part))),
  );
}

export function isRemoteWebAssetPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length < 1024 &&
    !/[\\%?#]/u.test(path) &&
    !Array.from(path).some((character) => character.charCodeAt(0) <= 32) &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

/** 发布器与 Worker 共用严格合同，坏清单不能把版本请求降级为当前页面。 */
export function parseRemoteWebManifest(value: unknown): RemoteWebManifest {
  const object = (item: unknown): item is Record<string, unknown> =>
    typeof item === "object" && item !== null && !Array.isArray(item);
  const keys = (item: Record<string, unknown>, expected: string[]) =>
    Object.keys(item).sort().join(",") === expected.sort().join(",");
  if (
    !object(value) ||
    !keys(value, ["schemaVersion", "version", "files"]) ||
    value.schemaVersion !== 1 ||
    !isRemoteWebVersion(value.version) ||
    !object(value.files)
  )
    throw new Error("Invalid remote Web version manifest header");
  const entries = Object.entries(value.files);
  if (!entries.length || entries.length > 20_000 || !Object.hasOwn(value.files, "index.html"))
    throw new Error("Invalid remote Web version manifest file collection");
  const files: Record<string, RemoteWebAsset> = Object.create(null);
  for (const [path, asset] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    if (
      !isRemoteWebAssetPath(path) ||
      !object(asset) ||
      !keys(asset, ["size", "sha256", "md5", "contentType"]) ||
      !Number.isSafeInteger(asset.size) ||
      Number(asset.size) < 0 ||
      Number(asset.size) > 25 * 1024 * 1024 ||
      typeof asset.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      typeof asset.md5 !== "string" ||
      !/^[a-f0-9]{32}$/.test(asset.md5) ||
      typeof asset.contentType !== "string" ||
      !/^[a-z0-9.+-]+\/[a-z0-9.+-]+(?:; charset=utf-8)?$/i.test(asset.contentType)
    )
      throw new Error(`Invalid remote Web version manifest asset: ${path}`);
    files[path] = asset as unknown as RemoteWebAsset;
  }
  if (files["index.html"].contentType !== "text/html; charset=utf-8")
    throw new Error("Invalid remote Web version manifest index content type");
  return { schemaVersion: 1, version: value.version, files };
}
