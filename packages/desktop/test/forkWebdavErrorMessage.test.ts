import assert from "node:assert/strict";
import test from "node:test";
import { describeForkWebdavError } from "../src/host/fork/webdav/error-message.js";
import {
  WebdavRequestError,
  WebdavTransportError,
  createWebdavClient,
  type WebdavFetch,
} from "../src/host/fork/webdav/webdav-client.js";

/**
 * 这组测试来自一次真实排查：WebDAV 在设置页永远只显示 "fetch failed"，
 * 因为各处只取 `error.message`，而 undici 把真正的原因（TLS 被重置、代理不可达…）
 * 放在 `error.cause` 上。契约是：错误消息必须能一路展开到最内层原因。
 */

test("展开 cause 链，保留每层的 name/message 与 code", () => {
  const innermost = Object.assign(
    new Error("Client network socket disconnected before secure TLS connection was established"),
    { code: "ECONNRESET" },
  );
  const fetchFailed = Object.assign(new TypeError("fetch failed"), { cause: innermost });

  assert.equal(
    describeForkWebdavError(fetchFailed),
    "TypeError: fetch failed ← Error: Client network socket disconnected before secure TLS connection was established [ECONNRESET]",
  );
});

test("非 Error 的抛出物与空 cause 都不能让消息变成空串", () => {
  assert.equal(describeForkWebdavError("boom"), "boom");
  assert.equal(describeForkWebdavError(new Error("only")), "Error: only");
  // cause 为空时不应产生尾部箭头。
  assert.equal(describeForkWebdavError(new Error("a", { cause: undefined })), "Error: a");
});

test("连接层失败必须带上是哪个方法/URL，并且可区分于服务端错误状态", async () => {
  const failingFetch: WebdavFetch = () => {
    throw Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
    });
  };
  const client = createWebdavClient({
    baseUrl: "https://dav.example.com/dav",
    directory: "/zcode/",
    username: "u",
    password: "p",
    fetchImpl: failingFetch,
  });

  await assert.rejects(
    () => client.testConnection(),
    (error: unknown) => {
      assert.ok(error instanceof WebdavTransportError);
      // 区分「没拿到 HTTP 响应」与「服务端答了错误状态」是排查的第一分叉点。
      assert.equal(
        describeForkWebdavError(error),
        "WebdavTransportError: WebDAV PROPFIND https://dav.example.com/dav/zcode/ 请求失败：未收到 HTTP 响应" +
          " ← TypeError: fetch failed ← Error: getaddrinfo ENOTFOUND [ENOTFOUND]",
      );
      return true;
    },
  );
});

test("服务端返回错误状态时仍是 WebdavRequestError（带状态码）", async () => {
  const unauthorizedFetch: WebdavFetch = async () => ({
    status: 401,
    ok: false,
    text: async () => "",
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  const client = createWebdavClient({
    baseUrl: "https://dav.example.com/dav",
    directory: "/zcode/",
    username: "u",
    password: "p",
    fetchImpl: unauthorizedFetch,
  });

  await assert.rejects(
    () => client.testConnection(),
    (error: unknown) => {
      assert.ok(error instanceof WebdavRequestError);
      assert.equal(error.status, 401);
      return true;
    },
  );
});
