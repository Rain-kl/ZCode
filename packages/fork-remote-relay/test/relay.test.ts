import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../src/auth.js";

const packageRoot = resolve(fileURLToPath(import.meta.url), "../..");
const wranglerCli = resolve(packageRoot, "../../node_modules/wrangler/bin/wrangler.js");
const username = "owner";
const password = "test-only-password-not-a-production-secret";
const authSecret = "test-secret-at-least-thirty-two-bytes-for-hmac-signing";

let worker: ChildProcess | undefined;
let runtimeDirectory = "";
let origin = "";

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function waitUntilReady(baseUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Wrangler exited with code ${child.exitCode}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Wrangler is still compiling or starting workerd.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("Wrangler dev did not become ready");
}

before(async () => {
  const port = await availablePort();
  runtimeDirectory = await mkdtemp(resolve(tmpdir(), "zcode-relay-workerd-"));
  const assetDirectory = resolve(runtimeDirectory, "assets");
  await mkdir(resolve(assetDirectory, "assets"), { recursive: true });
  await writeFile(
    resolve(assetDirectory, "index.html"),
    "<!doctype html><title>relay-test-spa</title><main>isolated-spa-marker</main>",
  );
  await writeFile(resolve(assetDirectory, "assets/probe.txt"), "isolated-asset-marker\n");
  origin = `http://127.0.0.1:${port}`;
  worker = spawn(
    process.execPath,
    [
      wranglerCli,
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--persist-to",
      resolve(runtimeDirectory, "state"),
      "--assets",
      assetDirectory,
      "--show-interactive-dev-session=false",
      "--log-level=error",
      "--var",
      `AUTH_USERNAME:${username}`,
      "--var",
      `AUTH_PASSWORD_HASH:${await hashPassword(password)}`,
      "--var",
      `AUTH_SECRET:${authSecret}`,
      "--var",
      "AUTH_EPOCH:1",
    ],
    { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  await waitUntilReady(origin, worker);
});

after(async () => {
  if (worker && worker.exitCode === null) {
    worker.kill("SIGTERM");
    await once(worker, "exit");
  }
  if (runtimeDirectory) await rm(runtimeDirectory, { recursive: true, force: true });
});

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function call(path: string, body?: unknown, bearer?: string) {
  return fetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function openSocket(ticket: string): Promise<WebSocket> {
  const socket = new WebSocket(
    `${origin.replace("http:", "ws:")}/api/v1/remote/ws2?token=${ticket}`,
  );
  await once(socket, "open");
  return socket;
}

function nextMessage(socket: WebSocket) {
  return new Promise<Record<string, unknown>>((resolveMessage, reject) => {
    const timer = setTimeout(() => reject(new Error("Relay message deadline")), 5_000);
    const onMessage = (event: MessageEvent) => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      resolveMessage(JSON.parse(String(event.data)) as Record<string, unknown>);
    };
    socket.addEventListener("message", onMessage);
  });
}

async function login() {
  const response = await call("/api/fork-remote/auth/login", { username, password });
  assert.equal(response.status, 200);
  return (await json(response)) as { token: string };
}

async function waitForDevice(options: {
  sessionToken: string;
  deviceSid: string;
  predicate: (device: { online: boolean; meta: Record<string, unknown> }) => boolean;
}) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const listed = (await json(
      await call("/api/v1/remote/device", undefined, options.sessionToken),
    )) as {
      data: Array<{
        device_sid: string;
        online: boolean;
        meta: Record<string, unknown>;
      }>;
    };
    const device = listed.data.find((candidate) => candidate.device_sid === options.deviceSid);
    if (device && options.predicate(device)) return device;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  throw new Error(`Device ${options.deviceSid} did not reach the expected state`);
}

test("isolated assets serve the SPA and never swallow API routes", async () => {
  const spa = await fetch(`${origin}/remote/v4?sid=test-device`);
  assert.equal(spa.status, 200);
  assert.match(spa.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(await spa.text(), /isolated-spa-marker/);

  const asset = await fetch(`${origin}/assets/probe.txt`);
  assert.equal(asset.status, 200);
  assert.equal(await asset.text(), "isolated-asset-marker\n");

  const missingApi = await fetch(`${origin}/api/not-a-real-endpoint`);
  assert.equal(missingApi.status, 404);
  assert.match(missingApi.headers.get("content-type") ?? "", /^application\/json/);
  assert.doesNotMatch(await missingApi.text(), /isolated-spa-marker/);
});

test("real workerd runtime enforces authentication and V2 request contracts", async () => {
  assert.equal((await call("/api/v1/remote/device")).status, 401);
  assert.equal(
    (await call("/api/fork-remote/auth/login", { username, password: "wrong" })).status,
    401,
  );
  const session = await login();
  assert.equal(
    (await call("/api/v1/remote/device", { device_mid: "   " }, session.token)).status,
    400,
  );
  assert.equal((await call("/api/v1/remote/token", { role: "admin" }, session.token)).status, 400);
  const created = (await json(
    await call("/api/v1/remote/device", { device_mid: "test-machine-a" }, session.token),
  )) as { data: { device_sid: string } };
  assert.match(created.data.device_sid, /^d_[A-Za-z0-9_-]+$/);
  const listed = (await json(await call("/api/v1/remote/device", undefined, session.token))) as {
    data: Array<{ device_sid: string; online: boolean }>;
  };
  assert.equal(
    listed.data.some((device) => device.device_sid === created.data.device_sid),
    true,
  );
  assert.equal(
    (
      await call(
        "/api/v1/remote/device/delete",
        { device_sid: created.data.device_sid },
        session.token,
      )
    ).status,
    200,
  );
});

test("real workerd runtime consumes tickets once and fences replaced owners", async () => {
  const session = await login();
  const created = (await json(
    await call("/api/v1/remote/device", { device_mid: "test-machine-b" }, session.token),
  )) as { data: { device_sid: string } };
  const issueTicket = async (role: "device" | "terminal") => {
    const result = (await json(await call("/api/v1/remote/token", { role }, session.token))) as {
      data: { token: string };
    };
    return result.data.token;
  };

  const deviceTicket = await issueTicket("device");
  const device = await openSocket(deviceTicket);
  const reused = new WebSocket(
    `${origin.replace("http:", "ws:")}/api/v1/remote/ws2?token=${deviceTicket}`,
  );
  const reusedClose = once(reused, "close");
  await reusedClose;

  let reply = nextMessage(device);
  device.send(
    JSON.stringify({
      type: "auth_init",
      device_sid: created.data.device_sid,
      meta: { name: "server-a", platform: "linux" },
    }),
  );
  assert.equal((await reply).pair_status, "waiting");

  const firstTerminal = await openSocket(await issueTicket("terminal"));
  reply = nextMessage(firstTerminal);
  firstTerminal.send(JSON.stringify({ type: "auth_init", device_sid: created.data.device_sid }));
  assert.equal((await reply).pair_status, "matched");
  reply = nextMessage(device);
  firstTerminal.send(JSON.stringify({ type: "data", payload: { opaque: "do-not-parse" } }));
  assert.deepEqual((await reply).payload, { opaque: "do-not-parse" });

  const kicked = nextMessage(firstTerminal);
  const secondTerminal = await openSocket(await issueTicket("terminal"));
  reply = nextMessage(secondTerminal);
  secondTerminal.send(JSON.stringify({ type: "auth_init", device_sid: created.data.device_sid }));
  assert.equal((await reply).pair_status, "matched");
  assert.equal((await kicked).code, "KICKED");
  firstTerminal.close();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  reply = nextMessage(device);
  secondTerminal.send(JSON.stringify({ type: "data", payload: { afterReplacement: true } }));
  assert.deepEqual((await reply).payload, { afterReplacement: true });
  secondTerminal.close();
  device.close();
  const offline = await waitForDevice({
    sessionToken: session.token,
    deviceSid: created.data.device_sid,
    predicate: (record) => !record.online,
  });
  assert.deepEqual(offline.meta, {});
});
