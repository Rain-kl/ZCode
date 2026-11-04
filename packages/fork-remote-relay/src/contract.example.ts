import { FORK_REMOTE_AUTH_LOGIN_PATH, type ForkRemoteLoginResult } from "./contract.js";

export async function loginToSelfHostedRelay(
  origin: string,
  username: string,
  password: string,
): Promise<ForkRemoteLoginResult> {
  const response = await fetch(new URL(FORK_REMOTE_AUTH_LOGIN_PATH, origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Relay login failed with HTTP ${response.status}`);
  return (await response.json()) as ForkRemoteLoginResult;
}
