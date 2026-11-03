import { DurableObject } from "cloudflare:workers";
import {
  parseWebRemoteControlRelayV2HttpRequest,
  parseWebRemoteControlRelayV2OutgoingMessage,
  type WebRemoteControlRelayV2Device,
  type WebRemoteControlRelayV2IncomingMessage,
  type WebRemoteControlRelayV2Meta,
  type WebRemoteControlRelayV2Role,
} from "@zcode/shared/web-remote-relay";
import { FORK_REMOTE_TICKET_SECONDS, type ForkRemoteRelayEnv } from "./contract.js";
import { reconcileTicketCleanup } from "./ticketCleanup.js";

interface StoredDevice extends WebRemoteControlRelayV2Device {
  userId: string;
}

interface StoredTicket {
  userId: string;
  role: WebRemoteControlRelayV2Role;
  expiresAt: number;
}

interface SocketAttachment {
  connectionId: string;
  userId: string;
  role: WebRemoteControlRelayV2Role;
  terminalSid: string;
  deviceSid?: string;
}

const devicePrefix = "device:";
const ticketPrefix = "ticket:";
const ownerPrefix = "owner:";
const webSocketOpen = 1;

function response(status: number, data?: unknown, code = status === 200 ? 0 : status, msg = "") {
  return Response.json(
    { code, msg, ...(data === undefined ? {} : { data }) },
    { status, headers: { "content-type": "application/json; charset=utf-8" } },
  );
}

function randomId(prefix: string): string {
  return `${prefix}${crypto.randomUUID().replaceAll("-", "")}`;
}

function ownerKey(deviceSid: string, role: WebRemoteControlRelayV2Role): string {
  return `${ownerPrefix}${deviceSid}:${role}`;
}

export class RelayRoom extends DurableObject<ForkRemoteRelayEnv> {
  async alarm(): Promise<void> {
    await reconcileTicketCleanup(this.ctx.storage);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = request.headers.get("x-zcode-relay-user");
    if (url.pathname === "/internal/ws" && request.method === "GET")
      return this.acceptSocket(request, url.searchParams.get("token") ?? "");
    if (!userId) return response(401);

    if (url.pathname === "/internal/device" && request.method === "POST")
      return this.registerDevice(userId, await request.json());
    if (url.pathname === "/internal/device" && request.method === "GET")
      return this.listDevices(userId);
    if (url.pathname === "/internal/device/delete" && request.method === "POST")
      return this.deleteDevice(userId, await request.json());
    if (url.pathname === "/internal/token" && request.method === "POST")
      return this.issueTicket(userId, await request.json());
    return response(404);
  }

  async webSocketMessage(socket: WebSocket, value: string | ArrayBuffer): Promise<void> {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment || typeof value !== "string") return this.rejectSocket(socket, "WRONG_PARAM");

    let raw: unknown;
    try {
      raw = JSON.parse(value);
    } catch {
      return this.rejectSocket(socket, "WRONG_PARAM");
    }
    const message = parseWebRemoteControlRelayV2OutgoingMessage(raw);
    if (!message) return this.rejectSocket(socket, "WRONG_PARAM");

    if (message.type === "auth_init") {
      await this.authenticateSocket(socket, attachment, message.device_sid, message.meta ?? {});
      return;
    }
    if (!attachment.deviceSid || !(await this.isCurrentOwner(attachment)))
      return this.rejectSocket(socket, "KICKED");

    if (message.type === "pair_status_query") {
      const peer = await this.findPeer(attachment);
      this.send(socket, {
        type: "pair_status_ack",
        terminal_sid: attachment.role === "terminal" ? attachment.terminalSid : undefined,
        pair_status: peer ? "matched" : "waiting",
      });
      return;
    }

    const peer = await this.findPeer(attachment);
    if (!peer) {
      if (attachment.role === "terminal")
        this.send(socket, { type: "error", code: "DEVICE_OFFLINE" });
      return;
    }
    this.send(peer, { type: "data", payload: message.payload });
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.releaseOwner(socket);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.releaseOwner(socket);
    socket.close(1011, "relay socket error");
  }

  private async registerDevice(userId: string, body: unknown): Promise<Response> {
    const parsed = parseWebRemoteControlRelayV2HttpRequest("register", body);
    if (!parsed) return response(400, undefined, 3001, "parameter error");
    const device: StoredDevice = {
      userId,
      device_sid: randomId("d_"),
      device_mid: parsed.device_mid,
      online: false,
      created_at: Math.floor(Date.now() / 1_000),
      meta: {},
    };
    await this.ctx.storage.put(`${devicePrefix}${device.device_sid}`, device);
    return response(200, this.publicDevice(device, false));
  }

  private async listDevices(userId: string): Promise<Response> {
    const records = await this.ctx.storage.list<StoredDevice>({ prefix: devicePrefix });
    const devices = await Promise.all(
      [...records.values()]
        .filter((device) => device.userId === userId)
        .sort((left, right) => left.created_at - right.created_at)
        .map(async (device) => {
          const owner = await this.currentOwner(device.device_sid, "device");
          if (!owner && Object.keys(device.meta).length > 0) {
            device.meta = {};
            await this.ctx.storage.put(`${devicePrefix}${device.device_sid}`, device);
          }
          return this.publicDevice(device, Boolean(owner));
        }),
    );
    return response(200, devices);
  }

  private async deleteDevice(userId: string, body: unknown): Promise<Response> {
    const parsed = parseWebRemoteControlRelayV2HttpRequest("delete", body);
    if (!parsed) return response(400, undefined, 3001, "parameter error");
    const key = `${devicePrefix}${parsed.device_sid}`;
    const device = await this.ctx.storage.get<StoredDevice>(key);
    if (!device) return response(200);
    if (device.userId !== userId) return response(200, undefined, 1006, "no permission");
    if (await this.currentOwner(parsed.device_sid, "device"))
      return response(400, undefined, 3005, "wrong status");
    await this.ctx.storage.delete(key);
    return response(200);
  }

  private async issueTicket(userId: string, body: unknown): Promise<Response> {
    const parsed = parseWebRemoteControlRelayV2HttpRequest("token", body);
    if (!parsed) return response(400, undefined, 3001, "parameter error");
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const token = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    const ticket: StoredTicket = {
      userId,
      role: parsed.role,
      expiresAt: Date.now() + FORK_REMOTE_TICKET_SECONDS * 1_000,
    };
    await this.ctx.storage.put(`${ticketPrefix}${token}`, ticket);
    await reconcileTicketCleanup(this.ctx.storage);
    return response(200, { token, expires_in: FORK_REMOTE_TICKET_SECONDS });
  }

  private async acceptSocket(request: Request, token: string): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return response(400);
    const ticket = await this.ctx.storage.transaction(async (transaction) => {
      const key = `${ticketPrefix}${token}`;
      const stored = await transaction.get<StoredTicket>(key);
      if (stored) await transaction.delete(key);
      return stored;
    });
    if (!ticket || ticket.expiresAt <= Date.now()) return response(401);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: SocketAttachment = {
      connectionId: crypto.randomUUID(),
      userId: ticket.userId,
      role: ticket.role,
      terminalSid: ticket.role === "terminal" ? randomId("t_") : "",
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async authenticateSocket(
    socket: WebSocket,
    attachment: SocketAttachment,
    deviceSid: string,
    meta: WebRemoteControlRelayV2Meta,
  ): Promise<void> {
    if (attachment.deviceSid) return this.rejectSocket(socket, "WRONG_PARAM");
    const deviceKey = `${devicePrefix}${deviceSid}`;
    const device = await this.ctx.storage.get<StoredDevice>(deviceKey);
    if (!device || device.userId !== attachment.userId)
      return this.rejectSocket(socket, "AUTH_FAILED");

    const key = ownerKey(deviceSid, attachment.role);
    const oldOwner = await this.currentOwner(deviceSid, attachment.role);
    attachment.deviceSid = deviceSid;
    socket.serializeAttachment(attachment);
    await this.ctx.storage.put(key, attachment.connectionId);
    if (attachment.role === "device") {
      device.meta = meta;
      await this.ctx.storage.put(deviceKey, device);
    }

    if (oldOwner && oldOwner !== attachment.connectionId) {
      const oldSocket = this.findSocket(oldOwner);
      if (oldSocket) {
        this.send(oldSocket, { type: "error", code: "KICKED" });
        oldSocket.close(1000, "owner replaced");
      }
    }

    const peer = await this.findPeer(attachment);
    const pairStatus = peer ? "matched" : "waiting";
    this.send(socket, {
      type: "auth_ack",
      device_sid: deviceSid,
      terminal_sid: attachment.role === "terminal" ? attachment.terminalSid : undefined,
      pair_status: pairStatus,
    });
    if (peer) {
      const peerAttachment = peer.deserializeAttachment() as SocketAttachment;
      this.send(peer, {
        type: "pair_status_ack",
        terminal_sid:
          attachment.role === "terminal" ? attachment.terminalSid : peerAttachment.terminalSid,
        pair_status: "matched",
      });
    }
  }

  private async releaseOwner(socket: WebSocket): Promise<void> {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment?.deviceSid) return;
    const key = ownerKey(attachment.deviceSid, attachment.role);
    const released = await this.ctx.storage.transaction(async (transaction) => {
      const current = await transaction.get<string>(key);
      if (current !== attachment.connectionId) return false;
      await transaction.delete(key);
      return true;
    });
    if (!released) return;

    if (attachment.role === "device") {
      const deviceKey = `${devicePrefix}${attachment.deviceSid}`;
      const device = await this.ctx.storage.get<StoredDevice>(deviceKey);
      if (device && Object.keys(device.meta).length > 0) {
        device.meta = {};
        await this.ctx.storage.put(deviceKey, device);
      }
    }

    const peer = await this.findPeer(attachment);
    if (!peer) return;
    this.send(peer, { type: "pair_status_ack", pair_status: "waiting", terminal_sid: "" });
    if (attachment.role === "device") {
      this.send(peer, { type: "error", code: "DEVICE_OFFLINE" });
      peer.close(1000, "device offline");
    }
  }

  private async isCurrentOwner(attachment: SocketAttachment): Promise<boolean> {
    if (!attachment.deviceSid) return false;
    return (
      (await this.currentOwner(attachment.deviceSid, attachment.role)) === attachment.connectionId
    );
  }

  private async findPeer(attachment: SocketAttachment): Promise<WebSocket | undefined> {
    if (!attachment.deviceSid) return undefined;
    const peerRole = attachment.role === "device" ? "terminal" : "device";
    const connectionId = await this.currentOwner(attachment.deviceSid, peerRole);
    return connectionId ? this.findSocket(connectionId) : undefined;
  }

  private findSocket(connectionId: string): WebSocket | undefined {
    return this.ctx.getWebSockets().find((candidate) => {
      const attachment = candidate.deserializeAttachment() as SocketAttachment | null;
      return attachment?.connectionId === connectionId;
    });
  }

  private async currentOwner(
    deviceSid: string,
    role: WebRemoteControlRelayV2Role,
  ): Promise<string | undefined> {
    const key = ownerKey(deviceSid, role);
    const connectionId = await this.ctx.storage.get<string>(key);
    if (!connectionId) return undefined;
    if (this.findSocket(connectionId)) return connectionId;
    await this.ctx.storage.delete(key);
    return undefined;
  }

  private publicDevice(device: StoredDevice, online: boolean): WebRemoteControlRelayV2Device {
    return {
      device_sid: device.device_sid,
      device_mid: device.device_mid,
      online,
      created_at: device.created_at,
      meta: device.meta,
    };
  }

  private send(socket: WebSocket, message: WebRemoteControlRelayV2IncomingMessage): void {
    // KICKED/close can race with a final peer notification; a closed socket is no longer a delivery owner.
    if (socket.readyState !== webSocketOpen) return;
    socket.send(JSON.stringify({ ...message, server_ts: Math.floor(Date.now() / 1_000) }));
  }

  private rejectSocket(socket: WebSocket, code: "AUTH_FAILED" | "WRONG_PARAM" | "KICKED"): void {
    this.send(socket, { type: "error", code });
    socket.close(1000, code);
  }
}
