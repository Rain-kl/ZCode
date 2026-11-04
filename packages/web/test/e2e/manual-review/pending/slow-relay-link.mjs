import { createServer, request } from "node:http";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";

/** 单独限速 Server ↔ Relay；每方向独立 FIFO，延迟与传输时间均计入。 */
export async function createSlowRelayLink(
  endpoint,
  { latencyMs = 150, bytesPerSecond = 64 * 1024 } = {},
) {
  const metrics = {
    latencyMs,
    bytesPerSecond,
    up: { bytes: 0, queued: 0, peak: 0 },
    down: { bytes: 0, queued: 0, peak: 0 },
  };
  const sockets = new Set();
  const timers = new Set();
  const server = createServer((incoming, outgoing) => {
    const forwarded = request(
      new URL(incoming.url, endpoint),
      { method: incoming.method, headers: incoming.headers },
      (response) => {
        outgoing.writeHead(response.statusCode, response.headers);
        response.pipe(outgoing);
      },
    );
    forwarded.on("error", (error) => {
      outgoing.writeHead(502);
      outgoing.end(error.message);
    });
    incoming.pipe(forwarded);
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (incoming, socket, head) => {
    wss.handleUpgrade(incoming, socket, head, (device) => {
      const url = new URL(incoming.url, endpoint);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const relay = new WebSocket(url);
      sockets.add(device);
      sockets.add(relay);
      const lane = (destination, metric) => {
        let next = 0;
        return (raw, binary) => {
          const data = Buffer.from(raw);
          metric.bytes += data.length;
          metric.queued += data.length;
          metric.peak = Math.max(metric.peak, metric.queued);
          next = Math.max(Date.now() + latencyMs, next) + (data.length / bytesPerSecond) * 1000;
          const timer = setTimeout(
            () => {
              timers.delete(timer);
              metric.queued -= data.length;
              if (destination.readyState === WebSocket.OPEN) destination.send(data, { binary });
            },
            Math.max(0, next - Date.now()),
          );
          timers.add(timer);
        };
      };
      const sendUp = lane(relay, metrics.up);
      const early = [];
      device.on("message", (data, binary) =>
        relay.readyState === WebSocket.CONNECTING
          ? early.push([data, binary])
          : sendUp(data, binary),
      );
      relay.on("open", () => {
        for (const [data, binary] of early.splice(0)) sendUp(data, binary);
      });
      relay.on("message", lane(device, metrics.down));
      for (const [current, other] of [
        [device, relay],
        [relay, device],
      ]) {
        current.on("close", () => {
          sockets.delete(current);
          other.terminate();
        });
        current.on("error", () => other.terminate());
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    metrics,
    async close() {
      for (const timer of timers) clearTimeout(timer);
      for (const socket of sockets) socket.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
