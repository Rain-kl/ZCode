import assert from "node:assert/strict";
import { test } from "node:test";
import type { ForkRemoteCoreBridge } from "../src/contract.js";
import { createForkRemoteAppRouter } from "../src/router.js";

function fakeBridge(emitOnSubscribe?: Uint8Array) {
  let listener: ((bytes: Uint8Array) => void) | undefined;
  const sent: Uint8Array[] = [];
  const flow: string[] = [];
  let closed = false;
  const bridge: ForkRemoteCoreBridge = {
    onMessage(next) {
      listener = next;
      if (emitOnSubscribe) next(emitOnSubscribe);
      return () => {
        listener = undefined;
      };
    },
    send(bytes) {
      sent.push(bytes);
    },
    setFlowState(state) {
      flow.push(state);
    },
    close() {
      closed = true;
    },
  };
  return {
    bridge,
    sent,
    flow,
    emit: (bytes: Uint8Array) => listener?.(bytes),
    closed: () => closed,
  };
}

const logger = { info() {}, warn() {}, error() {} };

test("bootstrap and workspace list use the injected Server snapshot", async () => {
  const output: unknown[] = [];
  const router = createForkRemoteAppRouter({
    deviceSid: "device-1",
    appVersion: "3.17.162",
    logger,
    listWorkspaces: async () => ({
      workspaces: [{ workspacePath: "/srv/a", label: "A", kind: "local" }],
      activeWorkspaceKey: "/srv/a",
    }),
    openCoreBridge: async () => fakeBridge().bridge,
    sendPayload: (payload) => (output.push(payload), true),
  });

  assert.equal(await router.handle({ zcode_type: "bootstrap-request", requestId: "b1" }), true);
  assert.equal(
    await router.handle({ zcode_type: "workspace-list-request", requestId: "w1" }),
    true,
  );
  assert.deepEqual(output, [
    {
      zcode_type: "bootstrap-response",
      requestId: "b1",
      success: true,
      result: {
        windowControlSessionId: "device-1",
        desktopAppVersion: "3.17.162",
        workspaces: [{ workspacePath: "/srv/a", label: "A", kind: "local" }],
        initialViewState: { activeWorkspaceKey: "/srv/a", updatedAt: 0 },
      },
    },
    {
      zcode_type: "workspace-list-response",
      requestId: "w1",
      success: true,
      result: {
        workspaces: [{ workspacePath: "/srv/a", label: "A", kind: "local" }],
        activeWorkspaceKey: "/srv/a",
      },
    },
  ]);
});

test("bridge-ready is sent before queued raw frames and stale frames are ignored", async () => {
  const output: Array<{ zcode_type: string; bridgeSessionId?: string }> = [];
  const first = fakeBridge(new Uint8Array([1, 2, 3]));
  const second = fakeBridge();
  let next = first;
  const router = createForkRemoteAppRouter({
    deviceSid: "device-1",
    appVersion: "3.17.162",
    logger,
    listWorkspaces: async () => ({
      workspaces: [{ workspacePath: "/srv/a", label: "A", kind: "local" }],
      activeWorkspaceKey: "/srv/a",
    }),
    openCoreBridge: async () => next.bridge,
    sendPayload: (payload) => (output.push(payload), true),
  });

  const opening = router.handle({
    zcode_type: "workspace-bridge-open",
    requestId: "open-1",
    bridgeSessionId: "bridge-1",
    bridgeGeneration: 1,
    workspaceKey: "/srv/a",
  });
  await opening;
  assert.equal(output[0]?.zcode_type, "workspace-bridge-ready");
  assert.equal(output[1]?.zcode_type, "rpc-frame");

  next = second;
  await router.handle({
    zcode_type: "workspace-bridge-open",
    requestId: "open-2",
    bridgeSessionId: "bridge-2",
    bridgeGeneration: 2,
    workspaceKey: "/srv/a",
  });
  assert.equal(first.closed(), true);
  const accepted = await router.handle({
    zcode_type: "rpc-frame-ack",
    bridgeSessionId: "bridge-1",
    bridgeGeneration: 1,
    ackMessageSeq: 1,
  });
  assert.equal(accepted, false);
});

test("a stale asynchronous bridge open cannot replace a newer generation", async () => {
  const output: Array<{ zcode_type: string; bridgeSessionId?: string }> = [];
  const stale = fakeBridge();
  const current = fakeBridge();
  let resolveStale: ((bridge: ForkRemoteCoreBridge) => void) | undefined;
  let markStaleStarted: (() => void) | undefined;
  const staleStarted = new Promise<void>((resolve) => {
    markStaleStarted = resolve;
  });
  const router = createForkRemoteAppRouter({
    deviceSid: "device-1",
    appVersion: "3.17.162",
    logger,
    listWorkspaces: async () => ({
      workspaces: [{ workspacePath: "/srv/a", label: "A", kind: "local" }],
    }),
    openCoreBridge: ({ taskId }) =>
      taskId === "stale"
        ? new Promise((resolve) => {
            resolveStale = resolve;
            markStaleStarted?.();
          })
        : Promise.resolve(current.bridge),
    sendPayload: (payload) => (output.push(payload), true),
  });

  const staleOpen = router.handle({
    zcode_type: "workspace-bridge-open",
    requestId: "open-stale",
    bridgeSessionId: "bridge-stale",
    bridgeGeneration: 1,
    workspaceKey: "/srv/a",
    taskId: "stale",
  });
  await staleStarted;
  await router.handle({
    zcode_type: "workspace-bridge-open",
    requestId: "open-current",
    bridgeSessionId: "bridge-current",
    bridgeGeneration: 2,
    workspaceKey: "/srv/a",
    taskId: "current",
  });
  resolveStale?.(stale.bridge);
  await staleOpen;

  assert.deepEqual(
    output.filter((payload) => payload.zcode_type === "workspace-bridge-ready"),
    [
      {
        zcode_type: "workspace-bridge-ready",
        requestId: "open-current",
        bridgeSessionId: "bridge-current",
        bridgeGeneration: 2,
        bridge: {
          bridgeSessionId: "bridge-current",
          bridgeGeneration: 2,
          kind: "local",
          workspaceKey: "/srv/a",
          workspacePath: "/srv/a",
          initialTaskId: "current",
        },
      },
    ],
  );
  assert.equal(stale.closed(), true);
  assert.equal(current.closed(), false);
});

test("headless platform requests return safe results or explicit unsupported errors", async () => {
  const output: unknown[] = [];
  const router = createForkRemoteAppRouter({
    deviceSid: "device-1",
    appVersion: "3.17.162",
    logger,
    listWorkspaces: async () => ({ workspaces: [] }),
    openCoreBridge: async () => fakeBridge().bridge,
    sendPayload: (payload) => (output.push(payload), true),
  });
  await router.handle({
    zcode_type: "platform-request",
    requestId: "p1",
    method: "listDockerContainers",
  });
  await router.handle({
    zcode_type: "platform-request",
    requestId: "p2",
    method: "createTempTextAttachment",
    args: { text: "x", filename: "x.txt" },
  });
  assert.deepEqual(output[0], {
    zcode_type: "platform-response",
    requestId: "p1",
    method: "listDockerContainers",
    success: true,
    result: [],
  });
  assert.deepEqual(output[1], {
    zcode_type: "platform-response",
    requestId: "p2",
    method: "createTempTextAttachment",
    success: false,
    error: "createTempTextAttachment is not supported by headless ZCode Server",
  });
});
