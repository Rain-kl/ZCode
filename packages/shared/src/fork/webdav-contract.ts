/**
 * 本地模式第②期：WebDAV 备份恢复的跨包契约。
 *
 * 类型放 `@zcode/shared` 是因为三处都要用：host 侧实现（packages/desktop）、
 * 服务访问层（packages/services 的 IServiceAccessor）与渲染层客户端
 * （packages/client 的 RemoteServiceAccess）。通道名定义在这里，
 * 不新增上游 channels 常量，避免给上游文件增加冲突点。
 *
 * 见 `FEATURES.md` 的 local-mode 条目与 `docs/features/local-mode/design.md` 第 6 节。
 */

/** 服务通道名（host 注册与渲染层绑定共用）。 */
export const FORK_WEBDAV_CHANNEL = "fork-webdav";

/** WebDAV 密码在 credentialService 里的键。 */
export const FORK_WEBDAV_PASSWORD_CREDENTIAL_KEY = "fork:webdav:password";

/** 状态广播通道（host → 渲染层，走既有 broadcastService）。 */
export const FORK_WEBDAV_STATUS_BROADCAST_CHANNEL = "fork:webdav-status";

/** 远端备份包文件名前缀与匹配规则：`zcode-YYYYMMDD-HHmmss.zip`。 */
export const FORK_WEBDAV_BACKUP_FILE_PREFIX = "zcode-";
export const FORK_WEBDAV_BACKUP_FILE_PATTERN = /^zcode-\d{8}-\d{6}(?:-\d+)?\.zip$/;

/** 备份包内文件名。 */
export const FORK_WEBDAV_MANIFEST_FILE = "manifest.json";
export const FORK_WEBDAV_SETTING_FILE = "setting.json";
export const FORK_WEBDAV_PROVIDER_CONFIG_FILE = "provider_config.json";

/** 备份包 manifest（zip 内）。 */
export interface ForkWebdavBackupManifest {
  schemaVersion: 1;
  createdAt: string;
  appVersion: string;
  contentHash: string;
  source: string;
}

/** 备份包内容（解包结果）。 */
export interface ForkWebdavBackupContent {
  manifest: ForkWebdavBackupManifest;
  setting: Record<string, unknown>;
  providerConfig: Record<string, unknown>;
}

export interface ForkWebdavCredentials {
  url: string;
  username: string;
  password: string;
  /** 远端目录，形如 `/zcode/`；为空时用默认值。 */
  directory: string;
}

export type ForkWebdavSyncPhase = "idle" | "syncing" | "conflict" | "error";

/** 远端备份包条目（列表用）。
 *
 * 列表来自 PROPFIND，只有文件名/大小/服务端 mtime；`source` 与 `contentHash` 在 zip 内的
 * manifest 里，需要下载该包才能读到，因此是可选字段（备份/恢复后会回填最近一次的值）。
 */
export interface ForkWebdavBackup {
  key: string;
  createdAt: string;
  lastModified?: string | null;
  size: number;
  source?: string;
  contentHash?: string;
}

export interface ForkWebdavStatus {
  configured: boolean;
  url: string | null;
  username: string | null;
  directory: string;
  autoSync: boolean;
  retentionLimit: number;
  lastSyncAt: string | null;
  lastError: string | null;
  phase: ForkWebdavSyncPhase;
  backupCount: number;
  /** 本机标识，写入 manifest.source，便于列表区分来源。 */
  source: string;
  /** 首屏引导是否已被跳过（跳过后不再自动弹出登录卡，可从设置页或状态项重新配置）。 */
  firstRunSkipped: boolean;
}

export interface ForkWebdavTestResult {
  ok: boolean;
  error?: string;
}

export interface ForkWebdavSettingsPatch {
  autoSync?: boolean;
  retentionLimit?: number;
  /** 首屏引导「跳过」写入 true。 */
  firstRunSkipped?: boolean;
}

export type ForkWebdavConflictChoice = "use-remote-latest" | "keep-local";

/** 默认远端目录与保留份数（设计 6.1 / 6.3）。 */
export const FORK_WEBDAV_DEFAULT_DIRECTORY = "/zcode/";
export const FORK_WEBDAV_DEFAULT_RETENTION_LIMIT = 20;
export const FORK_WEBDAV_MIN_RETENTION_LIMIT = 1;
export const FORK_WEBDAV_MAX_RETENTION_LIMIT = 200;
