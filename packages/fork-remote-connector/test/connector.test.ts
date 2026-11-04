import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import {
  ChannelClient,
  ChannelServer,
  Emitter,
  Event,
  SocketProtocol,
  VSBuffer,
  type ISocket,
} from "@zcode/rpc";
import { createFakeRelayV2 } from "@zcode/shared/testing/fake-relay-v2";
import { WebSocket, WebSocketServer } from "ws";
import { createForkRemoteConnector, openLoopbackCoreBridge } from "../src/connector.js";
import type { ForkRemoteConnectorOptions } from "../src/contract.js";

const logger = { info() {}, warn() {}, error() {} };

function wrapCoreTestSocket(socket: WebSocket): ISocket {
  const data = new Emitter<VSBuffer>();
  const close = new Emitter<void>();
  socket.on("message", (raw) => data.fire(VSBuffer.wrap(new Uint8Array(raw as Buffer))));
  socket.on("close", () => close.fire());
  return {
    onData: data.event,
    onClose: close.event,
    onEnd: close.event,
    write(buffer) {
      socket.send(buffer.buffer);
    },
    end() {
      socket.close();
    },
    drain: () => Promise.resolve(),
    dispose() {
      socket.close();
    },
  };
}

test("loopback bridge retains Core frames emitted before router subscription", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  server.on("connection", (socket) => {
    const protocol = new SocketProtocol(wrapCoreTestSocket(socket));
    const channelServer = new ChannelServer(protocol, "server");
    channelServer.registerChannel("settings", {
      call: async (_context, command) => {
        assert.equal(command, "get");
        return { theme: "dark" };
      },
      listen: () => Event.None,
    });
  });
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const bridge = await openLoopbackCoreBridge({
    host: "127.0.0.1",
    port,
    ingressToken: "test-token",
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const inbound = new Emitter<VSBuffer>();
    const channelClient = new ChannelClient({
      onMessage: inbound.event,
      send: (message) => bridge.send(message.buffer),
    });
    const disposeBridge = bridge.onMessage((bytes) => inbound.fire(VSBuffer.wrap(bytes)));
    assert.equal(channelClient.isInitialized(), true);
    assert.deepEqual(await channelClient.getChannel("settings").call("get"), {
      theme: "dark",
    });
    disposeBridge();
    channelClient.dispose();
    inbound.dispose();
  } finally {
    bridge.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

async function registerDevice(endpoint: string, jwt: string, deviceMid = "server-mid") {
  const response = await fetch(`${endpoint}/api/v1/remote/device`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ device_mid: deviceMid }),
  });
  const body = (await response.json()) as { data: { device_sid: string } };
  return body.data.device_sid;
}

async function terminalSocket(endpoint: string, jwt: string, deviceSid: string) {
  const response = await fetch(`${endpoint}/api/v1/remote/token`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ role: "terminal" }),
  });
  const body = (await response.json()) as { data: { token: string } };
  const url = new URL(endpoint);
  url.protocol = "ws:";
  url.pathname = "/api/v1/remote/ws2";
  url.searchParams.set("token", body.data.token);
  const socket = new WebSocket(url);
  await once(socket, "open");
  socket.send(JSON.stringify({ type: "auth_init", device_sid: deviceSid }));
  return socket;
}

function connectorOptions(
  endpoint: string,
  sessionToken: string,
  deviceSid: string,
  overrides: Partial<ForkRemoteConnectorOptions> = {},
): ForkRemoteConnectorOptions {
  return {
    endpoint,
    sessionToken,
    deviceSid,
    deviceMid: "server-mid",
    deviceName: "Server",
    platform: "linux",
    appVersion: "3.17.162",
    startupTimeoutMs: 1_000,
    logger,
    listWorkspaces: async () => ({
      workspaces: [{ workspacePath: "/srv/a", label: "A", kind: "local" }],
      activeWorkspaceKey: "/srv/a",
    }),
    prepareWorkspace: async (request) => ({
      workspaceKey: request.workspaceKey,
      workspacePath: "/srv/a",
      workspaceIdentity: "remote:server:test:/srv/a",
      remoteSessionId: "core-session",
    }),
    openCoreBridge: async () => ({
      onMessage: () => () => {},
      send() {},
      setFlowState() {},
      close() {},
    }),
    ...overrides,
  };
}

test("auth_ack waiting is enough for connector startup", async () => {
  const relay = await createFakeRelayV2({ users: { jwt: "owner" } });
  const sid = await registerDevice(relay.httpUrl, "jwt");
  const connector = createForkRemoteConnector(connectorOptions(relay.httpUrl, "jwt", sid));
  try {
    await connector.start();
    assert.equal(
      relay.messages.some(
        (record) =>
          record.role === "device" &&
          record.message &&
          typeof record.message === "object" &&
          "type" in record.message &&
          record.message.type === "auth_init",
      ),
      true,
    );
  } finally {
    connector.stop();
    await relay.close();
  }
});

test("matched terminal payloads route through the existing app router", async () => {
  const relay = await createFakeRelayV2({ users: { jwt: "owner" } });
  const sid = await registerDevice(relay.httpUrl, "jwt");
  const terminal = await terminalSocket(relay.httpUrl, "jwt", sid);
  const connector = createForkRemoteConnector(connectorOptions(relay.httpUrl, "jwt", sid));
  try {
    await connector.start();
    const response = new Promise<unknown>((resolve) => {
      terminal.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as { type?: string; payload?: unknown };
        if (message.type === "data") resolve(message.payload);
      });
    });
    terminal.send(
      JSON.stringify({
        type: "data",
        payload: { zcode_type: "bootstrap-request", requestId: "bootstrap-1" },
      }),
    );
    assert.deepEqual(await response, {
      zcode_type: "bootstrap-response",
      requestId: "bootstrap-1",
      success: true,
      result: {
        windowControlSessionId: sid,
        desktopAppVersion: "3.17.162",
        workspaces: [{ workspacePath: "/srv/a", label: "A", kind: "local" }],
        initialViewState: { activeWorkspaceKey: "/srv/a", updatedAt: 0 },
      },
    });
  } finally {
    connector.stop();
    terminal.terminate();
    await relay.close();
  }
});

test("startup timeout stops the generation and a later start creates a fresh attempt", async () => {
  const relay = await createFakeRelayV2({
    users: { jwt: "owner" },
    onMessage: ({ message }) =>
      message && typeof message === "object" && "type" in message && message.type === "auth_init"
        ? { drop: true }
        : undefined,
  });
  const sid = await registerDevice(relay.httpUrl, "jwt");
  const connector = createForkRemoteConnector(
    connectorOptions(relay.httpUrl, "jwt", sid, { startupTimeoutMs: 40 }),
  );
  try {
    await assert.rejects(connector.start(), /did not acknowledge/);
    const firstTicketCount = relay.httpCalls.filter(
      (call) => call.path === "/api/v1/remote/token",
    ).length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(
      relay.httpCalls.filter((call) => call.path === "/api/v1/remote/token").length,
      firstTicketCount,
      "timed-out generation must not leave a reconnect timer behind",
    );
    await assert.rejects(connector.start(), /did not acknowledge/);
    assert.equal(
      relay.httpCalls.filter((call) => call.path === "/api/v1/remote/token").length,
      firstTicketCount + 1,
    );
  } finally {
    connector.stop();
    await relay.close();
  }
});

test("ticket HTTP 401 is a terminal authentication failure", async () => {
  const relay = await createFakeRelayV2({ users: { valid: "owner" } });
  const actual = createForkRemoteConnector(
    connectorOptions(relay.httpUrl, "invalid", "device-1", { startupTimeoutMs: 2_000 }),
  );
  try {
    await assert.rejects(actual.start(), /authentication|HTTP 401/i);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(
      relay.httpCalls.filter((call) => call.path === "/api/v1/remote/token").length,
      1,
      "terminal authentication failure must not enter transient retry backoff",
    );
  } finally {
    actual.stop();
    await relay.close();
  }
});
