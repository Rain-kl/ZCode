/**
 * 本地模式（fork）WebDAV 备份恢复服务面。
 *
 * 数据契约在 `@zcode/shared` 的 `fork/webdav-contract.js`；这里加 `Event` 成员，
 * 因为 `Event` 来自 `@zcode/rpc`，只有 services 层依赖它（与 fileWatcher 等既有服务同构）。
 * 见 FEATURES.md 的 local-mode 条目与 docs/features/local-mode/design.md 第 6、8 节。
 */
import type { Event } from "@zcode/rpc";
import {
  FORK_WEBDAV_CHANNEL,
  type ForkWebdavBackup,
  type ForkWebdavConflictChoice,
  type ForkWebdavCredentials,
  type ForkWebdavSettingsPatch,
  type ForkWebdavStatus,
  type ForkWebdavTestResult,
} from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IForkWebdavService {
  getStatus(): Promise<ForkWebdavStatus>;
  testConnection(input: ForkWebdavCredentials): Promise<ForkWebdavTestResult>;
  configure(input: ForkWebdavCredentials): Promise<ForkWebdavStatus>;
  disconnect(): Promise<ForkWebdavStatus>;
  updateSettings(patch: ForkWebdavSettingsPatch): Promise<ForkWebdavStatus>;
  listBackups(): Promise<ForkWebdavBackup[]>;
  backupNow(): Promise<ForkWebdavStatus>;
  restoreBackup(key: string): Promise<ForkWebdavStatus>;
  deleteBackup(key: string): Promise<void>;
  resolveConflict(choice: ForkWebdavConflictChoice): Promise<ForkWebdavStatus>;
  /** 状态变化订阅（同步中/冲突/错误/连接变化）。属性式 Event：渲染层用 `service.onStatusChanged(listener)`。 */
  onStatusChanged: Event<ForkWebdavStatus>;
}

export const IForkWebdavService = createServiceDescriptor<IForkWebdavService>(FORK_WEBDAV_CHANNEL);
