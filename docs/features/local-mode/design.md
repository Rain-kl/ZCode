# 本地模式：去云账号 + WebDAV 备份恢复（local-mode）

- 状态：设计 v2（2026-09-28）。相对 v1 的改动：远端从「常驻两个 JSON」改为「按时间命名的 zip 备份包」，并新增设置页「同步」管理面。
- 索引：`FEATURES.md` 的 `local-mode` 条目
- 实现文档：`docs/features/local-mode/implementation.md`（实现完成后补）
- 调研与决策依据：`.agents/notes/local-mode/exploration-and-decisions.md`

## 1. 背景与目标

本项目是 ZCode 的 fork，不接入上游云账号体系。本期把「登录 ZCode 账号」这条链路从产品面移除，并给用户一条自管的配置备份通道（WebDAV）：

1. 移除云账号登录体系的所有入口（首屏引导、登录页、手动登录、账号状态展示），并停用后台账号链路（静默会话恢复、token 刷新、账号 provider 下发）。**入口屏蔽，不删除代码**。
2. 移除模型设置里预置的智谱提供商（Z.ai / BigModel 预设卡片与 Coding Plan 系列行），仅保留自定义提供商路径。
3. 移除左下角的「连接使用 / 升级」入口。
4. 首屏登录替换为「使用 WebDAV 登录」（可跳过）；登录后配置同步到远端；**设置 → 基础设置 → 同步**里管理 WebDAV（开启自动同步、云端备份、云端恢复、备份列表的恢复与删除）；已配置时左下角显示「WebDAV 已连接」。远端以**时间命名的 zip 备份包**保存历史，可恢复任意一个节点。

## 2. 非目标

- 不删除上游任何代码；不改变自定义提供商（`provider_config.json`）的既有新增/编辑/删除语义。
- 不改造上游 OAuth 服务、账号 provider 解析、Agent 请求鉴权注入的**实现**（只加开关提前返回）。
- 不做 WebDAV 之外的后端（S3/网盘等）；不做多设备增量合并——每份备份是整份快照，恢复即整份覆盖。
- 不同步凭据与机器态数据（见 6.5）；不做上传前加密（明文 apiKey 是已知取舍，见 12.1）。

## 3. 状态所有者

| 状态                                                                                                                             | 唯一所有者                                         | 存储位置                                              |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| WebDAV 密码                                                                                                                      | `credentialService`                                | `credentials.json`（加密，键 `fork:webdav:password`） |
| 连接元数据（url / username / 远端目录 / 自动同步开关 / 保留份数）+ 同步基准（`lastUploadedHash`、`lastSyncAt`、`lastRemoteKey`） | fork WebDAV 服务（host 进程内实例）                | `{configDir}/v2/fork-webdav.json`                     |
| 同步运行时状态（syncing / pendingConflict / lastError）                                                                          | fork WebDAV 服务（内存）                           | 不持久化                                              |
| `setting.json`                                                                                                                   | `settingService`（既有）                           | `~/.zcode/v2/setting.json`（home 固定）               |
| `provider_config.json`                                                                                                           | provider 个人配置仓库（既有，1s 轮询消费外部写入） | `{configDir}/v2/provider_config.json`                 |
| 首屏、弹窗、设置页等 UI 局部状态                                                                                                 | 渲染层 fork 组件                                   | 不持久化                                              |

**并发模型**：同步引擎作为 host 服务注册（与仓库「UI 经 `IServiceAccessor` 访问服务」的约定一致），并通过 `packages/desktop/src/host/index.ts` 的晚注册点注册（该文件已有 `services.register(IZCodeTaskService, …)` 先例）。每个 host 进程一个实例，但**同一时刻只有一个实例跑同步周期**：周期前获取 `{configDir}/v2/fork-webdav.lock`，锁内重读基准再决策；拿不到锁的实例跳过本周期。不做成 desktop main 单实例的原因：主进程没有面向渲染层的服务通道，需额外改 `channels.ts`、`preload`、`IPlatformService` 三处上游文件。

**为什么用内容哈希而不是 mtime**：`setting.json` 有多个写入进程（desktop main 与每个 window host 各持一个 `settingService`），进程内事件不跨进程；「内容哈希 + 文件轮询」既能检测跨进程写入，也能判断「本地是否自上次同步后被改过」。

## 4. 总体结构

| 位置                                       | 内容                                                                                               | 说明                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `packages/shared/src/fork/flags.ts`        | 集中开关常量（`FORK_LOCAL_MODE` 等）                                                               | 新文件；UI 与 host 共用，避免两处漂移 |
| `packages/ui/src/fork/local-mode/**`       | 首屏 WebDAV 登录卡、设置页「同步」面板、冲突弹窗、左下角状态项、`useForkWebdav` hook、入口屏蔽判定 | 新目录；React 实现                    |
| `packages/desktop/src/host/fork/webdav/**` | WebDAV 客户端、zip 打包/解包、备份与恢复引擎、状态文件读写、服务接口与描述符                       | 新目录；host 侧实现                   |
| 上游接线                                   | 15 个文件，逐处 `FORK(local-mode)` 标记                                                            | 见第 7 节                             |

放置理由：

- 引擎放 `packages/desktop/src/host/fork/webdav/**` 而不是 `packages/services`：读 zip 需要 `yauzl`，desktop 包已依赖 `yauzl`/`yazl`/`undici`；放 services 则要改 `packages/services/package.json` 与 lockfile 两处上游文件。该能力是本机配置备份，本身也是 desktop 专属（web/server 不需要）。
- 不新建 workspace 包：新建包会连带改根 `package.json`、tsconfig 引用、lockfile，冲突面更大。

## 5. 去云账号化

### 5.1 入口屏蔽点（每处仅加条件，逻辑保留）

| 入口                       | 位置                                                                           | 屏蔽方式                                                           |
| -------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 首屏首次引导（要求登录）   | `packages/ui/src/lib/rootStartupGate.ts:43`                                    | `shouldEnableProviderAvailabilityLoginEntryGuard()` 返回 `false`   |
| 登录页渲染                 | `packages/ui/src/Root.tsx:982`                                                 | 开关开启时改渲染 fork 首屏/不渲染 `WelcomeScreen`                  |
| 手动登录入口               | `Root.tsx:870`、`:962`、`:1059`                                                | 开关开启时不注入 `onLogin` 回调                                    |
| 侧栏登录/登出菜单项        | `packages/ui/src/WorkspaceSidebarFooter.tsx:352`                               | 开关开启时不渲染这两个菜单项                                       |
| 会话过期提示               | `Root.tsx:205`、`packages/ui/src/root/useRootOAuthEffects.ts:203`              | 开关开启时不消费过期标记                                           |
| 账号断连提醒               | `useRootOAuthEffects.ts:121`、`root/useAccountConnectionLossNotification.ts`   | 开关开启时不挂载                                                   |
| 用量徽标 + 使用统计/升级项 | `WorkspaceSidebarFooter.tsx:138`（取数）、`:346`（菜单内容）                   | 开关开启时不取数、不渲染                                           |
| 设置页同款 footer          | `WorkspaceSidebarFooter` 组件内部统一判定                                      | 两个挂载点（工作区侧栏 / 设置页）自动生效，不改 `SettingsPage.tsx` |
| 智谱预置卡片               | `settings/model-provider-section/constants.ts:34`（`PRESET_PROVIDER_SPECS`）   | 开关开启时过滤 zai/bigmodel 预设                                   |
| 智谱 Coding Plan 系列行    | 同上 `constants.ts:77`（`CODING_PLAN_PROVIDER_SPECS`）                         | 开关开启时过滤套餐行                                               |
| 套餐深链意图               | `settings/ModelProviderSection.tsx:110`（`resolveCodingPlanIntentProviderId`） | 开关开启时不解析套餐意图                                           |

保留不动：`useModelProviders`、`providerPersonalSave`、`ProviderTemplatePicker`（含「智谱」模板分组）、`ProviderCardSections` 的 baseUrl/apiKey 表单、`provider/config-service.ts` 的自定义提供商写入路径。

### 5.2 后台链路停用点

| 链路                       | 位置                                                                                                         | 停用方式                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| 启动静默恢复会话           | `useRootOAuthEffects.ts:128`（`restoreCachedSessionState`）                                                  | 开关开启时跳过，直接置未登录态          |
| 账号连接丢失监听           | 同文件 `:121`                                                                                                | 不挂载                                  |
| 账号 provider 下发到 Agent | `packages/services/src/zcode-agent/zcodeAgentService.ts:1381`（`syncAccountProviderConfigToClient`）及调用点 | 开关开启时提前返回空交付并记 debug 日志 |
| 账号 provider 刷新         | `packages/services/src/node.ts:1644`（`refreshAccountProviders`）                                            | 开关开启时不触发                        |

未登录状态下账号 provider 集合本就为空，上述停用是为「保证应用不再与云账号后端交互」；OAuth 服务、凭据读写、账号 provider 解析代码全部保留，开关回退即可恢复原行为。

## 6. WebDAV 备份与恢复

### 6.1 远端布局与协议

- 远端根目录可配置，默认 `/zcode/`；不存在时 `MKCOL` 创建。
- 目录内是**备份包**：`zcode-<YYYYMMDD-HHmmss>.zip`（如 `zcode-20260928-143000.zip`）。同名已存在时追加 `-1`、`-2`。
- 每个备份包内的文件：
  - `manifest.json`：`schemaVersion`、`createdAt`、`appVersion`、`contentHash`、`source`（本机标识，用于列表里区分来源）；
  - `setting.json`：仅同步白名单字段（见 6.5）；
  - `provider_config.json`：自定义提供商整份。
- 认证：HTTP Basic（URL + 用户名 + 密码）。客户端基于 undici（沿用仓库既有代理与自定义 CA 处理，对齐 `packages/services/src/providers/api/nodeApiNetwork.ts` 的 transport 形态），zip 用 `yazl` 打包、`yauzl` 解包——两者都是 desktop 包既有依赖，不新增三方依赖。
- 目录列表用 `PROPFIND`（Depth: 1）解析出备份包 key、大小、时间。

### 6.2 内容哈希

`contentHash = sha256(规范化(setting 白名单字段) + 规范化(provider_config.json))`，写进备份包 `manifest.json` 与本地元数据。用途：判断本地自上次同步后是否被改过、上传去重（内容相同的包不重复创建）、恢复后判断是否需要再上传。

### 6.3 同步引擎（状态机）

```text
触发：启动 / 本地变更（防抖 2 分钟）/ 远端列表轮询（60s，仅在自动同步开启时）/ 设置页手动操作
        │
        ▼
  本地快照哈希 L（setting 白名单字段 + provider_config）
        │
        ├─ 自动同步开启 && L != baseline.lastUploadedHash
        │      → 防抖 2 分钟后：上传新备份包（contentHash 去重）→ 按保留份数清理 → baseline 更新
        │
        ├─ 自动同步开启 && 远端存在比 baseline.lastSyncAt 更新的包（其他设备上传）
        │      ├─ L == baseline.lastUploadedHash（本地无改动）→ 自动恢复最新包（静默），状态项提示
        │      └─ L != baseline.lastUploadedHash（本地也改了）→ 冲突：置 pendingConflict，通知渲染层弹窗
        │
        └─ 自动同步关闭 → 不做任何自动上传/恢复；仅维护状态与手动操作（设置页「云端备份 / 云端恢复」）
```

- **周期互斥**：整个周期持有 `fork-webdav.lock`，锁内重读基准再决策。
- **保留份数**：上传成功后，若目录内备份包数量 > `retentionLimit`（默认 20，设置页可改，范围 1–200），按时间从旧到新删除多余包；只删匹配 `zcode-*.zip` 命名的对象。
- **首次配置**：登录时若远端目录为空 → 以本地为准，立即上传第一份备份包；若远端已有包 → 按 6.4 的规则决定拉取/冲突。
- **应用远端**：解包后 `setting.json` 经 `settingService.update(patch)` 写入（只覆盖白名单字段，保持单写入者语义）；`provider_config.json` 原子写文件，靠既有 1s 轮询传播。
- **失败处理**：网络/鉴权失败不阻塞应用启动，写入 `lastError` 并在状态项/设置页展示与重试；连续失败按 30s/60s/120s 退避，退避期间不轮询远端列表。

### 6.4 冲突处理

- 触发条件：本地自上次同步后有改动，且远端存在更新的备份包。
- 弹窗（应用级，挂载在 `Root.tsx`）三个选择：
  - **用远端最新恢复**：把远端最新包应用到本地（应用前自动把当前本地状态备份为新包，避免误操作丢配置）；
  - **以本地为准备份**：立即上传当前本地为新包（保留远端旧包）；
  - **稍后**：保持 `pendingConflict`，不重复弹窗；状态项与设置页显示待处理并能再次打开弹窗。
- 手动恢复（设置页选任意包）不触发冲突流程：恢复是显式动作，确认框内说明「会覆盖本地设置与自定义提供商，且恢复前会自动备份当前本地配置」。

### 6.5 备份范围

**同步**：`provider_config.json`（自定义提供商整份）与 `setting.json` 中的用户偏好白名单。

白名单规则：**默认不同步**，只同步跨机器有意义、且不与本机环境绑定的用户偏好。初始白名单（实现时落在 `packages/desktop/src/host/fork/webdav/syncFields.ts`；每个字段需与 `packages/shared/src/protocol.ts` 的 `AppSettings` 定义逐个核对存在性，不存在的直接剔除，新增字段需在本文件登记）：

`locale`、`localePreference`、`shortcutBindings`、`messageStreamShowReasoning`、`messageStreamShowTodos`、`toolGroupingExploreEnabled`、`toolGroupingTerminalEnabled`、`toolGroupingChangesEnabled`、`zcodeInteractionBehavior`、`askUserQuestionAutoResolutionEnabled`、`modelIoFullRetentionEnabled`、`memoryEnabled`、`nativeSearchEnhancementsEnabled`、`taskAutoArchiveEnabled`、`taskAutoArchiveOlderThanDays`、`embeddedBrowserAllowInsecureCertificates`、`embeddedBrowserViewportPreference`、`computerUseComposerEntryHidden`。

明确排除（本机/网络/账号/运行态绑定）：`dataBaseDir`、`desktopWindowSize`、`keepAwakeWhileRunning`、`closeToTrayOnWindows*`、`desktopChromiumHardwareAccelerationEnabled`、`recentProjects`、`lastWorkspaceSession`、`lastActiveTabIndex`、`httpProxy*`、`providerFamily*`、`receivePreviewUpdates`、`autoDownloadAndInstallUpdates`、`skippedElectronUpdateVersions`、`settingsSyncFirstRunPromptHandled`、`*MigrationInitialized` 等迁移标记。

**不同步**：`credentials.json`（机器派生密钥加密，跨机不可解）、`certs`、`telemetry-state.json`、sessions/数据库/日志/checkpoint、`~/.zcode/cli/config.json` 与 skills/agents/commands/plugins 目录（本期不做）。

已知取舍：备份包内 `provider_config.json` 的 `access.apiKey` 是明文，会原样上传到用户自己的 WebDAV（已确认接受）。

### 6.6 设置页「同步」栏目

位置：**设置 → 基础设置 → 同步**（新增 section，与「常规 / 外观 / 模型提供商」同组）。需要改导航类型、导航定义、渲染分支与两个语言文件（见第 7 节）。

| 区块     | 内容                                                                                                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 连接     | 状态（已连接/未连接/错误）、远端地址与用户名（脱敏展示）、连接测试、重新登录、断开连接（清凭据与基准，不删远端备份）                                                                                |
| 同步配置 | 「开启自动同步」开关（登录成功后默认开启）；「保留备份份数」（数字，默认 20，范围 1–200）                                                                                                           |
| 手动操作 | **云端备份**（立即上传当前配置为新包，成功后提示包名）、**云端恢复**（从列表选择）                                                                                                                  |
| 备份列表 | 每行：时间、大小、文件名；操作：恢复、删除；顶部刷新按钮；空态提示「暂无备份」。来源与 contentHash 在 zip 内的 manifest 里（需下载该包才能读到），列表不逐包下载，仅在备份/恢复后回填最近一次的来源 |
| 冲突提示 | 若存在 `pendingConflict`，显示横幅与「处理冲突」按钮（打开 6.4 的弹窗）                                                                                                                             |

- 恢复流程：选择包 → 确认框（说明覆盖范围 + 恢复前自动备份本地）→ 应用 → 刷新状态与设置视图。
- 删除流程：确认框 → **直接删除远端对象**（不做本地回收站；已与用户确认，保持简单可预期）→ 刷新列表。
- 未配置 WebDAV 时，该栏目显示配置表单（URL / 用户名 / 密码 / 远端目录 / 测试连接 / 登录），与首屏登录卡共用同一组件。

### 6.7 左下角状态项

| 状态         | 展示                | 点开菜单                                                     |
| ------------ | ------------------- | ------------------------------------------------------------ |
| 未配置       | 「WebDAV 未连接」   | 打开同步设置                                                 |
| 已配置且正常 | 「WebDAV 已连接」   | 云端备份 / 云端恢复（打开同步设置）/ 打开同步设置 / 断开连接 |
| 同步中       | 「正在同步…」       | 同上（禁用云端备份）                                         |
| 冲突待处理   | 「WebDAV 有冲突」   | 处理冲突 / 打开同步设置                                      |
| 错误         | 「WebDAV 同步失败」 | 重试 / 打开同步设置                                          |

该状态项复用被隐藏的 footer 位置，与「移除连接使用/升级」是同一处接线。

## 7. 上游接线点与标记清单

| 文件                                                           | 位置                                                       | 改动                                                                                            |
| -------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `packages/ui/src/lib/rootStartupGate.ts`                       | `:43`                                                      | 返回 fork 开关                                                                                  |
| `packages/ui/src/Root.tsx`                                     | `:205`、`:870`、`:962`、`:982`、`:1059` + 冲突弹窗挂载     | 首屏替换、屏蔽手动登录、挂载冲突弹窗                                                            |
| `packages/ui/src/WorkspaceSidebarFooter.tsx`                   | `:138`、`:346`、`:352`                                     | 隐藏用量/升级/登录项，插入 WebDAV 状态项                                                        |
| `packages/shared/src/index.ts`                                 | 公开入口                                                   | 导出 `fork/flags.js`（UI 与 host 共用开关）                                                     |
| `packages/ui/src/lib/settingsNavigation.ts`                    | `SettingsSectionId` 联合类型                               | 新增 `configSync`                                                                               |
| `packages/ui/src/settings/settingsPageConfig.ts`               | `basics` 组                                                | 新增「同步」导航项（icon + i18n key）                                                           |
| `packages/ui/src/i18n/locales/zh-CN.ts`                        | 设置相关 key 区                                            | 同步栏目文案                                                                                    |
| `packages/ui/src/i18n/locales/en-US.ts`                        | 同上                                                       | 同步栏目文案                                                                                    |
| `packages/ui/src/settings/model-provider-section/constants.ts` | `:34`、`:77`                                               | 过滤智谱预设与套餐行                                                                            |
| `packages/ui/src/settings/ModelProviderSection.tsx`            | `:110`                                                     | 禁用套餐深链意图解析                                                                            |
| `packages/ui/src/root/useRootOAuthEffects.ts`                  | `:121`、`:128`、`:203`                                     | 停静默恢复/断连提醒/过期处理                                                                    |
| `packages/ui/src/root/useAccountConnectionLossNotification.ts` | 观察 effect 开头                                           | 账号断连提醒提前返回                                                                            |
| `packages/services/src/accessor.ts`                            | `IServiceAccessor`                                         | 新增可选成员 `forkWebdavService?`                                                               |
| `packages/client/src/remoteServiceAccess.ts`                   | 类字段与构造函数                                           | 绑定新服务（`ProxyChannel.toService`）                                                          |
| `packages/desktop/src/host/index.ts`                           | 晚注册点（`services.register(IZCodeTaskService, …)` 附近） | 注册 fork WebDAV 服务                                                                           |
| `packages/services/src/fork/webdav.ts`                         | 新增文件                                                   | `IForkWebdavService` 服务面 + 描述符（`fork-webdav` 通道，定义在 `@zcode/shared` 的 fork 契约） |
| `packages/services/src/index.ts`                               | 公开入口                                                   | 导出 `IForkWebdavService`                                                                       |
| `packages/services/src/zcode-agent/zcodeAgentService.ts`       | `:1381` 及调用点                                           | 账号 provider 下发提前返回                                                                      |

上游接线合计 17 个文件（第②期新增 `services/src/fork/webdav.ts`、`services/src/index.ts`）；`packages/client` 的 `messageport.ts` 与 `websocket.ts` 是通用装配，无需改动（已核实）。所有接线均为「开关判断 + 提前返回/切换渲染」，落在单个连续块内并标注 `FORK(local-mode)` 与 `FEATURES.md` 条目 id。

## 8. 接口

服务描述符：`ServiceChannels.ForkWebdav = "fork-webdav"`；UI 侧只经此访问：

```ts
interface IForkWebdavService {
  getStatus(): Promise<ForkWebdavStatus>;
  // status: configured / connected / autoSync / retentionLimit / lastSyncAt / backupCount / lastError / pendingConflict
  testConnection(input: ForkWebdavCredentials): Promise<ForkWebdavTestResult>;
  configure(input: ForkWebdavCredentials): Promise<ForkWebdavStatus>; // 保存凭据 + 首次备份或恢复
  disconnect(): Promise<ForkWebdavStatus>; // 清凭据与基准，不删远端包
  updateSettings(patch: { autoSync?: boolean; retentionLimit?: number }): Promise<ForkWebdavStatus>;
  listBackups(): Promise<ForkWebdavBackup[]>; // {key, createdAt, size, source, contentHash}
  backupNow(): Promise<ForkWebdavStatus>; // 云端备份
  restoreBackup(key: string): Promise<ForkWebdavStatus>; // 云端恢复（恢复前自动备份本地）
  deleteBackup(key: string): Promise<void>; // 删除任意备份包
  resolveConflict(choice: "use-remote-latest" | "keep-local"): Promise<ForkWebdavStatus>;
}
```

事件（既有服务事件机制）：`status-changed`、`conflict-detected`。

## 9. 实施分期

每期结束都应可运行、可验收：

1. **入口屏蔽期**：fork 开关、去云账号入口屏蔽与后台链路停用、智谱预置过滤、左下角用量/升级移除（此期左下角暂不显示 WebDAV 状态）。验收场景 7、8。
2. **备份内核期**：WebDAV 客户端、zip 打包/解包、备份与恢复引擎、状态文件、服务注册与访问层接线；用临时脚本驱动验证上传/恢复/冲突判定/清理。验收场景 3、4、6（不含 UI）。
3. **设置页期**：`configSync` 栏目（配置表单、开关、保留份数、云端备份、云端恢复、备份列表的恢复与删除、冲突横幅）。验收场景 9–12。
4. **首屏与状态项期**：首屏 WebDAV 登录卡（可跳过）、冲突弹窗、左下角状态项。验收场景 1、2、5。

## 10. 验收场景

1. 首次启动（未配置且未跳过）出现 WebDAV 首屏，可跳过；跳过后应用可用，左下角显示「WebDAV 未连接」。
2. 首屏登录成功（远端为空）→ 立即生成第一份备份包；左下角显示「WebDAV 已连接」。
3. 修改界面设置或自定义提供商 → 2 分钟内（防抖后）远端出现新的时间命名备份包，去重生效（内容未变不重复上传）。
4. 另一台设备上传了新包 → 本机自动同步开启且本地无改动时，自动恢复最新包并提示；本地有改动时弹冲突弹窗。
5. 冲突弹窗：选「用远端最新恢复」后本地等于远端且本地旧状态已自动备份成新包；选「以本地为准备份」后远端多出一个新包；选「稍后」后状态项显示冲突且不重复弹窗。
6. 远端不可达/鉴权失败 → 应用正常进入与使用，状态项与设置页显示失败并可重试，退避生效。
7. 云账号相关入口全部不出现：首屏登录引导、登录页、手动登录、登出、用量、升级、账号断连提示；后台不再发起账号会话恢复与账号 provider 下发。
8. 模型设置不再出现 Z.ai / BigModel 预设卡片与 Coding Plan 系列行；自定义提供商的新增/编辑/删除/选择模型正常。
9. 设置 → 基础设置 → 同步：可看到连接状态、开关、保留份数、云端备份与云端恢复入口、备份列表（时间/大小/来源）。
10. 「云端备份」立即产生一个新包并出现在列表顶部；「云端恢复」选择任一旧包后本地配置回到该包状态，且恢复前当前状态被自动备份。
11. 删除任一备份包后列表刷新、远端对象消失；恢复该已删除包不再出现在选项中。
12. 修改保留份数 N 后，下一次上传触发清理且只保留最近 N 份（只删 `zcode-*.zip`）。

## 11. 测试与验证策略

- 纯逻辑单测：白名单字段投影、`contentHash` 规范化、备份包命名与解析、冲突判定、保留清理的选择逻辑、`PROPFIND` 响应解析（用固定 XML 样本）。
- zip 往返测试：`yazl` 打包 → `yauzl` 解包 → 内容一致（含空 `provider_config.json`）。
- WebDAV 客户端：本地起的假 WebDAV 服务验证 401 / 404 / MKCOL / 列表 / 上传 / 删除；环境不具备时改为手工验证并如实记录。
- 交互：`pnpm dev:desktop` 手工走完第 10 节场景（必要时用仓库既有 E2E 设施）。
- 每期结束执行 `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check`，并核对 `rg -n "FORK\(" ` 与本文档接线表一致。

## 12. 风险与边界

1. **明文 apiKey 上传**：已确认接受；缓解选项是后续做上传前加密或备份包内字段脱敏。
2. **自动清理误删**：保留份数会删旧包（只匹配 `zcode-*.zip`，删除前记 `info` 日志）；用户把 N 设得过小会丢历史，设置页在输入处提示。
3. **多窗口/多进程**：引擎以「周期锁 + 锁内重读基准」串行化，操作幂等；两个 host 实例不会互相覆盖。
4. **上游漂移**：接线点集中在第 7 节的 15 个文件，其中 i18n 与 settingsNavigation 是上游高频改动文件，冲突时按二开标准的冲突阶梯处理，优先把逻辑迁回 `fork/**`。
5. **首次启动空状态**：跳过且未配置任何提供商时，依赖上游「无可用提供商」的既有表现；实现时实测该空态是否可理解，不可理解则在 fork 首屏加提示（不改上游）。
6. **`provider_config.json` 外部写入**：依赖既有 1s 轮询传播；若上游取消该轮询，fork 侧补一次显式重载（按标记点处理）。
7. **恢复与删除的破坏性**：恢复是整份覆盖，已通过「恢复前自动备份 + 确认框」降低风险，不做逐项合并；删除是**直接删除远端对象**（仅确认框，无本地回收站——已与用户确认）。
