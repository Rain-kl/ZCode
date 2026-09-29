/**
 * WebDAV 同步范围清单：**备份包里有什么，只由这一处决定**。
 *
 * 新增一个要同步的资源 = 在这里加一行（同类 IO 形状），不需要改契约、打包、解包、
 * 哈希、同步引擎或服务装配。IO 形状只有下面四种，都是"怎么读写"而不管"是什么业务"：
 * - `setting-service`：走 settingService 的白名单字段（保持单写入者语义）
 * - `file-json`：整份 JSON 文件
 * - `file-json-whitelist`：JSON 文件里的白名单字段
 * - `directory`：目录下的文件（可选一个状态文件），按扩展名与文件名主干挑选
 *
 * 缺口按语义处理：快照里**完全没有**某个资源的条目时，恢复时保持本地不动——
 * 旧版本备份包不该把用户后来新增的配置清掉。这条规则在清单层统一实现。
 *
 * 见 FEATURES.md 的 local-mode 条目与 docs/features/local-mode/design.md 第 6.5 节。
 */
import {
  FORK_IDENTITY_PRESET_PROFILE_EXTENSION,
  FORK_IDENTITY_PRESET_PROFILES_DIRNAME,
  FORK_IDENTITY_PRESET_ROOT_NAME,
  isValidForkIdentityPresetId,
} from "@zcode/shared";

/** 系统指令配置的归档前缀与本地相对路径；目录名取自 identity-preset 的契约常量，不写字面量。 */
const FORK_IDENTITY_PRESET_ROOT = FORK_IDENTITY_PRESET_ROOT_NAME;
const FORK_IDENTITY_PRESET_PROFILES_DIR = `${FORK_IDENTITY_PRESET_ROOT}/${FORK_IDENTITY_PRESET_PROFILES_DIRNAME}`;

/** 本地根：app 配置目录（`~/.zcode/v2`）或 storage root（`~/.zcode`）。 */
export type ForkSyncBase = "appConfigDir" | "storageRoot";

export type ForkSyncSource =
  | { type: "setting-service"; keys: readonly string[] }
  | { type: "file-json"; base: ForkSyncBase; path: string }
  | { type: "file-json-whitelist"; base: ForkSyncBase; path: string; keys: readonly string[] }
  | {
      type: "directory";
      base: ForkSyncBase;
      path: string;
      /** 目录内的状态文件（单份 JSON），会同步到 `<archiveName>/<stateFileName>`。 */
      stateFileName?: string;
      /** 只同步这个扩展名的文件。 */
      fileExtension?: string;
      /** 去掉扩展名的文件名主干必须通过校验，否则不入包也不落盘。 */
      isValidStem?: (stem: string) => boolean;
    };

export interface ForkSyncEntry {
  /** zip 内条目名（JSON 类）或目录前缀（directory 类）。 */
  archiveName: string;
  source: ForkSyncSource;
}

/** 同步白名单。每个字段都必须存在于 `packages/shared/src/protocol.ts` 的 `AppSettings`。 */
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

/** 清单：同步范围就是这四项。加资源请只改这里。 */
export const FORK_WEBDAV_SYNC_MANIFEST: readonly ForkSyncEntry[] = [
  {
    archiveName: "setting.json",
    source: { type: "setting-service", keys: FORK_WEBDAV_SYNCED_SETTING_KEYS },
  },
  {
    archiveName: "provider_config.json",
    source: { type: "file-json", base: "appConfigDir", path: "provider_config.json" },
  },
  {
    // 系统指令配置的状态文件与配置目录分开声明：`directory` 类型只处理一层目录，
    // 用一个 entry 同时表达"单份 JSON + 一层子目录"会漏掉子目录里的文件。
    archiveName: `${FORK_IDENTITY_PRESET_ROOT}/active.json`,
    source: {
      type: "file-json",
      base: "storageRoot",
      path: `${FORK_IDENTITY_PRESET_ROOT}/active.json`,
    },
  },
  {
    // 用户提示词正文：`presets/profiles/<id>.md`
    archiveName: FORK_IDENTITY_PRESET_PROFILES_DIR,
    source: {
      type: "directory",
      base: "storageRoot",
      path: FORK_IDENTITY_PRESET_PROFILES_DIR,
      fileExtension: FORK_IDENTITY_PRESET_PROFILE_EXTENSION,
      isValidStem: isValidForkIdentityPresetId,
    },
  },
];
