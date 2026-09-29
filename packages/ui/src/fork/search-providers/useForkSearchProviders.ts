/**
 * 设置 → 基础设置 → 搜索 的数据入口。
 *
 * 只经 `IServiceAccessor.forkSearchProvidersService` 访问 host（web/远端环境没有该服务时为 undefined），
 * 错误统一落到 `error` 由面板展示。
 *
 * FORK(rpc-channel-manifest): 能力缺席表现为「成员为 undefined」而不是「一次超时错误」；
 * 对端通道清单到达前不发任何探测调用，见 FEATURES.md 的 rpc-channel-manifest 条目。
 * 见 docs/features/search-providers/design.md §7 与 §10.3。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ForkSearchProviderChannel, ForkSearchProvidersFile } from "@zcode/shared";
import { useServices } from "@/hooks/useServices.js";
import { useChannelServiceUsable } from "@/hooks/useChannelAvailabilityReady.js";

export interface ForkSearchProvidersController {
  /** host 未提供该服务（web / 远端环境）时为 false。 */
  available: boolean;
  channels: ForkSearchProviderChannel[];
  /** 正在执行一次操作（按钮禁用用）。 */
  busy: boolean;
  /** 最近一次操作失败的原因（面板内展示）。 */
  error: string | null;
  refresh(): Promise<void>;
  add(input: { kind: "tavily"; label: string; apiKey: string }): Promise<void>;
  update(id: string, patch: { label?: string; apiKey?: string; enabled?: boolean }): Promise<void>;
  remove(id: string): Promise<void>;
  reorder(ids: string[]): Promise<void>;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useForkSearchProviders(): ForkSearchProvidersController {
  const services = useServices();
  const service = services.forkSearchProvidersService;
  const [channels, setChannels] = useState<ForkSearchProviderChannel[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // FORK(rpc-channel-manifest): usable 门住所有调用（清单已到且含该通道）
  const usable = useChannelServiceUsable(service);

  const run = useCallback(async (action: () => Promise<ForkSearchProvidersFile>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      setChannels(result.channels);
    } catch (caught) {
      setError(toMessage(caught));
      throw caught;
    } finally {
      setBusy(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!usable || !service) {
      return;
    }
    await run(async () => {
      return await service.list();
    });
  }, [run, service, usable]);

  useEffect(() => {
    if (!usable || !service) {
      return;
    }
    let disposed = false;
    void (async () => {
      try {
        const file = await service.list();
        if (!disposed) {
          setChannels(file.channels);
        }
      } catch (caught) {
        if (!disposed) {
          setError(toMessage(caught));
        }
      }
    })();
    return () => {
      disposed = true;
    };
  }, [service, usable]);

  return useMemo<ForkSearchProvidersController>(
    () => ({
      // available 只描述「清单是否提供该通道」；发调用由 usable 另行门控。
      available: Boolean(service),
      channels,
      busy,
      error,
      refresh,
      async add(input) {
        if (!usable || !service) {
          return;
        }
        await run(async () => {
          return await service.addChannel(input);
        });
      },
      async update(id, patch) {
        if (!usable || !service) {
          return;
        }
        await run(async () => {
          return await service.updateChannel(id, patch);
        });
      },
      async remove(id) {
        if (!usable || !service) {
          return;
        }
        await run(async () => {
          return await service.removeChannel(id);
        });
      },
      async reorder(ids) {
        if (!usable || !service) {
          return;
        }
        await run(async () => {
          return await service.reorder(ids);
        });
      },
    }),
    [busy, channels, error, refresh, run, service, usable],
  );
}
