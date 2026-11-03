import type { ForkRemoteConnector } from "./contract.js";

export async function startHeadlessRemote(connector: ForkRemoteConnector): Promise<void> {
  await connector.start();
}
