import { access } from "node:fs/promises";

export const CLOUD_WEB_ACCESS_REQUIRED_ENV = "ZCODE_SERVER_REQUIRE_CLOUD_WEB_ACCESS";
export const CLOUD_WEB_ACCESS_UPDATE_FALLBACK_ENV =
  "ZCODE_SERVER_ALLOW_REMOTE_UNAVAILABLE_DURING_UPDATE";

export function isCloudWebAccessRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[CLOUD_WEB_ACCESS_REQUIRED_ENV] === "1";
}

export function isCloudWebAccessUpdateFallback(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[CLOUD_WEB_ACCESS_UPDATE_FALLBACK_ENV] === "1";
}

export async function hasActiveServerUpdate(updateTransactionFile: string): Promise<boolean> {
  try {
    await access(updateTransactionFile);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw new Error(`Failed to inspect Server update transaction at ${updateTransactionFile}`, {
      cause: error,
    });
  }
}
