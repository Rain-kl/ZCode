/**
 * FORK(rpc-channel-manifest): RemoteServiceAccess 的清单过滤契约测试。
 *
 * 断言的是我们依赖的三条语义：
 *  1. 清单缺失的通道 → 对应可选成员为 undefined（UI 才能显示「当前环境不支持」而不是超时错误）；
 *  2. 清单未知（旧服务端 / Initialize 未到达）→ 保持改造前的行为（照旧建代理），保证向前兼容；
 *  3. 同一清单下成员标识稳定（否则 React 以服务为依赖的 effect 会反复重跑）。
 *
 * 上游若把 RemoteServiceAccess 改成无条件建代理，这些断言应当变红。
 * 见 FEATURES.md 的 rpc-channel-manifest 条目。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Emitter, Event, type IChannel, type IChannelClient } from "@zcode/rpc";
import { FORK_IDENTITY_PRESET_CHANNEL, FORK_WEBDAV_CHANNEL } from "@zcode/shared";
import { RemoteServiceAccess } from "../src/remoteServiceAccess.js";

/** 占位通道；本文件只断言代理是否被建立，不发起 RPC 调用。 */
function stubChannel(): IChannel {
  return {
    async call<T>() {
      return undefined as T;
    },
    listen<T>() {
      return Event.None as Event<T>;
    },
  };
}

class FakeChannelClient implements IChannelClient {
  private readonly emitter = new Emitter<void>();
  readonly onDidInitialize = this.emitter.event;
  /** 记录每个通道被 getChannel 请求过的次数，用于断言「不为缺失通道建代理」。 */
  readonly requested: string[] = [];

  constructor(
    private manifest: readonly string[] | undefined,
    private initialized = true,
  ) {}

  getChannel<T extends IChannel>(channelName: string): T {
    this.requested.push(channelName);
    return stubChannel() as T;
  }

  channelNames(): readonly string[] | undefined {
    return this.manifest;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /** 模拟 Initialize 到达（清单从未知变为已知）。 */
  deliverManifest(channels: readonly string[]): void {
    this.manifest = channels;
    this.initialized = true;
    this.emitter.fire();
  }
}

test("清单里没有的 fork 通道读作 undefined，且不为其建代理", () => {
  const client = new FakeChannelClient(["file", "setting", "zcode-agent"]);
  const services = new RemoteServiceAccess(client);

  assert.equal(services.forkWebdavService, undefined);
  assert.equal(services.forkIdentityPresetService, undefined);
  assert.equal(services.forkSearchProvidersService, undefined);
  // 只对真实存在的通道取过 channel；缺失通道不得触发 getChannel（那会白白建一个惰性代理）。
  for (const missing of [
    FORK_WEBDAV_CHANNEL,
    FORK_IDENTITY_PRESET_CHANNEL,
    "media-preview",
    "onboarding-record",
    "window-controller",
    "cua-permission",
  ]) {
    assert.equal(client.requested.includes(missing), false, `不应为缺失通道建代理：${missing}`);
  }
  for (const present of ["file", "setting", "zcode-agent"]) {
    assert.equal(client.requested.includes(present), true, `应保留必备通道代理：${present}`);
  }
});

test("清单里声明的 fork 通道照旧拿到代理", () => {
  const client = new FakeChannelClient(["file", FORK_WEBDAV_CHANNEL]);
  const services = new RemoteServiceAccess(client);

  assert.equal(typeof services.forkWebdavService, "object");
  assert.equal(services.forkIdentityPresetService, undefined);
});

test("清单未知时保持改造前的行为：所有可选成员照旧建代理", () => {
  const client = new FakeChannelClient(undefined);
  const services = new RemoteServiceAccess(client);

  assert.equal(typeof services.forkWebdavService, "object");
  assert.equal(typeof services.forkIdentityPresetService, "object");
  assert.equal(typeof services.forkSearchProvidersService, "object");
  assert.equal(typeof services.mediaPreviewService, "object");
  assert.equal(typeof services.onboardingRecordService, "object");
  assert.equal(typeof services.windowControllerService, "object");
  assert.equal(typeof services.cuaPermissionService, "object");
});

test("Initialize 到达后可用性自动跟上，无需重建 RemoteServiceAccess", () => {
  const client = new FakeChannelClient(undefined, false);
  const services = new RemoteServiceAccess(client);

  // 握手未完成：清单未知 → 视为可用（与改造前一致），不会把真实服务提前判成不可用。
  assert.equal(services.channelAvailability.isInitialized(), false);
  assert.equal(services.channelAvailability.channelNames(), undefined);
  assert.equal(typeof services.forkWebdavService, "object");

  client.deliverManifest(["file", "setting"]);
  assert.equal(services.channelAvailability.isInitialized(), true);
  assert.equal(services.forkWebdavService, undefined);

  client.deliverManifest(["file", "setting", FORK_WEBDAV_CHANNEL]);
  assert.equal(typeof services.forkWebdavService, "object");
});

test("同一清单下成员标识稳定（React effect 依赖不会每渲染都变）", () => {
  const client = new FakeChannelClient(["file", FORK_WEBDAV_CHANNEL]);
  const services = new RemoteServiceAccess(client);

  const first = services.forkWebdavService;
  assert.equal(services.forkWebdavService, first);
  assert.equal(services.forkWebdavService, first);
});

test("可用性变化事件可订阅，订阅在清单更新时触发", () => {
  const client = new FakeChannelClient(undefined, false);
  const services = new RemoteServiceAccess(client);

  let fired = 0;
  const subscription = services.channelAvailability.onDidChange(() => {
    fired += 1;
  });
  client.deliverManifest(["file"]);
  assert.equal(fired, 1);
  subscription.dispose();
});

test("必备（非可选）服务不受清单过滤影响", () => {
  const client = new FakeChannelClient(["file"]);
  const services = new RemoteServiceAccess(client);

  assert.equal(typeof services.fileService, "object");
  assert.equal(typeof services.settingService, "object");
  assert.equal(typeof services.zcodeAgentService, "object");
});
