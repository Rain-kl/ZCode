import type { ServerCloudWebAccessPort } from "./contract.js";

export async function readConfiguredEndpoint(
  port: ServerCloudWebAccessPort,
  remoteConnectionFile: string,
  logsDir: string,
): Promise<string | null> {
  const config = await port.readRemoteConnectionConfig({ remoteConnectionFile, logsDir });
  return config?.endpoint ?? null;
}
