export const CLOUD_WEB_ACCESS_REQUIRED_ENV = "ZCODE_SERVER_REQUIRE_CLOUD_WEB_ACCESS";

export function isCloudWebAccessRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[CLOUD_WEB_ACCESS_REQUIRED_ENV] === "1";
}
