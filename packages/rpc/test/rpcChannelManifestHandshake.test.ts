/**
 * FORK(rpc-channel-manifest): Initialize 载荷契约测试。
 *
 * 这里锁的是「客户端能从 Initialize 里读回服务端注册的通道清单」这一依赖契约，而不是 RPC 内部实现：
 *  - 形状：body 是 `{ channels: string[] }`，字段名 `channels` 是跨端约定，不在类型签名之外还有第二处定义；
 *  - 时序：通道注册完成后才发 Initialize，清单必须完整——早期发送会把真实服务误判为不可用；
 *  - 兼容：旧服务端（body 为 undefined，即改造前的 header-only 形态）必须被读成「清单未知」而不是空清单，
 *    新客户端对旧服务端的行为与改造前一致。
 *
 * 上游若改名 Initialize 载荷字段或改动发送时机，这些断言应当变红。
 * 见 FEATURES.md 的 rpc-channel-manifest 条目。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ChannelClient } from "../src/channelClient.js";
import { ChannelServer } from "../src/channelServer.js";
import { createQueuePair } from "../src/protocol.js";
import { BufferReader, BufferWriter, deserialize, serialize } from "../src/serialization.js";
import { ResponseType, type IServerChannel } from "../src/channels.shared.js";

/** 只需要 call/listen 形状的占位通道；本文件不调用它们。 */
function stubChannel(): IServerChannel<string> {
  return {
    async call<T>() {
      return undefined as T;
    },
    listen<_T>() {
      return () => ({ dispose() {} }) as never;
    },
  };
}

/** 轮询等待条件成立，避开对具体微任务/timer 时序的硬编码假设。 */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor 超时：条件在预期时间内未成立");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test("服务端注册完通道后才发 Initialize，客户端能读回完整清单", async () => {
  const [clientSide, serverSide] = createQueuePair();
  const server = new ChannelServer(serverSide, "test");
  const client = new ChannelClient(clientSide);

  // 与服务端装配点同构：构造 ChannelServer 之后再同步注册通道。
  server.registerChannel("file", stubChannel());
  server.registerChannel("fork-webdav", stubChannel());
  server.registerChannel("fork-identity-preset", stubChannel());

  await waitFor(() => client.isInitialized());
  assert.deepEqual([...(client.channelNames() ?? [])].sort(), [
    "file",
    "fork-identity-preset",
    "fork-webdav",
  ]);

  client.dispose();
  server.dispose();
});

test("deferInit 链路：ready() 之前的清单为空，ready() 之后包含全部已注册通道", async () => {
  const [clientSide, serverSide] = createQueuePair();
  const server = new ChannelServer(serverSide, "test", 1000, true);
  const client = new ChannelClient(clientSide);

  server.registerChannel("file", stubChannel());
  // 构造时带 deferInit：Initialize 必须等到 ready() 才发，否则远程建连期间 renderer 会先发请求。
  assert.equal(client.isInitialized(), false);
  assert.equal(client.channelNames(), undefined);

  server.ready();
  await waitFor(() => client.isInitialized());
  assert.deepEqual([...(client.channelNames() ?? [])], ["file"]);

  client.dispose();
  server.dispose();
});

test("Initialize 载荷字段名是 channels（跨端约定，不在类型外再定义）", async () => {
  const [clientSide, serverSide] = createQueuePair();
  const server = new ChannelServer(serverSide, "test");
  server.registerChannel("file", stubChannel());

  const body = await new Promise<unknown>((resolve) => {
    clientSide.onMessage((message) => {
      const reader = new BufferReader(message);
      const header = deserialize(reader);
      const payload = deserialize(reader);
      assert.equal(header[0], ResponseType.Initialize);
      resolve(payload);
    });
  });

  assert.deepEqual(body, { channels: ["file"] });
  server.dispose();
});

test("旧服务端（header-only Initialize）读成「清单未知」，不伪装成空清单", async () => {
  const [clientSide, serverSide] = createQueuePair();
  const client = new ChannelClient(clientSide);

  // 复刻改造前服务端的发送形态：header 只有 ResponseType，body 为 undefined。
  const writer = new BufferWriter();
  serialize(writer, [ResponseType.Initialize]);
  serialize(writer, undefined);
  serverSide.send(writer.buffer);

  await waitFor(() => client.isInitialized());
  assert.equal(client.channelNames(), undefined);

  client.dispose();
});

test("清单里的非字符串元素被剔除，全部非法时视为未知", async () => {
  const [clientSide, serverSide] = createQueuePair();
  const client = new ChannelClient(clientSide);

  const writer = new BufferWriter();
  serialize(writer, [ResponseType.Initialize]);
  serialize(writer, { channels: [42, "file", null] });
  serverSide.send(writer.buffer);

  await waitFor(() => client.isInitialized());
  assert.deepEqual([...(client.channelNames() ?? [])], ["file"]);

  client.dispose();
});

test("后到的 Initialize 覆盖旧清单，且旧服务端不带清单时不清空已有清单", async () => {
  const [clientSide, serverSide] = createQueuePair();
  const client = new ChannelClient(clientSide);

  const sendInitialize = (payload: unknown): void => {
    const writer = new BufferWriter();
    serialize(writer, [ResponseType.Initialize]);
    serialize(writer, payload);
    serverSide.send(writer.buffer);
  };

  sendInitialize({ channels: ["file", "fork-webdav"] });
  await waitFor(() => client.channelNames()?.length === 2);

  // 旧服务端形态：不带清单，不能把已经收到的清单清成未知。
  sendInitialize(undefined);
  await waitFor(() => client.isInitialized());
  assert.deepEqual([...(client.channelNames() ?? [])], ["file", "fork-webdav"]);

  // 新清单覆盖旧清单（服务端换代/重连后清单可能变化）。
  sendInitialize({ channels: ["file"] });
  await waitFor(() => client.channelNames()?.length === 1);
  assert.deepEqual([...(client.channelNames() ?? [])], ["file"]);

  client.dispose();
});
