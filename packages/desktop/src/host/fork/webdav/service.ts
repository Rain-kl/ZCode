/**
 * fork WebDAV 备份恢复服务（host 侧装配）。
 *
 * 组装：WebDAV 客户端 + 同步引擎 + 状态文件 + 凭据 + 定时/防抖 + 文件锁。
 * 这里只做 IO 编排与状态机外壳，判定逻辑都在 sync-engine.ts（可单测）。
 * 见 docs/features/local-mode/design.md 第 3、6.3、6.7 节。
 */
import { open, stat, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { Emitter } from "@zcode/rpc";
import type { IForkWebdavService } from "@zcode/services";
import {
  FORK_WEBDAV_DEFAULT_DIRECTORY,
  FORK_WEBDAV_MAX_RETENTION_LIMIT,
  FORK_WEBDAV_MIN_RETENTION_LIMIT,
  type ForkWebdavBackup,
  type ForkWebdavConflictChoice,
  type ForkWebdavSettingsPatch,
  type ForkWebdavStatus,
  type ForkWebdavSyncPhase,
} from "@zcode/shared";
import { createWebdavClient, type WebdavFetch } from "./webdav-client.js";
import {
  createLocalSnapshotPort,
  createRemoteSnapshotApplier,
  type ForkSettingPort,
} from "./local-snapshot.js";
import {
  createForkWebdavCredentialPort,
  createDefaultForkWebdavState,
  readForkWebdavState,
  writeForkWebdavState,
  type ForkWebdavState,
} from "./state-store.js";
import { createSyncEngine, type ForkWebdavRemotePort, type SyncTrigger } from "./sync-engine.js";

/** 轮询周期：远端更新检查 + 本地变更检测。 */
const POLL_INTERVAL_MS = 60_000;
/** 本地变更防抖：变更稳定 2 分钟后才上传（设计 6.3）。 */
const LOCAL_CHANGE_DEBOUNCE_MS = 2 * 60_000;
/** 锁文件陈旧判定：超过该时长视为上次异常退出遗留的锁。 */
const LOCK_STALE_MS = 60_000;

export interface ForkWebdavCredentialStore {
  load(key: string): Promise<string | null | undefined>;
  save(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface CreateForkWebdavServiceOptions {
  settingService: ForkSettingPort;
  credentialStore: ForkWebdavCredentialStore;
  providerConfigPath: string;
  stateFilePath: string;
  lockFilePath: string;
  appVersion: string;
  fetchImpl: WebdavFetch;
  log: (message: string, detail?: Record<string, unknown>) => void;
  source?: string;
  now?: () => Date;
}

export interface ForkWebdavServiceHandle extends IForkWebdavService {
  /** 启动轮询与启动时的一次同步；幂等。 */
  start(): void;
  dispose(): void;
}

function resolveUrlError(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "只支持 http/https 的 WebDAV 地址";
    }
    return null;
  } catch {
    return "WebDAV 地址不是合法 URL";
  }
}

export function createForkWebdavService(
  options: CreateForkWebdavServiceOptions,
): ForkWebdavServiceHandle {
  const clock = { now: options.now ?? (() => new Date()) };
  const source = options.source ?? hostname() ?? "unknown";
  const statusEmitter = new Emitter<ForkWebdavStatus>();

  let state: ForkWebdavState = createDefaultForkWebdavState(source);
  let stateLoaded = false;
  let phase: ForkWebdavSyncPhase = "idle";
  let lastError: string | null = null;
  let backupCount = 0;
  let lastLocalSeenHash: string | null = null;
  let lastLocalChangeAt: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  const credentials = createForkWebdavCredentialPort(options.credentialStore);
  const localSnapshot = createLocalSnapshotPort({
    settingService: options.settingService,
    providerConfigPath: options.providerConfigPath,
  });
  const remoteApplier = createRemoteSnapshotApplier({
    settingService: options.settingService,
    providerConfigPath: options.providerConfigPath,
  });

  async function loadState(): Promise<ForkWebdavState> {
    if (!stateLoaded) {
      state = await readForkWebdavState(options.stateFilePath, source);
      stateLoaded = true;
    }
    return state;
  }

  async function saveState(next: ForkWebdavState): Promise<void> {
    state = next;
    stateLoaded = true;
    await writeForkWebdavState(options.stateFilePath, next);
  }

  /** 文件锁：同一时刻只有一个同步周期在跑（多窗口 / 多进程共用同一 configDir）。 */
  async function runExclusive<T>(run: () => Promise<T>): Promise<{ acquired: boolean; value?: T }> {
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      try {
        handle = await open(options.lockFilePath, "wx");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
        const info = await stat(options.lockFilePath).catch(() => null);
        if (!info || clock.now().getTime() - info.mtimeMs > LOCK_STALE_MS) {
          await unlink(options.lockFilePath).catch(() => undefined);
          handle = await open(options.lockFilePath, "wx");
        } else {
          return { acquired: false };
        }
      }
      const value = await run();
      return { acquired: true, value };
    } finally {
      await handle?.close().catch(() => undefined);
      if (handle) {
        await unlink(options.lockFilePath).catch(() => undefined);
      }
    }
  }

  async function createRemote(): Promise<ForkWebdavRemotePort | null> {
    const current = await loadState();
    if (!current.url || !current.username) {
      return null;
    }
    const password = await credentials.loadPassword();
    if (!password) {
      return null;
    }
    const client = createWebdavClient({
      baseUrl: current.url,
      directory: current.directory || FORK_WEBDAV_DEFAULT_DIRECTORY,
      username: current.username,
      password,
      fetchImpl: options.fetchImpl,
    });
    return {
      listBackups: () => client.listBackups(),
      getObject: (key) => client.getObject(key),
      putObject: (key, body) => client.putObject(key, body),
      deleteObject: (key) => client.deleteObject(key),
    };
  }

  /** 每个周期按当前配置构造引擎：配置变化不需要重建服务。 */
  function createEngineFor(remote: ForkWebdavRemotePort | null) {
    return createSyncEngine({
      remote,
      localSnapshot,
      remoteApplier,
      state: {
        get: () => state,
        set: async (next) => {
          await saveState(next);
        },
      },
      clock,
      appVersion: options.appVersion,
      log: (event, detail) => options.log(`[fork-webdav] ${event}`, detail),
      runExclusive,
    });
  }

  async function buildStatus(): Promise<ForkWebdavStatus> {
    const current = await loadState();
    return {
      configured: Boolean(current.url && current.username),
      url: current.url,
      username: current.username,
      directory: current.directory,
      autoSync: current.autoSync,
      retentionLimit: current.retentionLimit,
      lastSyncAt: current.lastSyncAt,
      lastError,
      phase,
      backupCount,
      source: current.source,
      firstRunSkipped: current.firstRunSkipped,
    };
  }

  async function emitStatus(): Promise<void> {
    if (disposed) {
      return;
    }
    statusEmitter.fire(await buildStatus());
  }

  /** 刷新外壳状态并广播（phase 由持久化的 pendingConflict 与内存 lastError 共同决定）。 */
  async function refreshStatus(): Promise<ForkWebdavStatus> {
    const current = await loadState();
    phase = current.pendingConflict ? "conflict" : lastError ? "error" : "idle";
    await emitStatus();
    return await buildStatus();
  }

  /** 一次周期：解析远端 → 跑引擎 → 记录错误与状态。 */
  async function runCycle(
    trigger: SyncTrigger,
    options2?: { throwOnError?: boolean; allowUpload?: boolean },
  ): Promise<void> {
    const remote = await createRemote();
    if (!remote) {
      if (options2?.throwOnError) {
        throw new Error("WebDAV 未配置");
      }
      return;
    }
    try {
      await createEngineFor(remote).runCycle(trigger, { allowUpload: options2?.allowUpload });
      lastError = null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      options.log("[fork-webdav] 同步失败", { error: lastError, trigger });
      if (options2?.throwOnError) {
        throw error;
      }
    } finally {
      await refreshStatus();
    }
  }

  /** 手动操作：拿到远端 → 执行 → 记录错误并原样抛出。 */
  async function runManual(run: (engine: ReturnType<typeof createEngineFor>) => Promise<void>) {
    const remote = await createRemote();
    if (!remote) {
      throw new Error("WebDAV 未配置");
    }
    phase = "syncing";
    await emitStatus();
    try {
      await run(createEngineFor(remote));
      lastError = null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      options.log("[fork-webdav] 手动操作失败", { error: lastError });
      await refreshStatus();
      throw error;
    }
    return await refreshStatus();
  }

  /** 每 60s：检测本地变更（防抖 2 分钟）并触发远端检查。 */
  async function tick(): Promise<void> {
    if (disposed) {
      return;
    }
    try {
      const current = await loadState();
      if (!current.url || !current.username || !current.autoSync) {
        return;
      }
      const snapshot = await localSnapshot.read();
      const now = clock.now().getTime();
      if (lastLocalSeenHash === null) {
        lastLocalSeenHash = snapshot.contentHash;
      } else if (snapshot.contentHash !== lastLocalSeenHash) {
        lastLocalSeenHash = snapshot.contentHash;
        lastLocalChangeAt = now;
      }
      // 防抖只限制「上传」：本地变更仍在窗口内时照常检测远端更新/冲突（双变立即提示用户）。
      const debounceReady =
        lastLocalChangeAt === null || now - lastLocalChangeAt >= LOCAL_CHANGE_DEBOUNCE_MS;
      await runCycle(debounceReady ? "local-change" : "poll", { allowUpload: debounceReady });
      if (debounceReady) {
        lastLocalChangeAt = null;
      }
    } catch (error) {
      options.log("[fork-webdav] 定时同步异常", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    async getStatus() {
      return await buildStatus();
    },

    async testConnection(input) {
      const urlError = resolveUrlError(input.url);
      if (urlError) {
        return { ok: false, error: urlError };
      }
      try {
        const client = createWebdavClient({
          baseUrl: input.url,
          directory: input.directory || FORK_WEBDAV_DEFAULT_DIRECTORY,
          username: input.username,
          password: input.password,
          fetchImpl: options.fetchImpl,
        });
        await client.testConnection();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    async configure(input) {
      const urlError = resolveUrlError(input.url);
      if (urlError) {
        throw new Error(urlError);
      }
      await credentials.savePassword(input.password);
      const directory = input.directory?.trim() || FORK_WEBDAV_DEFAULT_DIRECTORY;
      await saveState({
        ...(await loadState()),
        url: input.url.trim().replace(/\/+$/, ""),
        username: input.username,
        directory,
      });
      lastError = null;
      phase = "syncing";
      await emitStatus();
      try {
        const client = createWebdavClient({
          baseUrl: input.url,
          directory,
          username: input.username,
          password: input.password,
          fetchImpl: options.fetchImpl,
        });
        // 目录不存在时创建；已被拒绝（无权限）时仍允许后续操作给出具体错误。
        await client.ensureDirectory();
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        await refreshStatus();
        throw error;
      }
      await runCycle("manual", { throwOnError: true });
      return await buildStatus();
    },

    async disconnect() {
      await credentials.deletePassword();
      await saveState({
        ...(await loadState()),
        url: null,
        username: null,
        lastUploadedHash: null,
        lastSyncAt: null,
        lastRemoteKey: null,
        pendingConflict: false,
      });
      lastError = null;
      backupCount = 0;
      return await refreshStatus();
    },

    async updateSettings(patch: ForkWebdavSettingsPatch) {
      const next: ForkWebdavSettingsPatch = { ...patch };
      if (typeof next.retentionLimit === "number") {
        next.retentionLimit = Math.min(
          FORK_WEBDAV_MAX_RETENTION_LIMIT,
          Math.max(FORK_WEBDAV_MIN_RETENTION_LIMIT, Math.floor(next.retentionLimit)),
        );
      }
      await saveState({ ...(await loadState()), ...next });
      return await buildStatus();
    },

    async listBackups() {
      const remote = await createRemote();
      if (!remote) {
        throw new Error("WebDAV 未配置");
      }
      const backups: ForkWebdavBackup[] = await remote.listBackups();
      backupCount = backups.length;
      await emitStatus();
      return backups;
    },

    async backupNow() {
      return (await runManual((engine) => engine.backupNow())) as ForkWebdavStatus;
    },

    async restoreBackup(key) {
      return (await runManual((engine) => engine.restoreBackup(key))) as ForkWebdavStatus;
    },

    async deleteBackup(key) {
      await runManual((engine) => engine.deleteBackup(key));
      backupCount = Math.max(0, backupCount - 1);
      await emitStatus();
    },

    async resolveConflict(choice: ForkWebdavConflictChoice) {
      return (await runManual((engine) => engine.resolveConflict(choice))) as ForkWebdavStatus;
    },

    onStatusChanged: statusEmitter.event,

    start() {
      if (timer || disposed) {
        return;
      }
      void runCycle("startup");
      timer = setInterval(() => {
        void tick();
      }, POLL_INTERVAL_MS);
      // 定时器不应阻止进程退出（host 进程由父进程管理）。
      timer.unref?.();
    },

    dispose() {
      disposed = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      statusEmitter.dispose();
    },
  };
}
