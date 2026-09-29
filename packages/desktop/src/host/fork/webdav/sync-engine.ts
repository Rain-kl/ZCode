/**
 * WebDAV 同步引擎：状态机与冲突判定。
 *
 * 只依赖注入端口（远端、本地快照、远端应用器、状态、时钟、锁），因此可被单测完全驱动；
 * 真实的 WebDAV 客户端、文件锁与持久化在 service.ts 装配。
 * 行为规范见 docs/features/local-mode/design.md 第 6.3 / 6.4 节。
 */
import type { ForkWebdavBackup, ForkWebdavConflictChoice } from "@zcode/shared";
import {
  buildBackupKey,
  buildBackupZip,
  normalizeContentHash,
  readBackupZip,
  selectKeysToPrune,
  sortBackupEntriesDesc,
} from "./backup-archive.js";
import type { ForkWebdavState } from "./state-store.js";
import type {
  SyncSnapshot,
  SyncSnapshotPort,
  SyncSnapshotApplierPort,
} from "./snapshot-port.js";

export type SyncTrigger = "startup" | "poll" | "local-change" | "manual";

export interface ForkWebdavRemotePort {
  listBackups(): Promise<ForkWebdavBackup[]>;
  getObject(key: string): Promise<Buffer>;
  putObject(key: string, body: Buffer): Promise<void>;
  deleteObject(key: string): Promise<void>;
}

export interface SyncEngineDeps {
  /** 未配置时为 null：引擎只维护状态，不做任何远端调用。 */
  remote: ForkWebdavRemotePort | null;
  localSnapshot: SyncSnapshotPort;
  remoteApplier: SyncSnapshotApplierPort;
  state: {
    get(): ForkWebdavState;
    set(next: ForkWebdavState): Promise<void>;
  };
  clock: { now(): Date };
  appVersion: string;
  log: (event: string, detail?: Record<string, unknown>) => void;
  /** 周期互斥：内部实现拿不到锁时返回 false，引擎跳过本周期。 */
  runExclusive: <T>(run: () => Promise<T>) => Promise<{ acquired: boolean; value?: T }>;
}

export interface SyncEngine {
  /**
   * 一次同步周期。
   * `allowUpload: false` 用于「本地变更仍在防抖窗口内」：仍然检测远端更新与冲突（双变时立刻提示用户），
   * 只是暂不上传，等变更稳定后再传。
   */
  runCycle(trigger: SyncTrigger, options?: { allowUpload?: boolean }): Promise<void>;
  backupNow(): Promise<void>;
  restoreBackup(key: string): Promise<void>;
  deleteBackup(key: string): Promise<void>;
  resolveConflict(choice: ForkWebdavConflictChoice): Promise<void>;
}

/** 远端是否比本机上次同步更新（缺时间字段时按 key 兜底排序后取最新包判断）。 */
export function isRemoteNewerThanLocalSync(
  newest: ForkWebdavBackup | null,
  lastSyncAt: string | null,
): boolean {
  if (!newest) {
    return false;
  }
  if (!lastSyncAt) {
    // 本机从未同步过：远端已有备份，视为「远端有新内容」。
    return true;
  }
  const newestTime = Date.parse(newest.createdAt || newest.lastModified || "");
  const lastSyncTime = Date.parse(lastSyncAt);
  if (!Number.isFinite(newestTime) || !Number.isFinite(lastSyncTime)) {
    return true;
  }
  return newestTime > lastSyncTime;
}

export function selectNewestBackup(backups: readonly ForkWebdavBackup[]): ForkWebdavBackup | null {
  return sortBackupEntriesDesc(backups.map((entry) => ({ ...entry, ...entry })))[0] ?? null;
}

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  async function patchState(patch: Partial<ForkWebdavState>): Promise<ForkWebdavState> {
    const next = { ...deps.state.get(), ...patch };
    await deps.state.set(next);
    return next;
  }

  async function uploadLocalSnapshot(options: { reason: SyncTrigger | "auto-before-restore" }) {
    const remote = deps.remote;
    if (!remote) {
      return null;
    }
    const snapshot = await deps.localSnapshot.read();
    const state = deps.state.get();
    const existing = await remote.listBackups();
    const key = buildBackupKey(
      deps.clock.now(),
      existing.map((entry) => entry.key),
    );
    const now = deps.clock.now().toISOString();
    const zip = await buildBackupZip({
      manifest: {
        schemaVersion: 1,
        createdAt: now,
        appVersion: deps.appVersion,
        contentHash: snapshot.contentHash,
        source: state.source,
      },
      files: snapshot.files,
    });
    await remote.putObject(key, zip);
    deps.log("uploaded", { key, reason: options.reason, contentHash: snapshot.contentHash });

    const pruneTargets = selectKeysToPrune(
      [...existing, { key, lastModified: now }],
      state.retentionLimit,
    );
    for (const pruneKey of pruneTargets) {
      try {
        await remote.deleteObject(pruneKey);
        deps.log("pruned", { key: pruneKey });
      } catch (error) {
        // 清理失败不影响本次备份结果，下次同步会再试。
        deps.log("prune-failed", { key: pruneKey, error: String(error) });
      }
    }

    await patchState({
      lastUploadedHash: snapshot.contentHash,
      lastSyncAt: now,
      lastRemoteKey: key,
      pendingConflict: false,
    });
    return key;
  }

  async function applyRemoteBackup(key: string) {
    const remote = deps.remote;
    if (!remote) {
      return;
    }
    const zip = await remote.getObject(key);
    const content = await readBackupZip(zip);
    const snapshot: SyncSnapshot = {
      files: content.files,
      contentHash:
        typeof content.manifest.contentHash === "string" && content.manifest.contentHash
          ? content.manifest.contentHash
          : normalizeContentHash({ files: content.files }),
    };
    await deps.remoteApplier.apply(snapshot);
    await patchState({
      lastUploadedHash: snapshot.contentHash,
      lastSyncAt: deps.clock.now().toISOString(),
      lastRemoteKey: key,
      pendingConflict: false,
    });
    deps.log("restored", { key, contentHash: snapshot.contentHash });
  }

  async function runCycleInternal(
    trigger: SyncTrigger,
    options?: { allowUpload?: boolean },
  ): Promise<void> {
    const remote = deps.remote;
    if (!remote) {
      return;
    }
    const state = deps.state.get();
    if (!state.autoSync) {
      return;
    }
    const snapshot = await deps.localSnapshot.read();
    const localChanged =
      state.lastUploadedHash === null || snapshot.contentHash !== state.lastUploadedHash;

    // 四个分支对应设计 6.3：无变化 / 仅本地变 → 上传 / 仅远端变 → 恢复 / 双变 → 冲突。
    // 必须先看远端再决定，否则「本地变了」会直接上传，冲突分支永远不可达。
    const backups = await remote.listBackups();
    const newest = selectNewestBackup(backups);
    const remoteNewer =
      newest !== null &&
      newest.key !== state.lastRemoteKey &&
      isRemoteNewerThanLocalSync(newest, state.lastSyncAt);

    if (localChanged && remoteNewer) {
      // 双侧都有改动：只标记冲突，不覆盖任何一侧（设计 6.4）。
      await patchState({ pendingConflict: true });
      deps.log("conflict", { localHash: snapshot.contentHash, remoteKey: newest.key });
      return;
    }
    if (localChanged) {
      if (options?.allowUpload === false) {
        deps.log("upload-deferred", { trigger });
        return;
      }
      await uploadLocalSnapshot({ reason: trigger });
      return;
    }
    if (remoteNewer) {
      await applyRemoteBackup(newest.key);
    }
  }

  async function runExclusive(trigger: SyncTrigger, run: () => Promise<void>): Promise<void> {
    const result = await deps.runExclusive(run);
    if (!result.acquired) {
      deps.log("cycle-skipped-locked", { trigger });
      return;
    }
  }

  // 错误只记日志并向上抛：lastError 是运行时状态（不落盘），由 service 层捕获后写入内存状态。
  async function guard(run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.log("cycle-failed", { error: message });
      throw error;
    }
  }

  return {
    async runCycle(trigger, options) {
      await runExclusive(trigger, () => guard(() => runCycleInternal(trigger, options)));
    },

    async backupNow() {
      await runExclusive("manual", () =>
        guard(async () => {
          await uploadLocalSnapshot({ reason: "manual" });
        }),
      );
    },

    async restoreBackup(key) {
      await runExclusive("manual", () =>
        guard(async () => {
          // 恢复是整份覆盖：先把当前本地状态备份成新包，误点恢复也能找回（设计 6.4）。
          await uploadLocalSnapshot({ reason: "auto-before-restore" });
          await applyRemoteBackup(key);
        }),
      );
    },

    async deleteBackup(key) {
      const remote = deps.remote;
      if (!remote) {
        throw new Error("WebDAV 未配置");
      }
      await runExclusive("manual", () =>
        guard(async () => {
          await remote.deleteObject(key);
          if (deps.state.get().lastRemoteKey === key) {
            await patchState({ lastRemoteKey: null });
          }
          deps.log("deleted", { key });
        }),
      );
    },

    async resolveConflict(choice) {
      if (choice === "keep-local") {
        await this.backupNow();
        return;
      }
      const remote = deps.remote;
      if (!remote) {
        throw new Error("WebDAV 未配置");
      }
      const newest = selectNewestBackup(await remote.listBackups());
      if (!newest) {
        await patchState({ pendingConflict: false });
        return;
      }
      await this.restoreBackup(newest.key);
    },
  };
}
