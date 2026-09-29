/**
 * FORK(rpc-channel-manifest): 按服务端声明的通道清单决定本端是否建代理。
 *
 * 背景：`ProxyChannel.toService` 是惰性的，代理本身永远是真值对象，所以 UI 用
 * `Boolean(service)` 探测能力时永远得到「可用」，真正缺席的能力被伪装成
 * 「一次 1s 超时错误 + 空数据」。服务端在 Initialize 里带上已注册通道清单后，
 * 客户端可以把清单里没有的通道直接置为 undefined。
 *
 * 兼容性：清单未知（旧服务端 / Initialize 尚未到达）时必须保持历史行为（照旧建代理），
 * 否则会把真实服务误判为不可用——那比一次可见的超时报错更糟。
 * 见 FEATURES.md 的 rpc-channel-manifest 条目与 docs/features/rpc-channel-manifest/design.md。
 */

/**
 * 清单未知（undefined）或清单为空时视为可用，其余情况按清单判定。
 *
 * 空清单按「未知」而不是「全部不可用」处理：服务端在通道注册完成前发送 Initialize 会得到空清单，
 * 若把它当真，客户端会把本端全部真实服务显示成「当前环境不支持」——静默失效比一次可见的超时报错更难排查。
 * 非空清单是当前唯一的正常形态，不受此兜底影响。
 */
export function isChannelAvailable(
  channelNames: readonly string[] | undefined,
  channelName: string,
): boolean {
  if (channelNames === undefined || channelNames.length === 0) {
    return true;
  }
  return channelNames.includes(channelName);
}
