import http from "node:http";
import https from "node:https";
import { urlToHttpOptions } from "node:url";
import { syncBuiltinESMExports } from "node:module";
import { assertUpstreamRequestAllowed } from "./contract.js";
import { createUpstreamPolicyFetch } from "./module.js";

const installed = Symbol.for("zcode.fork.upstream-network.installed");
const state = globalThis as typeof globalThis & { [installed]?: boolean };
const aliases = () =>
  [
    "ZCODE_BASE_URL",
    "ZCODE_ENDPOINT_ORIGIN",
    "ZCODE_PRODUCTION_BASE_URL",
    "ZCODE_TEST_BASE_URL",
    "ZCODE_FEEDBACK_API_BASE",
  ].flatMap((key) => (process.env[key] ? [process.env[key]!] : []));

/** 必须在进程业务入口导入；共享 Node HTTP 出口同时覆盖 WebSocket 的 upgrade 握手。 */
export function installUpstreamNetworkPolicy(): void {
  if (state[installed]) return;
  state[installed] = true;
  // 模型遥测使用独立 exporter，禁止向环境下发的采集端点发送数据。
  process.env.ZCODE_MODEL_TELEMETRY_ENABLED = "false";
  process.env.OTEL_SDK_DISABLED = "true";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createUpstreamPolicyFetch(originalFetch, aliases);
  for (const transport of [http, https]) {
    const originalRequest = transport.request;
    const protocol = transport === https ? "https:" : "http:";
    transport.request = function (...args: Parameters<typeof http.request>) {
      const first = args[0];
      const extra = typeof args[1] === "object" ? args[1] : {};
      const options = typeof first === "string" || first instanceof URL ? extra : first;
      // CONNECT 只建立代理隧道，真实目标路径已由外层 fetch/HTTP 请求验证。
      if (options.method?.toUpperCase() === "CONNECT")
        return Reflect.apply(originalRequest, transport, args) as http.ClientRequest;
      const base = typeof first === "string" || first instanceof URL ? new URL(first) : undefined;
      // 与 Node 合并 URL/options 的顺序一致，防止 host 覆盖项掩盖实际 hostname。
      const normalized = { ...(base ? urlToHttpOptions(base) : {}), ...options };
      const host = normalized.hostname ?? normalized.host ?? "localhost";
      const port = normalized.port;
      const path = normalized.path ?? "/";
      const url = /^https?:\/\//i.test(path)
        ? path
        : `${normalized.protocol ?? protocol}//${host}${port ? `:${port}` : ""}${path}`;
      assertUpstreamRequestAllowed(url, options.method ?? "GET", aliases());
      return Reflect.apply(originalRequest, transport, args) as http.ClientRequest;
    } as typeof http.request;
    transport.get = function (...args: Parameters<typeof http.get>) {
      const request = Reflect.apply(transport.request, transport, args) as http.ClientRequest;
      request.end();
      return request;
    } as typeof http.get;
  }
  syncBuiltinESMExports();
}

installUpstreamNetworkPolicy();
