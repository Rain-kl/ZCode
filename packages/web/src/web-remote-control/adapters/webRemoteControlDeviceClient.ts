import {
  WEB_REMOTE_CONTROL_RELAY_V2_HTTP,
  WebRemoteControlV2ConnectionError,
  parseWebRemoteControlRelayV2HttpResponse,
  type WebRemoteControlRelayV2Device,
} from "@zcode/shared/web-remote-relay";
import { withWebRemoteControlHttpSignal } from "#src/web-remote-control/adapters/webRemoteControlHttpSignal.js";

/** 列表只是当前账号的在线快照；不缓存 JWT、设备元数据或失败响应正文。 */
export function createWebRemoteControlDeviceClient(origin: string, fetcher = fetch) {
  return async (jwt: string, signal: AbortSignal): Promise<WebRemoteControlRelayV2Device[]> => {
    try {
      return await withWebRemoteControlHttpSignal(signal, async (requestSignal) => {
        const response = await fetcher(
          new URL(WEB_REMOTE_CONTROL_RELAY_V2_HTTP.list.path, origin),
          {
            method: "GET",
            headers: { Authorization: `Bearer ${jwt}` },
            cache: "no-store",
            signal: requestSignal,
            redirect: "error",
          },
        );
        if (response.status === 401) throw new WebRemoteControlV2ConnectionError("auth-required");
        if (!response.ok) throw new WebRemoteControlV2ConnectionError("relay-unavailable");
        const result = parseWebRemoteControlRelayV2HttpResponse("list", await response.json());
        if (!result || result.code !== 0 || !result.data)
          throw new WebRemoteControlV2ConnectionError("relay-unavailable");
        return result.data;
      });
    } catch (error) {
      if (error instanceof WebRemoteControlV2ConnectionError) throw error;
      throw new WebRemoteControlV2ConnectionError("relay-unavailable");
    }
  };
}

// FORK(cloud-web-access): 删除沿用 Relay 的账号与离线状态校验，并保留失败上下文。
export function createWebRemoteControlDeleteDeviceClient(origin: string, fetcher = fetch) {
  return async (jwt: string, sid: string, signal: AbortSignal): Promise<void> => {
    await withWebRemoteControlHttpSignal(signal, async (requestSignal) => {
      const response = await fetcher(
        new URL(WEB_REMOTE_CONTROL_RELAY_V2_HTTP.delete.path, origin),
        {
          method: "POST",
          headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
          body: JSON.stringify({ device_sid: sid }),
          signal: requestSignal,
          redirect: "error",
        },
      );
      if (response.status === 401) throw new WebRemoteControlV2ConnectionError("auth-required");
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw new Error(`Device deletion returned invalid JSON (HTTP ${response.status})`, {
          cause: error,
        });
      }
      const result = parseWebRemoteControlRelayV2HttpResponse("delete", body);
      if (!response.ok || !result || result.code !== 0) {
        const detail =
          result && result.code !== 0 ? `${result.code}: ${result.msg}` : "invalid response";
        throw new Error(`Device deletion failed (HTTP ${response.status}): ${detail}`);
      }
    });
  };
}
