import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { normalizeServerCommandGroup, runServerCli } from "../src/cli.js";
import {
  configureRemoteConnection,
  CLOUD_WEB_ACCESS_REQUIRED_ENV,
  installPersistentServerLogger,
  followServerLogs,
  isCloudWebAccessRequired,
  readRemoteConnectionConfig,
  readServerLogSnapshot,
  readServerLogTail,
  requireRemoteConnectionConfig,
  serverCloudWebAccessModule,
} from "../src/fork/cloud-web-access/module.js";
import { createDaemonServiceDescriptor } from "../src/platform/serviceManager.js";
import { resolveServerLayout } from "../src/runtime/paths.js";

const temporaryRoots: string[] = [];

test("server cloud web access exposes one managed public module", () => {
  assert.deepEqual(serverCloudWebAccessModule, {
    id: "server-cloud-web-access",
    provides: ["server-remote-config", "server-persistent-logs"],
    requires: [],
  });
});

test("server up requires cloud web access while ordinary serve stays optional", () => {
  assert.equal(isCloudWebAccessRequired({}), false);
  assert.equal(isCloudWebAccessRequired({ [CLOUD_WEB_ACCESS_REQUIRED_ENV]: "1" }), true);

  const layout = resolveServerLayout("/tmp/zcode-cloud-web-service-test");
  const required = createDaemonServiceDescriptor({
    platform: "linux",
    layout,
    requireCloudWebAccess: true,
  });
  const ordinary = createDaemonServiceDescriptor({ platform: "linux", layout });
  assert.match(required.content, /--require-remote-config/u);
  assert.doesNotMatch(ordinary.content, /--require-remote-config/u);
});

async function temporaryServerRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zcode-cloud-web-cli-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

test("server command group maps to the existing lifecycle owners", () => {
  assert.deepEqual(normalizeServerCommandGroup(["server", "up"]), [
    "serve",
    "--require-remote-config",
  ]);
  assert.deepEqual(normalizeServerCommandGroup(["server", "up", "-d"]), [
    "serve",
    "--require-remote-config",
    "--daemon",
  ]);
  assert.deepEqual(normalizeServerCommandGroup(["server", "down"]), ["stop", "--wait"]);
  assert.deepEqual(normalizeServerCommandGroup(["server", "proxy-stdio"]), ["proxy-stdio"]);
  assert.deepEqual(normalizeServerCommandGroup(["server", "logs", "-f"]), ["server-logs", "-f"]);
  assert.deepEqual(
    normalizeServerCommandGroup([
      "server",
      "connect",
      "--url",
      "https://relay.example.com",
      "--username",
      "owner",
      "--password-stdin",
    ]),
    [
      "server-connect",
      "--url",
      "https://relay.example.com",
      "--username",
      "owner",
      "--password-stdin",
    ],
  );
  assert.throws(
    () => normalizeServerCommandGroup(["server", "up", "--detach"]),
    /Unknown server up option/,
  );
  assert.throws(
    () => normalizeServerCommandGroup(["server", "logs", "--json"]),
    /Unknown server logs option/,
  );
  assert.throws(() => normalizeServerCommandGroup(["server", "unknown"]), /Unknown server command/);
});

test("interactive connect prompts for non-secret fields and masks the password boundary", async () => {
  const root = await temporaryServerRoot();
  const prompts: string[] = [];
  const secrets: string[] = [];
  const answers = ["https://relay.example.com", "owner"];
  const output: string[] = [];

  const exitCode = await runServerCli(
    ["server", "connect", "--server-root", root],
    {
      stdout: { write: (value) => output.push(value) },
      stderr: { write: (value) => output.push(value) },
      confirm: async (prompt) => {
        prompts.push(prompt);
        return answers.shift() ?? "";
      },
      promptSecret: async (prompt) => {
        secrets.push(prompt);
        return "interactive-password";
      },
    },
    {
      remoteAuthFetch: authenticatedRegistrationFetcher("interactive-token", "interactive-device"),
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(prompts, ["Relay URL: ", "Username: "]);
  assert.deepEqual(secrets, ["Password: "]);
  assert.match(output.join(""), /connected to https:\/\/relay\.example\.com as owner/u);
  assert.doesNotMatch(output.join(""), /interactive-password/u);
  const saved = await readRemoteConnectionConfig(resolveServerLayout(root));
  assert.equal(saved?.sessionToken, "interactive-token");
});

test("connect authenticates before atomically replacing the restricted config", async () => {
  const layout = resolveServerLayout(await temporaryServerRoot());
  const calls: { url: string; authorization: string | null; body: unknown }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)),
    });
    return url.endsWith("/api/fork-remote/auth/login")
      ? Response.json({
          token: "session-token-not-a-model-token",
          expiresAt: "2026-12-03T00:00:00.000Z",
          userInfo: { id: "single-tenant", username: "owner", displayName: "Owner" },
        })
      : (() => {
          const registrationCall = calls.at(-1);
          assert.ok(registrationCall);
          const registrationBody = registrationCall.body as { device_mid: string };
          return Response.json({
            code: 0,
            msg: "",
            data: {
              device_sid: "device-sid-from-relay",
              device_mid: registrationBody.device_mid,
              online: false,
              created_at: 1_793_689_600,
              meta: {},
            },
          });
        })();
  };

  await configureRemoteConnection({
    layout,
    endpoint: "https://relay.example.com/",
    username: "owner",
    password: "password with trailing space ",
    fetcher,
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    url: "https://relay.example.com/api/fork-remote/auth/login",
    authorization: null,
    body: { username: "owner", password: "password with trailing space " },
  });
  assert.equal(calls[1]?.url, "https://relay.example.com/api/v1/remote/device");
  assert.equal(calls[1]?.authorization, "Bearer session-token-not-a-model-token");
  const registrationCall = calls[1];
  assert.ok(registrationCall);
  const deviceMid = (registrationCall.body as { device_mid: string }).device_mid;
  assert.match(deviceMid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  const saved = await readRemoteConnectionConfig(layout);
  assert.equal(saved?.version, 2);
  assert.equal(saved?.endpoint, "https://relay.example.com");
  assert.equal(saved?.username, "owner");
  assert.equal(saved?.sessionToken, "session-token-not-a-model-token");
  assert.equal(saved?.deviceMid, deviceMid);
  assert.equal(saved?.deviceSid, "device-sid-from-relay");
  assert.equal(saved && "password" in saved, false);
  if (process.platform !== "win32") {
    assert.equal((await stat(layout.remoteConnectionFile)).mode & 0o777, 0o600);
  }
});

test("connect preserves the last valid config when authentication fails", async () => {
  const layout = resolveServerLayout(await temporaryServerRoot());
  await configureRemoteConnection({
    layout,
    endpoint: "https://old.example.com",
    username: "owner",
    password: "old-password",
    fetcher: authenticatedRegistrationFetcher("old-token", "old-device-sid"),
  });
  const before = await readFile(layout.remoteConnectionFile, "utf8");

  await assert.rejects(
    configureRemoteConnection({
      layout,
      endpoint: "https://new.example.com",
      username: "owner",
      password: "wrong",
      fetcher: async () => Response.json({ error: "invalid credentials" }, { status: 401 }),
    }),
    /authentication failed/,
  );
  assert.equal(await readFile(layout.remoteConnectionFile, "utf8"), before);
});

test("connect preserves the last valid config when device registration fails", async () => {
  const layout = resolveServerLayout(await temporaryServerRoot());
  await configureRemoteConnection({
    layout,
    endpoint: "https://old.example.com",
    username: "owner",
    password: "old-password",
    fetcher: authenticatedRegistrationFetcher("old-token", "old-device-sid"),
  });
  const before = await readFile(layout.remoteConnectionFile, "utf8");

  await assert.rejects(
    configureRemoteConnection({
      layout,
      endpoint: "https://new.example.com",
      username: "owner",
      password: "new-password",
      fetcher: async (input) =>
        String(input).endsWith("/api/fork-remote/auth/login")
          ? Response.json({
              token: "new-token",
              expiresAt: "2026-12-03T00:00:00.000Z",
              userInfo: { id: "single-tenant", username: "owner", displayName: "Owner" },
            })
          : Response.json({ code: 5001, msg: "registration unavailable" }, { status: 503 }),
    }),
    { message: "Relay device registration failed for https://new.example.com with HTTP 503" },
  );
  assert.equal(await readFile(layout.remoteConnectionFile, "utf8"), before);
});

test("an expired login cannot satisfy the server-up configuration gate", async () => {
  const layout = resolveServerLayout(await temporaryServerRoot());
  await configureRemoteConnection({
    layout,
    endpoint: "https://relay.example.com",
    username: "owner",
    password: "password",
    fetcher: authenticatedRegistrationFetcher(
      "expired-token",
      "expired-device-sid",
      "2020-01-01T00:00:00.000Z",
    ),
  });
  await assert.rejects(requireRemoteConnectionConfig(layout), /login has expired/u);
});

function authenticatedRegistrationFetcher(
  token: string,
  deviceSid: string,
  expiresAt = "2026-12-03T00:00:00.000Z",
): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/fork-remote/auth/login")) {
      return Response.json({
        token,
        expiresAt,
        userInfo: { id: "single-tenant", username: "owner", displayName: "Owner" },
      });
    }
    const body = JSON.parse(String(init?.body)) as { device_mid: string };
    return Response.json({
      code: 0,
      msg: "",
      data: {
        device_sid: deviceSid,
        device_mid: body.device_mid,
        online: false,
        created_at: 1_793_689_600,
        meta: {},
      },
    });
  };
}

test("logs read the newest lines across rotated files without starting the server", async () => {
  const layout = resolveServerLayout(await temporaryServerRoot());
  await writeFile(layout.logsDir + "/.keep", "", { flag: "a" }).catch(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(layout.logsDir, { recursive: true });
    await writeFile(layout.logsDir + "/.keep", "");
  });
  await writeFile(join(layout.logsDir, "server-2026-11-02.log"), "old-1\nold-2\n");
  await writeFile(join(layout.logsDir, "server-2026-11-03.log"), "new-1\nnew-2\nnew-3\n");

  assert.deepEqual(await readServerLogTail(layout, 3), ["new-1", "new-2", "new-3"]);
  assert.deepEqual(await readServerLogTail(layout, 4), ["old-2", "new-1", "new-2", "new-3"]);
});

test("logs follow a newly created file from its first line", async () => {
  const layout = resolveServerLayout(await temporaryServerRoot());
  const snapshot = await readServerLogSnapshot(layout);
  const controller = new AbortController();
  const lines: string[] = [];
  const following = followServerLogs({
    layout,
    signal: controller.signal,
    writeLine: (line) => lines.push(line),
    offsets: snapshot.offsets,
  });

  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  await mkdir(layout.logsDir, { recursive: true });
  await writeFile(join(layout.logsDir, "server-2026-11-03.log"), "first-line\n");
  const deadline = Date.now() + 2_000;
  while (!lines.includes("first-line") && Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  controller.abort();
  await following;

  assert.ok(lines.includes("first-line"));
});

test("persistent server logs redact credentials before writing", async () => {
  const layout = resolveServerLayout(await temporaryServerRoot());
  const foreground: string[] = [];
  const originalLog = console.log;
  console.log = (...args) => foreground.push(args.map(String).join(" "));
  const dispose = await installPersistentServerLogger(layout);
  try {
    console.log("request Authorization: Bearer secret-token ?token=ws-secret password=hunter2");
    await dispose();
  } finally {
    console.log = originalLog;
  }

  assert.equal(foreground.length, 1);
  assert.doesNotMatch(foreground[0] ?? "", /secret-token|ws-secret|hunter2/u);
  assert.match(foreground[0] ?? "", /\[REDACTED\]/u);
  const lines = await readServerLogTail(layout);
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0] ?? "", /secret-token|ws-secret|hunter2/u);
  assert.match(lines[0] ?? "", /\[REDACTED\]/u);
  if (process.platform !== "win32") {
    const [name] = await readdir(layout.logsDir);
    assert.ok(name);
    assert.equal((await stat(join(layout.logsDir, name))).mode & 0o777, 0o600);
  }
});
