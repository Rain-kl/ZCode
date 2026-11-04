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
  const currentHtml =
    "<!doctype html><title>relay-test-spa</title><main>isolated-spa-marker</main>";
  await writeFile(resolve(assetDirectory, "index.html"), currentHtml);
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

/**
 * 逐帧读取中继消息：连接建立后常驻监听并排队，返回按到达顺序取帧的读取器。
 *
 * 为什么不按需挂监听：中继在 `authenticateSocket` 里先给本端回 `auth_ack`，再给对端
 * 发 `pair_status_ack`，两个帧走的是不同连接，先后顺序由网络决定，不随发送顺序固定。
 * 按需挂监听时，先到的帧会被丢掉，后到的帧则会被下一条断言当成自己要等的数据帧
 * （CI 上就是 `pair_status_ack` 顶掉了 `data`，读出的 `payload` 是 undefined）。
 * 排队后两种时序都收敛到同一结果。
 */
function messageInbox(socket: WebSocket) {
  const received: Array<Record<string, unknown>> = [];
  const waiting: Array<(message: Record<string, unknown>) => void> = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as Record<string, unknown>;
    const wake = waiting.shift();
    if (wake) wake(message);
    else received.push(message);
  });

  return function nextMessage(): Promise<Record<string, unknown>> {
    const queued = received.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise<Record<string, unknown>>((resolveMessage, reject) => {
      const timer = setTimeout(() => {
        const index = waiting.indexOf(wake);
        if (index >= 0) waiting.splice(index, 1);
        reject(new Error("Relay message deadline"));
      }, 5_000);
      function wake(message: Record<string, unknown>) {
        clearTimeout(timer);
        resolveMessage(message);
      }
      waiting.push(wake);
    });
  };
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
  const root = await fetch(`${origin}/`, { redirect: "manual" });
  assert.equal(root.status, 302);
  assert.equal(new URL(root.headers.get("location") ?? "", origin).pathname, "/remote/v4");

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

test("workerd always serves the current page regardless of host version metadata", async () => {
  for (const version of ["3.17.162", "3.17.162-dev.abcdef01", "3.0.0"]) {
    const response = await fetch(`${origin}/remote/v4?app_version=${version}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /isolated-spa-marker/);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const entry = await fetch(`${origin}/remote/v4`, { method: "HEAD" });
  assert.equal(entry.status, 200);
  assert.match(entry.headers.get("content-type") ?? "", /^text\/html/);
  assert.equal(await entry.text(), "");
  const head = await fetch(`${origin}/assets/probe.txt`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.match(head.headers.get("content-type") ?? "", /^text\/plain/);
  const absent = await fetch(`${origin}/assets/absent.js`);
  assert.equal(absent.status, 404);
  assert.doesNotMatch(await absent.text(), /isolated-spa-marker/);
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
  const deviceSocket = await openSocket(deviceTicket);
  const device = messageInbox(deviceSocket);
  const reused = new WebSocket(
    `${origin.replace("http:", "ws:")}/api/v1/remote/ws2?token=${deviceTicket}`,
  );
  const reusedClose = once(reused, "close");
  await reusedClose;

  deviceSocket.send(
    JSON.stringify({
      type: "auth_init",
      device_sid: created.data.device_sid,
      meta: { name: "server-a", platform: "linux" },
    }),
  );
  const deviceAuth = await device();
  assert.equal(deviceAuth.type, "auth_ack");
  assert.equal(deviceAuth.pair_status, "waiting");

  const firstTerminalSocket = await openSocket(await issueTicket("terminal"));
  const firstTerminal = messageInbox(firstTerminalSocket);
  firstTerminalSocket.send(
    JSON.stringify({ type: "auth_init", device_sid: created.data.device_sid }),
  );
  assert.equal((await firstTerminal()).pair_status, "matched");
  // 设备侧在终端接入时收到 matched 通知；这一帧与终端 auth_ack 走不同连接，到达顺序不保证。
  const matchedNotice = await device();
  assert.equal(matchedNotice.type, "pair_status_ack");
  assert.equal(matchedNotice.pair_status, "matched");

  firstTerminalSocket.send(JSON.stringify({ type: "data", payload: { opaque: "do-not-parse" } }));
  const forwarded = await device();
  assert.equal(forwarded.type, "data");
  assert.deepEqual(forwarded.payload, { opaque: "do-not-parse" });

  const secondTerminalSocket = await openSocket(await issueTicket("terminal"));
  const secondTerminal = messageInbox(secondTerminalSocket);
  secondTerminalSocket.send(
    JSON.stringify({ type: "auth_init", device_sid: created.data.device_sid }),
  );
  assert.equal((await secondTerminal()).pair_status, "matched");
  const kicked = await firstTerminal();
  assert.equal(kicked.type, "error");
  assert.equal(kicked.code, "KICKED");
  firstTerminalSocket.close();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));

  const replacedNotice = await device();
  assert.equal(replacedNotice.type, "pair_status_ack");
  assert.equal(replacedNotice.pair_status, "matched");
  secondTerminalSocket.send(JSON.stringify({ type: "data", payload: { afterReplacement: true } }));
  const replaced = await device();
  assert.equal(replaced.type, "data");
  assert.deepEqual(replaced.payload, { afterReplacement: true });
  secondTerminalSocket.close();
  deviceSocket.close();
  const offline = await waitForDevice({
    sessionToken: session.token,
    deviceSid: created.data.device_sid,
    predicate: (record) => !record.online,
  });
  assert.deepEqual(offline.meta, {});
});
