/**
 * 设置 → 基础设置 → 同步 的数据入口。
 *
 * 只经 `IServiceAccessor.forkWebdavService` 访问 host（web/远端环境没有该服务时为 undefined），
 * 订阅服务状态事件并向上暴露操作；错误统一落到 `error` 由面板展示。
 *
 * FORK(rpc-channel-manifest): 能力缺席表现为「成员为 undefined」而不是「一次超时错误」；
 * 对端通道清单到达前不发任何探测调用，见 FEATURES.md 的 rpc-channel-manifest 条目。
 * 见 docs/features/local-mode/design.md 第 6.6 节。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ForkWebdavBackup,
  ForkWebdavConflictChoice,
  ForkWebdavCredentials,
  ForkWebdavSettingsPatch,
  ForkWebdavStatus,
  ForkWebdavTestResult,
} from "@zcode/shared";
import { useServices } from "@/hooks/useServices.js";
import { useChannelServiceUsable } from "@/hooks/useChannelAvailabilityReady.js";

export interface ForkWebdavController {
  /** host 未提供该服务（web / 远端环境）时为 false。 */
  available: boolean;
  status: ForkWebdavStatus | null;
  backups: ForkWebdavBackup[];
  /** 正在执行一次用户操作（按钮禁用用）。 */
  busy: boolean;
  /** 最近一次操作失败的原因（面板内展示）。 */
  error: string | null;
  refresh(): Promise<void>;
  testConnection(input: ForkWebdavCredentials): Promise<ForkWebdavTestResult>;
  configure(input: ForkWebdavCredentials): Promise<void>;
  disconnect(): Promise<void>;
  updateSettings(patch: ForkWebdavSettingsPatch): Promise<void>;
  backupNow(): Promise<void>;
  restoreBackup(key: string): Promise<void>;
  deleteBackup(key: string): Promise<void>;
  resolveConflict(choice: ForkWebdavConflictChoice): Promise<void>;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useForkWebdav(): ForkWebdavController {
  const services = useServices();
  const service = services.forkWebdavService;
  const [status, setStatus] = useState<ForkWebdavStatus | null>(null);
  const [backups, setBackups] = useState<ForkWebdavBackup[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // FORK(rpc-channel-manifest): usable 门住所有调用（清单已到且含该通道）；
  // 清单缺席时 service 为 undefined，available 即「当前环境不支持」。
  const usable = useChannelServiceUsable(service);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!usable || !service) {
      return;
    }
    setStatus(await service.getStatus());
  }, [service, usable]);

  const refreshBackups = useCallback(async () => {
    if (!usable || !service) {
      return;
    }
    const current = await service.getStatus();
    if (!current.configured) {
      setBackups([]);
      return;
    }
    setBackups(await service.listBackups());
  }, [service, usable]);

  useEffect(() => {
    if (!usable || !service) {
      return;
    }
    let disposed = false;
    void (async () => {
      try {
        const current = await service.getStatus();
        if (!disposed) {
          setStatus(current);
        }
        if (current.configured) {
          const list = await service.listBackups();
          if (!disposed) {
            setBackups(list);
          }
        }
      } catch (caught) {
        if (!disposed) {
          setError(toMessage(caught));
        }
      }
    })();
    const subscription = service.onStatusChanged((next) => {
      if (!disposed) {
        setStatus(next);
      }
    });
    return () => {
      disposed = true;
      subscription.dispose();
    };
  }, [service, usable]);

  return useMemo<ForkWebdavController>(
    () => ({
      // available 只描述「清单是否提供该通道」；发调用由 usable 另行门控。
      available: Boolean(service),
      status,
      backups,
      busy,
      error,
      async refresh() {
        await run(async () => {
          await refreshStatus();
          await refreshBackups();
        });
      },
      async testConnection(input) {
        if (!usable || !service) {
          return { ok: false, error: "WebDAV 服务不可用" };
        }
        return await service.testConnection(input);
      },
      async configure(input) {
        if (!usable || !service) {
          return;
        }
        await run(async () => {
          setStatus(await service.configure(input));
          await refreshBackups();
        });
      },
      async disconnect() {
        if (!usable || !service) {
          return;
        }
        await run(async () => {
          setStatus(await service.disconnect());
          setBackups([]);
        });
      },
      async updateSettings(patch) {
        if (!usable || !service) {
          return;
        }
        await run(async () => {
          setStatus(await service.updateSettings(patch));
        });
      },
      async backupNow() {
        if (!usable || !service) {
          return;
        }
        await run(async () => {
          setStatus(await service.backupNow());
          await refreshBackups();
        });
      },
      async restoreBackup(key) {
        if (!usable || !service) {
          return;
        }
        await run(async () => {
          setStatus(await service.restoreBackup(key));
          await refreshBackups();
        });
      },
      async deleteBackup(key) {
        if (!usable || !service) {
          return;
        }
        await run(async () => {
          await service.deleteBackup(key);
          await refreshBackups();
        });
      },
      async resolveConflict(choice) {
        if (!usable || !service) {
          return;
        }
        await run(async () => {
          setStatus(await service.resolveConflict(choice));
          await refreshBackups();
        });
      },
    }),
    [backups, busy, error, refreshBackups, refreshStatus, run, service, status, usable],
  );
}
