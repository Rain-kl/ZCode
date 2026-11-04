import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWebRemoteControlAppPayload, type WebRemoteControlAppPayload } from "@zcode/shared";
import { createForkRemoteAppRouter } from "../src/router.js";

const prepared = {
  workspaceKey: "remote:server:test:/srv/project",
  workspaceIdentity: "remote:server:test:/srv/project",
  workspacePath: "/srv/project",
  remoteSessionId: "core-generation-1",
};
const request = {
  zcode_type: "workspace-bridge-open" as const,
  requestId: "request-1",
  bridgeSessionId: "bridge-1",
  bridgeGeneration: 1,
  workspaceKey: "project-navigation",
  project: { projectId: "project-1", hostId: "remote:server:test" },
};

function fixture(prepareWorkspace = async (_request: unknown, _signal: AbortSignal) => prepared) {
  const output: WebRemoteControlAppPayload[] = [];
  let opens = 0;
  const router = createForkRemoteAppRouter({
    deviceSid: "device-1",
    appVersion: "3.17.162",
    logger: { info() {}, warn() {}, error() {} },
    listWorkspaces: async () => ({ workspaces: [] }),
    prepareWorkspace,
    openCoreBridge: async () => {
      opens++;
      return { onMessage: () => () => {}, send() {}, setFlowState() {}, close() {} };
    },
    sendPayload: (payload) => (output.push(payload), true),
  });
  return { router, output, opens: () => opens };
}

test("bootstrap failure is correlated and preserves the host service cause", async () => {
  const output: WebRemoteControlAppPayload[] = [];
  const f = fixture();
  const router = createForkRemoteAppRouter({
    deviceSid: "device-1",
    appVersion: "3.17.162",
    logger: { info() {}, warn() {}, error() {} },
    listWorkspaces: async () => {
      throw new Error("project.storage-unavailable");
    },
    prepareWorkspace: async () => prepared,
    openCoreBridge: async () => {
      throw new Error("must not open");
    },
    sendPayload: (payload) => (output.push(payload), true),
  });
  await router.handle({ zcode_type: "bootstrap-request", requestId: "bootstrap-error" });
  const failure = output[0];
  assert.ok(failure?.zcode_type === "app-error");
  assert.equal(failure.requestId, "bootstrap-error");
  assert.match(failure.error, /project.storage-unavailable/);
  router.dispose();
  f.router.dispose();
});

test("new page bootstrap cancels the old navigation before its service returns", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture(async () => {
    await pending;
    return prepared;
  });
  await f.router.handle({
    zcode_type: "bootstrap-request",
    requestId: "boot-1",
    terminalClientSessionId: "page-1",
  });
  const old = f.router.handle({ ...request, terminalClientSessionId: "page-1" });
  await f.router.handle({
    zcode_type: "bootstrap-request",
    requestId: "boot-2",
    terminalClientSessionId: "page-2",
  });
  release();
  await old;
  assert.equal(f.opens(), 0);
  assert.equal(f.output.filter((p) => p.zcode_type === "workspace-bridge-ready").length, 0);
  f.router.dispose();
});

test("project navigation prepares the owner workspace even when absent from bootstrap tabs", async () => {
  let received: unknown;
  const f = fixture(async (input) => {
    received = input;
    return prepared;
  });
  await f.router.handle(request);
  assert.deepEqual(received, request);
  assert.equal(f.opens(), 1);
  const ready = f.output.find((p) => p.zcode_type === "workspace-bridge-ready");
  assert.ok(ready?.zcode_type === "workspace-bridge-ready");
  assert.equal(ready.bridge.kind, "remote");
  assert.equal(ready.bridge.workspaceKey, prepared.workspaceKey);
  assert.ok(ready.bridge.kind === "remote");
  assert.equal(ready.bridge.workspaceIdentity, prepared.workspaceIdentity);
  assert.equal(ready.bridge.remoteSessionId, prepared.remoteSessionId);
  assert.deepEqual(ready.bridge.capabilities, { windowController: false });
  assert.deepEqual(parseWebRemoteControlAppPayload(ready), ready);
  f.router.dispose();
});

test("failed preparation returns its exact request context and never opens Core", async () => {
  const f = fixture(async () => {
    throw new Error("Server workspace navigation failed: project.not-found", {
      cause: new Error("project.not-found"),
    });
  });
  await f.router.handle(request);
  const failure = f.output.find((p) => p.zcode_type === "workspace-bridge-error");
  assert.ok(failure?.zcode_type === "workspace-bridge-error");
  assert.equal(failure.requestId, request.requestId);
  assert.equal(failure.bridgeSessionId, request.bridgeSessionId);
  assert.match(failure.error, /project.not-found/);
  assert.equal(failure.reason, "workspace-closed");
  assert.equal(f.opens(), 0);
  f.router.dispose();
});

test("the same bridge retry reuses preparation and rejects a changed project intent", async () => {
  let preparations = 0;
  const f = fixture(async () => {
    preparations++;
    return prepared;
  });
  await f.router.handle(request);
  await f.router.handle({ ...request, requestId: "retry" });
  assert.equal(preparations, 1);
  assert.equal(f.opens(), 1);
  await f.router.handle({ ...request, requestId: "changed", project: { projectId: "other" } });
  const last = f.output.at(-1);
  assert.ok(last?.zcode_type === "workspace-bridge-error");
  assert.match(last.error, /intent/i);
  assert.equal(preparations, 1);
  f.router.dispose();
});

test("a newer navigation aborts old preparation and suppresses its late result", async () => {
  let release!: () => void;
  let oldSignal: AbortSignal | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture(async (input, signal) => {
    if (input === request) {
      oldSignal = signal;
      await pending;
    }
    return prepared;
  });
  const old = f.router.handle(request);
  await Promise.resolve();
  await f.router.handle({
    ...request,
    requestId: "new",
    bridgeSessionId: "bridge-2",
    bridgeGeneration: 2,
  });
  assert.equal(oldSignal?.aborted, true);
  release();
  await old;
  assert.equal(f.opens(), 1);
  assert.equal(f.output.filter((p) => p.zcode_type === "workspace-bridge-ready").length, 1);
  f.router.dispose();
});

test("unsupported request receives a correlated app error instead of waiting forever", async () => {
  const f = fixture();
  await f.router.handle({
    zcode_type: "workspace-create-request",
    requestId: "create-1",
    workspacePath: "/srv/new",
  } as WebRemoteControlAppPayload);
  assert.ok(f.output.some((p) => p.zcode_type === "app-error" && p.requestId === "create-1"));
  f.router.dispose();
});

test("Core disconnect invalidation survives lost relay delivery until a new bridge replaces it", async () => {
  const output: WebRemoteControlAppPayload[] = [];
  let disconnected: (() => void) | undefined;
  const router = createForkRemoteAppRouter({
    deviceSid: "device-1",
    appVersion: "3.17.162",
    logger: { info() {}, warn() {}, error() {} },
    listWorkspaces: async () => ({ workspaces: [] }),
    prepareWorkspace: async () => prepared,
    openCoreBridge: async () => ({
      onMessage: () => () => {},
      onClose(listener) {
        disconnected = listener;
        return () => {
          disconnected = undefined;
        };
      },
      send() {},
      setFlowState() {},
      close() {},
    }),
    sendPayload: (payload) => (output.push(payload), true),
  });
  await router.handle(request);
  disconnected?.();
  output.length = 0;
  router.replayUnacknowledged();
  assert.equal(output[0]?.zcode_type, "bridge-degraded");
  await router.handle(request);
  assert.equal(output.at(-1)?.zcode_type, "workspace-bridge-error");
  await router.handle({
    ...request,
    requestId: "new",
    bridgeSessionId: "bridge-2",
    bridgeGeneration: 2,
  });
  assert.equal(output.at(-1)?.zcode_type, "workspace-bridge-ready");
  output.length = 0;
  router.replayUnacknowledged();
  assert.ok(output.every((p) => p.zcode_type !== "bridge-degraded"));
  router.dispose();
});
