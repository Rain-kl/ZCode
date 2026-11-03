import { Emitter, SocketProtocol, VSBuffer, type ISocket } from "@zcode/rpc";
import { parseWebRemoteControlAppPayload } from "@zcode/shared";
import {
  WEB_REMOTE_CONTROL_RELAY_V2_HTTP,
  WEB_REMOTE_CONTROL_RELAY_V2_WS_PATH,
  WebRemoteControlV2Heartbeat,
  WebRemoteControlV2RetryPolicy,
  parseWebRemoteControlRelayV2HttpResponse,
  parseWebRemoteControlRelayV2IncomingMessage,
  type WebRemoteControlRelayV2OutgoingMessage,
} from "@zcode/shared/web-remote-relay";
import { WebSocket, type RawData } from "ws";
import type {
  ForkRemoteConnector,
  ForkRemoteConnectorOptions,
  ForkRemoteCoreBridge,
} from "./contract.js";
import { createForkRemoteAppRouter } from "./router.js";

type RelayJson = null | boolean | number | string | RelayJson[] | { [key: string]: RelayJson };

class RelayAuthenticationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RelayAuthenticationError";
  }
}

function bytes(raw: RawData): Buffer {
  return Array.isArray(raw)
    ? Buffer.concat(raw)
    : Buffer.from(raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw);
}

async function issueDeviceTicket(options: ForkRemoteConnectorOptions, signal: AbortSignal) {
  const endpoint = new URL(options.endpoint);
  endpoint.pathname = WEB_REMOTE_CONTROL_RELAY_V2_HTTP.token.path;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.sessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ role: "device" }),
    signal,
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new RelayAuthenticationError(
        `Relay device ticket authentication failed at ${endpoint.origin}: HTTP ${response.status}`,
      );
    }
    throw new Error(`Relay device ticket failed at ${endpoint.origin}: HTTP ${response.status}`);
  }
  const parsed = parseWebRemoteControlRelayV2HttpResponse("token", await response.json());
  if (!parsed || parsed.code !== 0 || !parsed.data) {
    throw new Error(`Relay device ticket returned an invalid contract at ${endpoint.origin}`);
  }
  return parsed.data.token;
}

export function openLoopbackCoreBridge(options: {
  host: string;
  port: number;
  ingressToken: string;
}): Promise<ForkRemoteCoreBridge> {
  return new Promise((resolve, reject) => {
    const url = new URL(`ws://${options.host}:${options.port}/ws`);
    url.searchParams.set("token", options.ingressToken);
    const socket = new WebSocket(url);
    let settled = false;
    const onData = new Emitter<VSBuffer>();
    const onClose = new Emitter<void>();
    socket.binaryType = "arraybuffer";
    socket.once("error", (error) => {
      if (!settled)
        reject(new Error(`Core replayable WebSocket failed at ${url.host}`, { cause: error }));
      onClose.fire();
    });
    socket.once("close", () => onClose.fire());
    socket.on("message", (raw) => onData.fire(VSBuffer.wrap(bytes(raw))));
    socket.once("open", () => {
      settled = true;
      const rawSocket: ISocket = {
        onData: onData.event,
        onClose: onClose.event,
        onEnd: onClose.event,
        write(buffer) {
          if (socket.readyState === WebSocket.OPEN) socket.send(buffer.buffer);
        },
        end() {
          socket.close();
        },
        drain: () => Promise.resolve(),
        dispose() {
          socket.close();
        },
      };
      const protocol = new SocketProtocol(rawSocket);
      resolve({
        onMessage(listener) {
          const disposable = protocol.onMessage((message) => listener(message.buffer));
          return () => disposable.dispose();
        },
        send(message) {
          protocol.send(VSBuffer.wrap(message));
        },
        setFlowState() {
          // SocketProtocol has no independent flow-control lane; acknowledged replay remains bounded.
        },
        close() {
          protocol.dispose();
          socket.close();
        },
      });
    });
  });
}

export function createForkRemoteConnector(
  options: ForkRemoteConnectorOptions,
): ForkRemoteConnector {
  let controller: AbortController | undefined;
  let socket: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let startResolve: (() => void) | undefined;
  let startReject: ((error: Error) => void) | undefined;
  let started = false;
  let paired = false;
  const retry = new WebRemoteControlV2RetryPolicy();
  const router = createForkRemoteAppRouter({
    ...options,
    sendPayload(payload) {
      if (!paired || socket?.readyState !== WebSocket.OPEN) return false;
      send({
        type: "data",
        payload: payload as unknown as RelayJson,
        client_ts: Math.floor(Date.now() / 1_000),
      });
      return true;
    },
  });
  const heartbeat = new WebRemoteControlV2Heartbeat(
    () => send({ type: "pair_status_query", client_ts: Math.floor(Date.now() / 1_000) }),
    () => scheduleReconnect(),
  );

  function send(message: WebRemoteControlRelayV2OutgoingMessage): void {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function closeSocket(): void {
    heartbeat.stop();
    paired = false;
    const current = socket;
    socket = undefined;
    if (current?.readyState === WebSocket.CONNECTING) current.terminate();
    else current?.close();
  }

  function stopGeneration(reason: string): void {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    controller?.abort();
    controller = undefined;
    closeSocket();
    router.dispose(reason);
    paired = false;
    started = false;
  }

  function failGeneration(error: Error, reason: string): void {
    const reject = startReject;
    startResolve = undefined;
    startReject = undefined;
    stopGeneration(reason);
    reject?.(error);
  }

  function scheduleReconnect(delay = retry.nextDelay()): void {
    if (!controller || controller.signal.aborted) return;
    closeSocket();
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => void connect(), delay);
  }

  async function connect(): Promise<void> {
    const signal = controller?.signal;
    if (!signal || signal.aborted) return;
    try {
      const ticket = await issueDeviceTicket(options, signal);
      if (signal.aborted) return;
      const url = new URL(options.endpoint);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = WEB_REMOTE_CONTROL_RELAY_V2_WS_PATH;
      url.searchParams.set("token", ticket);
      url.searchParams.set("mid", options.deviceMid);
      const current = new WebSocket(url, { perMessageDeflate: true });
      socket = current;
      current.on("open", () => {
        if (socket !== current) return;
        send({
          type: "auth_init",
          device_sid: options.deviceSid,
          meta: {
            name: options.deviceName,
            platform: options.platform,
            version: options.appVersion,
          },
          client_ts: Math.floor(Date.now() / 1_000),
        });
      });
      current.on("message", (raw, isBinary) => {
        if (socket !== current || isBinary) return;
        let value: unknown;
        try {
          value = JSON.parse(bytes(raw).toString("utf8"));
        } catch {
          return;
        }
        const message = parseWebRemoteControlRelayV2IncomingMessage(value);
        if (!message) return;
        if (message.type === "error") {
          if (message.code === "KICKED") {
            const delay = retry.kickedDelay();
            if (delay === null) {
              const error = new Error("Relay device connection was repeatedly replaced");
              options.logger.error("[fork-remote] Relay device connection stopped", error);
              failGeneration(error, "remote.rpcFrame.connectorKicked");
            } else scheduleReconnect(delay);
          } else if (message.code === "AUTH_FAILED") {
            const error = new RelayAuthenticationError(
              "Relay rejected the persisted device identity",
            );
            options.logger.error("[fork-remote] Relay device authentication failed", error);
            failGeneration(error, "remote.rpcFrame.connectorAuthenticationFailed");
          } else scheduleReconnect();
          return;
        }
        if (message.type === "auth_ack") {
          if (message.device_sid !== options.deviceSid) return;
          retry.acknowledged();
          heartbeat.acknowledged();
          paired = message.pair_status === "matched";
          if (!started) {
            started = true;
            startResolve?.();
            startResolve = undefined;
            startReject = undefined;
          }
          if (paired) router.replayUnacknowledged();
          return;
        }
        if (message.type === "pair_status_ack") {
          heartbeat.acknowledged();
          paired = message.pair_status === "matched";
          if (paired) router.replayUnacknowledged();
          return;
        }
        if (message.type === "data" && paired) {
          const payload = parseWebRemoteControlAppPayload(message.payload);
          if (payload) void router.handle(payload);
        }
      });
      current.on("error", () => options.logger.warn("[fork-remote] Relay socket error"));
      current.on("close", () => {
        if (socket === current) scheduleReconnect();
      });
    } catch (error) {
      if (!signal.aborted) {
        if (error instanceof RelayAuthenticationError) {
          options.logger.error("[fork-remote] Relay authentication failed", error);
          failGeneration(error, "remote.rpcFrame.connectorAuthenticationFailed");
        } else {
          options.logger.warn("[fork-remote] Relay connection retry", error);
          scheduleReconnect();
        }
      }
    }
  }

  return {
    async start() {
      if (controller) return;
      controller = new AbortController();
      const timeout = setTimeout(() => {
        const error = new Error(
          `Relay did not acknowledge ZCode Server within ${options.startupTimeoutMs ?? 30_000}ms`,
        );
        failGeneration(error, "remote.rpcFrame.connectorStartupTimeout");
      }, options.startupTimeoutMs ?? 30_000);
      try {
        await new Promise<void>((resolve, reject) => {
          startResolve = resolve;
          startReject = reject;
          void connect();
        });
      } finally {
        clearTimeout(timeout);
      }
    },
    stop() {
      const reject = startReject;
      startResolve = undefined;
      startReject = undefined;
      stopGeneration("remote.rpcFrame.connectorStopped");
      reject?.(new Error("Relay connector was stopped before startup completed"));
    },
  };
}
