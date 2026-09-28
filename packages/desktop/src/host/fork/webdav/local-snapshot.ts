/**
 * 本地快照：把 `setting.json`（白名单字段）与 `provider_config.json` 投影成备份内容，
 * 以及把远端快照应用回本地。
 *
 * 白名单规则见 docs/features/local-mode/design.md 第 6.5 节：默认不同步，
 * 只同步跨机器有意义、且不与本机环境绑定的用户偏好。
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeContentHash } from "./backup-archive.js";

/**
 * 同步白名单。每个字段都必须存在于 `packages/shared/src/protocol.ts` 的 `AppSettings`；
 * 不存在的字段在投影时自动忽略（`pickSyncedSettings` 只挑实际存在的键），
 * 新增字段需同步更新 `docs/features/local-mode/design.md`。
 */
export const FORK_WEBDAV_SYNCED_SETTING_KEYS = [
  "locale",
  "localePreference",
  "shortcutBindings",
  "messageStreamShowReasoning",
  "messageStreamShowTodos",
  "toolGroupingExploreEnabled",
  "toolGroupingTerminalEnabled",
  "toolGroupingChangesEnabled",
  "zcodeInteractionBehavior",
  "askUserQuestionAutoResolutionEnabled",
  "modelIoFullRetentionEnabled",
  "memoryEnabled",
  "nativeSearchEnhancementsEnabled",
  "taskAutoArchiveEnabled",
  "taskAutoArchiveOlderThanDays",
  "embeddedBrowserAllowInsecureCertificates",
  "embeddedBrowserViewportPreference",
  "computerUseComposerEntryHidden",
] as const;

/** 只挑白名单里实际存在的字段；不含白名单外的任何键。 */
export function pickSyncedSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of FORK_WEBDAV_SYNCED_SETTING_KEYS) {
    if (key in settings) {
      picked[key] = settings[key];
    }
  }
  return picked;
}

/** 应用白名单交集：只把远端快照里属于白名单的键写回本地（多余的键丢弃）。 */
export function buildSettingsPatchFromRemote(
  remoteSetting: Record<string, unknown>,
): Record<string, unknown> {
  return pickSyncedSettings(remoteSetting);
}

export interface LocalSnapshot {
  setting: Record<string, unknown>;
  providerConfig: Record<string, unknown>;
  contentHash: string;
}

/** 设置服务端口（真实实现是 ISettingService，只需 get/update）。 */
export interface ForkSettingPort {
  get(): Promise<unknown>;
  update(patch: Record<string, unknown>): Promise<unknown>;
}

export interface LocalSnapshotPort {
  read(): Promise<LocalSnapshot>;
}

export interface RemoteSnapshotApplierPort {
  apply(snapshot: LocalSnapshot): Promise<void>;
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    // 文件缺失或损坏：按空配置参与哈希与上传（设计 6.3 的边界）。
    return {};
  }
}

async function writeJsonObjectAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

export function createLocalSnapshotPort(options: {
  settingService: ForkSettingPort;
  providerConfigPath: string;
}): LocalSnapshotPort {
  return {
    async read() {
      const setting = pickSyncedSettings(
        ((await options.settingService.get()) ?? {}) as Record<string, unknown>,
      );
      const providerConfig = await readJsonObject(options.providerConfigPath);
      return {
        setting,
        providerConfig,
        contentHash: normalizeContentHash({ setting, providerConfig }),
      };
    },
  };
}

export function createRemoteSnapshotApplier(options: {
  settingService: ForkSettingPort;
  providerConfigPath: string;
}): RemoteSnapshotApplierPort {
  return {
    async apply(snapshot) {
      // settings 走 settingService.update，保持单写入者语义；provider_config 原子写文件，
      // 由 provider 仓库既有的 1s 轮询传播到界面（设计 6.3）。
      await options.settingService.update(buildSettingsPatchFromRemote(snapshot.setting));
      await writeJsonObjectAtomic(options.providerConfigPath, snapshot.providerConfig);
    },
  };
}
