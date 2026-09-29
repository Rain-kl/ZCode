import type { ModelTextResult } from "@zcode/contracts";

/**
 * 一次搜索请求。字段是各渠道需求的并集，**不是每个渠道都支持全部字段**：
 * 渠道只取自己需要的参数，不认识的字段直接忽略（不报错）——
 * 见 docs/features/search-providers/design.md §8。
 */
export interface SearchChannelRequest {
  query: string;
  allowedDomains?: string[];
  blockedDomains?: string[];
  /** 服务端渠道用：最多发起几次服务端搜索。 */
  maxUses?: number;
  /** Tavily 渠道用：返回多少条结果。 */
  maxResults?: number;
  signal?: AbortSignal;
}

/** 一次渠道失败。三个字段都是「排查这条链为什么绕过了某个渠道」所需的最小信息。 */
export interface SearchChannelFailure {
  channelKind: string;
  channelLabel: string;
  reason: string;
}

export interface SearchChannel {
  kind: string;
  label: string;
  /** 成功返回该渠道的结果；失败必须抛出（不允许返回半成品让路由误判成功）。 */
  search(request: SearchChannelRequest): Promise<ModelTextResult>;
}

export interface SearchChannelOutcome {
  result: ModelTextResult;
  channelKind: string;
  channelLabel: string;
  /** 本次调用中先失败的那些渠道，按尝试顺序。成功降级时非空。 */
  attempts: readonly SearchChannelFailure[];
}
