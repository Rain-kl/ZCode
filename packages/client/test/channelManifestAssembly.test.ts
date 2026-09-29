/**
 * FORK(rpc-channel-manifest): 装配顺序契约测试——镜像 desktop 本地 host 的真实装配。
 *
 * 为什么单独写一条：通道清单只有在「注册完成后才发 Initialize」时才是正确的事实，
 * 而 desktop host 的装配顺序是「先注册服务（含 fork 服务）→ 再 attach 端口构造 ChannelServer」
 * （packages/desktop/src/host/index.ts 的 InitLocal 分支）。这条测试把该顺序固化成断言：
 * 顺序被打乱（或在注册前发 Initialize）时，会把桌面上真实存在的 fork 服务判成不可用，
 * 那比一次可见的超时报错更糟。上游若改动 Initialize 发送时机，这里应当变红。
 *
 * 另一个变量是 deferInit/ready()：desktop 的 ExposedServicePortHandle 暴露 ready()，
 * 走这条链路时必须由调用方在注册完成后调用；本文件同时锁定该语义。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ChannelClient, ChannelServer } from "@zcode/rpc";
import { createQueuePair } from "@zcode/rpc";
import { IForkWebdavService, ServiceCollection } from "@zcode/services";
import { RemoteServiceAccess } from "../src/remoteServiceAccess.js";
import { FORK_IDENTITY_PRESET_CHANNEL, FORK_WEBDAV_CHANNEL } from "@zcode/shared";

/** 只需要「有方法」即可被 ProxyChannel.fromService 包装。 */
function stubForkWebdavService(): Record<string, unknown> {
  return {
    async getStatus() {
      return { configured: false };
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor 超时：条件在预期时间内未成立");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test("本地 host 装配顺序：先注册 fork 服务再构造 ChannelServer，客户端读到完整清单并拿到代理", async () => {
  const services = new ServiceCollection();
  services.register(IForkWebdavService, stubForkWebdavService() as never);

  const [clientSide, serverSide] = createQueuePair();
  // 与 desktop 一致：register 全部发生在 ChannelServer 构造之后、Initialize 发出之前。
  const server = new ChannelServer(serverSide, "host", 1000, false);
  services.exposeOnChannelServer(server);

  const client = new ChannelClient(clientSide);
  await waitFor(() => client.isInitialized());
  assert.equal(client.channelNames()?.includes(FORK_WEBDAV_CHANNEL), true);

  const accessor = new RemoteServiceAccess(client);
  assert.equal(accessor.channelAvailability.isInitialized(), true);
  assert.equal(typeof accessor.forkWebdavService, "object");

  client.dispose();
  server.dispose();
});

test("deferInit 链路：ready() 在注册完成后调用，清单完整；未调用 ready() 时客户端保持未知清单", async () => {
  const services = new ServiceCollection();
  services.register(IForkWebdavService, stubForkWebdavService() as never);

  const [clientSide, serverSide] = createQueuePair();
  const server = new ChannelServer(serverSide, "host", 1000, true);
  services.exposeOnChannelServer(server);

  const client = new ChannelClient(clientSide);
  const accessor = new RemoteServiceAccess(client);

  // ready() 未调用：清单未知 → 保持历史行为（仍建代理），不会把真实服务提前判成不可用。
  assert.equal(client.isInitialized(), false);
  assert.equal(accessor.channelAvailability.channelNames(), undefined);
  assert.equal(typeof accessor.forkWebdavService, "object");

  server.ready();
  await waitFor(() => client.isInitialized());
  assert.equal(client.channelNames()?.includes(FORK_WEBDAV_CHANNEL), true);
  assert.equal(typeof accessor.forkWebdavService, "object");

  client.dispose();
  server.dispose();
});

test("只注册了部分通道的 host：未注册的通道读作 undefined，已注册的照旧可用", async () => {
  const services = new ServiceCollection();
  services.register(IForkWebdavService, stubForkWebdavService() as never);

  const [clientSide, serverSide] = createQueuePair();
  const server = new ChannelServer(serverSide, "host", 1000, false);
  // 只在本地 host 注册 WebDAV，没有 identity-preset：模拟「部分支持」的 host。
  services.exposeOnChannelServer(server);

  const client = new ChannelClient(clientSide);
  await waitFor(() => client.isInitialized());

  const accessor = new RemoteServiceAccess(client);
  assert.equal(typeof accessor.forkWebdavService, "object");
  // 清单里没有该通道：UI 应显示「当前环境不支持」，且这里不会为它建代理。
  assert.equal(accessor.forkIdentityPresetService, undefined);
  assert.equal(client.channelNames()?.includes(FORK_IDENTITY_PRESET_CHANNEL), false);

  client.dispose();
  server.dispose();
});

test("Initialize 之后新增通道会补发清单，客户端跟上（运行期插件式注册不可被永久判为缺失）", async () => {
  const [clientSide, serverSide] = createQueuePair();
  const server = new ChannelServer(serverSide, "host", 1000, false);
  server.registerChannel("file", {
    async call<T>() {
      return undefined as T;
    },
    listen<_T>() {
      return () => ({ dispose() {} });
    },
  });

  const client = new ChannelClient(clientSide);
  const accessor = new RemoteServiceAccess(client);
  await waitFor(() => client.isInitialized());
  assert.equal(accessor.forkWebdavService, undefined);

  server.registerChannel(FORK_WEBDAV_CHANNEL, {
    async call<T>() {
      return undefined as T;
    },
    listen<_T>() {
      return () => ({ dispose() {} });
    },
  });
  await waitFor(() => accessor.forkWebdavService !== undefined);

  client.dispose();
  server.dispose();
});
