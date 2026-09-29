/**
 * FORK(rpc-channel-manifest): UI 读取「对端 host/server 声明了哪些通道」的唯一入口。
 *
 * 为什么需要独立的可用性面，而不是让 UI 直接读服务代理是否存在：
 * 服务代理是惰性对象（`ProxyChannel.toService` 恒返回真值），而 Initialize 可能晚于 UI 首次渲染，
 * 所以「可用性事实」和「判定时机」必须分开表达——`channelNames()` 给事实，`onDidChange` 给时机。
 * UI 在 `isInitialized()` 变 true 之前不得发起可选服务的探测调用，否则一次「通道不存在」会被
 * 服务端的未知通道超时逻辑拖成 1s 报错。
 * 见 FEATURES.md 的 rpc-channel-manifest 条目与 docs/features/rpc-channel-manifest/design.md。
 */
import type { Event } from "@zcode/rpc";

export interface IChannelAvailability {
  /** 是否已收到对端 Initialize（含未带清单的旧服务端）。 */
  isInitialized(): boolean;
  /** 对端声明的通道清单；undefined = 对端未声明（旧服务端），按历史行为视为全部可用。 */
  channelNames(): readonly string[] | undefined;
  /** Initialize 到达或清单变化时触发；订阅方据此重新判定可用性。 */
  readonly onDidChange: Event<void>;
}
