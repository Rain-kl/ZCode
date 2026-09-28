/**
 * fork WebDAV 状态文件与凭据读写。
 *
 * 状态文件是 fork 私有文件（不进上游 settings schema，避免给上游校验逻辑加冲突点）：
 * `{configDir}/v2/fork-webdav.json`。密码单独进 credentialService。
 * 见 docs/features/local-mode/design.md 第 3、6.1 节。
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  FORK_WEBDAV_DEFAULT_DIRECTORY,
  FORK_WEBDAV_DEFAULT_RETENTION_LIMIT,
  FORK_WEBDAV_PASSWORD_CREDENTIAL_KEY,
} from "@zcode/shared";

export interface ForkWebdavState {
  url: string | null;
  username: string | null;
  directory: string;
  autoSync: boolean;
  retentionLimit: number;
  /** 最近一次成功上传/恢复后的本地内容哈希（同步基准）。 */
  lastUploadedHash: string | null;
  lastSyncAt: string | null;
  lastRemoteKey: string | null;
  /** 存在未解决的冲突；重启后仍提示用户处理。 */
  pendingConflict: boolean;
  /** 首屏引导被跳过（不再自动弹 WebDAV 登录卡）。 */
  firstRunSkipped: boolean;
  /** 本机标识，写入备份包 manifest.source。 */
  source: string;
}

export function createDefaultForkWebdavState(source = "unknown"): ForkWebdavState {
  return {
    url: null,
    username: null,
    directory: FORK_WEBDAV_DEFAULT_DIRECTORY,
    autoSync: true,
    retentionLimit: FORK_WEBDAV_DEFAULT_RETENTION_LIMIT,
    lastUploadedHash: null,
    lastSyncAt: null,
    lastRemoteKey: null,
    pendingConflict: false,
    firstRunSkipped: false,
    source,
  };
}

function normalizeState(raw: unknown, source: string): ForkWebdavState {
  const defaults = createDefaultForkWebdavState(source);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaults;
  }
  const record = raw as Record<string, unknown>;
  const asString = (value: unknown, fallback: string | null) =>
    typeof value === "string" && value.trim() ? value : fallback;
  const retention = record.retentionLimit;
  return {
    url: asString(record.url, null),
    username: asString(record.username, null),
    directory: asString(record.directory, defaults.directory) ?? defaults.directory,
    autoSync: typeof record.autoSync === "boolean" ? record.autoSync : defaults.autoSync,
    retentionLimit:
      typeof retention === "number" && Number.isFinite(retention) && retention >= 0
        ? Math.floor(retention)
        : defaults.retentionLimit,
    lastUploadedHash: asString(record.lastUploadedHash, null),
    lastSyncAt: asString(record.lastSyncAt, null),
    lastRemoteKey: asString(record.lastRemoteKey, null),
    pendingConflict: record.pendingConflict === true,
    firstRunSkipped: record.firstRunSkipped === true,
    source: asString(record.source, source) ?? source,
  };
}

/** 读状态；文件缺失或损坏时回落到默认值（同步基准丢失会被当作「本地有改动」处理，不会误删远端）。 */
export async function readForkWebdavState(
  filePath: string,
  source = "unknown",
): Promise<ForkWebdavState> {
  try {
    const text = await readFile(filePath, "utf8");
    return normalizeState(JSON.parse(text), source);
  } catch {
    return createDefaultForkWebdavState(source);
  }
}

/** 原子写状态（临时文件 + rename），避免轮询方读到半截 JSON。 */
export async function writeForkWebdavState(
  filePath: string,
  state: ForkWebdavState,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

/** 凭据读写端口（由 host 装配时用真实 credentialService 实现）。 */
export interface ForkWebdavCredentialPort {
  loadPassword(): Promise<string | null>;
  savePassword(password: string): Promise<void>;
  deletePassword(): Promise<void>;
}

/** 用最小接口（load/save/delete 语义）构造凭据端口，保持可单测。 */
export function createForkWebdavCredentialPort(store: {
  load(key: string): Promise<string | null | undefined>;
  save(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}): ForkWebdavCredentialPort {
  return {
    async loadPassword() {
      const value = await store.load(FORK_WEBDAV_PASSWORD_CREDENTIAL_KEY);
      return value ?? null;
    },
    savePassword: (password) => store.save(FORK_WEBDAV_PASSWORD_CREDENTIAL_KEY, password),
    deletePassword: () => store.delete(FORK_WEBDAV_PASSWORD_CREDENTIAL_KEY),
  };
}
