import {
  WEB_REMOTE_CONTROL_RELAY_V2_HTTP,
  WEB_REMOTE_CONTROL_RELAY_V2_WS_PATH,
} from "@zcode/shared/web-remote-relay";
import { issueSession, verifyPassword, verifySession } from "./auth.js";
import {
  FORK_REMOTE_AUTH_LOGIN_PATH,
  FORK_REMOTE_TENANT_KEY,
  type ForkRemoteRelayEnv,
} from "./contract.js";
export { RelayRoom } from "./relayRoom.js";

function json(status: number, body: unknown) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (type !== "application/json") return null;
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function bearer(request: Request): string | null {
  return request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1] ?? null;
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function authenticatedUser(request: Request, env: ForkRemoteRelayEnv) {
  const token = bearer(request);
  if (!token) return null;
  return (await verifySession(token, env.AUTH_USERNAME, env.AUTH_EPOCH, env.AUTH_SECRET))
    ? env.AUTH_USERNAME
    : null;
}

function internalPath(pathname: string): string | null {
  if (pathname === WEB_REMOTE_CONTROL_RELAY_V2_HTTP.register.path) return "/internal/device";
  if (pathname === WEB_REMOTE_CONTROL_RELAY_V2_HTTP.delete.path) return "/internal/device/delete";
  if (pathname === WEB_REMOTE_CONTROL_RELAY_V2_HTTP.token.path) return "/internal/token";
  if (pathname === WEB_REMOTE_CONTROL_RELAY_V2_WS_PATH) return "/internal/ws";
  return null;
}

const worker: ExportedHandler<ForkRemoteRelayEnv> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!isSameOrigin(request)) return json(403, { error: "cross-origin request rejected" });

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
      return Response.redirect(new URL("/remote/v4", url).toString(), 302);
    }

    if (url.pathname === FORK_REMOTE_AUTH_LOGIN_PATH && request.method === "POST") {
      const body = (await readJson(request)) as { username?: unknown; password?: unknown } | null;
      if (
        !body ||
        body.username !== env.AUTH_USERNAME ||
        typeof body.password !== "string" ||
        !(await verifyPassword(body.password, env.AUTH_PASSWORD_HASH))
      )
        return json(401, { error: "invalid credentials" });
      return json(200, await issueSession(env.AUTH_USERNAME, env.AUTH_EPOCH, env.AUTH_SECRET));
    }

    const path = internalPath(url.pathname);
    if (path) {
      if (url.pathname === WEB_REMOTE_CONTROL_RELAY_V2_WS_PATH) {
        const internalUrl = new URL(path, "https://relay.internal");
        internalUrl.search = url.search;
        return env.RELAY.getByName(FORK_REMOTE_TENANT_KEY).fetch(
          new Request(internalUrl, { method: request.method, headers: request.headers }),
        );
      }
      const userId = await authenticatedUser(request, env);
      if (!userId) return json(401, { error: "authentication required" });
      const internalUrl = new URL(path, "https://relay.internal");
      internalUrl.search = url.search;
      const headers = new Headers(request.headers);
      headers.set("x-zcode-relay-user", userId);
      headers.delete("authorization");
      const stub = env.RELAY.getByName(FORK_REMOTE_TENANT_KEY);
      return stub.fetch(
        new Request(internalUrl, {
          method: request.method,
          headers,
          body: request.body,
        }),
      );
    }
    if (url.pathname === "/api" || url.pathname.startsWith("/api/"))
      return json(404, { error: "api route not found" });

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("ZCode self-hosted relay", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};

export default worker;
