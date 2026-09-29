/**
 * 网络搜索渠道（fork）宿主服务面。
 *
 * 桌面 host 的 `IForkSearchProvidersService` 独占写入，渲染层经 RPC 调用；
 * 服务面只描述渠道文件，不描述服务端渠道（服务端渠道由 UI 结合活动模型动态推导）。
 * 见 FEATURES.md 的 search-providers 条目与 docs/features/search-providers/design.md §10.3。
 */
import type { ForkSearchProvidersFile } from "@zcode/shared";
import { FORK_SEARCH_PROVIDERS_CHANNEL } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IForkSearchProvidersService {
  list(): Promise<ForkSearchProvidersFile>;
  addChannel(input: {
    kind: "tavily";
    label: string;
    apiKey: string;
  }): Promise<ForkSearchProvidersFile>;
  updateChannel(
    id: string,
    patch: { label?: string; apiKey?: string; enabled?: boolean },
  ): Promise<ForkSearchProvidersFile>;
  removeChannel(id: string): Promise<ForkSearchProvidersFile>;
  reorder(ids: string[]): Promise<ForkSearchProvidersFile>;
}

export const IForkSearchProvidersService = createServiceDescriptor<IForkSearchProvidersService>(
  FORK_SEARCH_PROVIDERS_CHANNEL,
);
