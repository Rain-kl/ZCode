# local-mode 调研与决策记录

日期：2026-09-28
关联：`docs/features/local-mode/design.md`、`FEATURES.md` 的 `local-mode` 条目

## 1. 关键调研结论（含证据位置）

- **首屏登录不是登录页自己触发的**：`packages/ui/src/lib/rootStartupGate.ts:43` 的 `shouldEnableProviderAvailabilityLoginEntryGuard()` 是常量，`root/useProviderAvailabilityLoginEntryGuard.ts:57` 依据 `!providerFamilyDomain || (!user && !hasUsableProvider)` 决定是否打开 `WelcomeScreen`。这是「首次打开要求登录」的唯一开关点。
- **Onboarding 与登录无关**：`packages/ui/src/onboarding/**` 是职业/偏好向导，触发条件是 `onboarding-record.shouldOnboard`，不要求账号；其记录文件的 identity 依赖 OAuth 用户（`services/src/onboarding/onboardingRecordService.ts:25`，identity 注入在 `services/src/node.ts:1442`）。
- **云账号链路跨进程**：渲染层 `root/useRootOAuthEffects.ts`（静默恢复 `:128`、过期 `:203`、断连提醒 `:121`）；host 侧 `services/src/zcode-agent/zcodeAgentService.ts:1381` 把账号 provider 配置下发给 Agent，`services/src/node.ts:1644` 刷新账号 provider。
- **智谱预置是 UI 常量而非注册表派生**：`packages/ui/src/settings/model-provider-section/constants.ts:34`（`PRESET_PROVIDER_SPECS`）与 `:77`（`CODING_PLAN_PROVIDER_SPECS`），由 `ModelProviderSection.tsx:608` 与 `useModelProviderNavigation.ts` 消费；模板分组在 `ProviderTemplatePicker.tsx:37`，与账号无关，保留。
- **左下角是同一个共享组件**：`packages/ui/src/WorkspaceSidebarFooter.tsx`（用量数据 `:138`、菜单内容 `:346`、登录项 `:352`），在 `WorkspaceSidebar.tsx:1645` 与 `SettingsPage.tsx:1533` 两处挂载。
- **`setting.json` 有单一写入实现但多进程实例**：`services/src/setting/settingService.ts`（路径 home 固定 `:55`，写入队列 `:242`，事件 `observableSettingService.ts:20`）；desktop main 一个实例、每个 window host 一个实例，进程内事件不跨进程，且没有文件监听。
- **`provider_config.json` 自带头部轮询**：`packages/provider-node/src/personal-provider-config-repository.ts:69` 每 1s 轮询文件并派发 `updated`/`poll-changed`，因此外部写入可被既有链路消费；其中 `access.apiKey` 为明文（`packages/provider/src/config/provider-data-schema.ts:30`）。
- **凭据不可跨机同步**：`services/src/credential/providers/credentialCipherProvider.ts:20` 的密钥在无 `ZCODE_CREDENTIAL_SECRET` 时由 `platform + homedir + username` 派生，`credentials.json` 复制到其他机器无法解密。
- **仓库内没有任何 WebDAV/S3 客户端**（全仓库检索 `webdav|nextcloud|owncloud` 无命中），需要自建；可复用的 HTTP 形态是 `services/src/providers/api/nodeApiNetwork.ts`（undici + 代理 + 自定义 CA）。

## 2. 决策与理由

| 决策                                | 选择                                                                                                                       | 拒绝的替代方案与理由                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fork 代码位置                       | 新增 `packages/shared/src/fork/flags.ts`、`packages/ui/src/fork/local-mode/**`、`packages/desktop/src/host/fork/webdav/**` | 新建独立 workspace 包会连带改动根 `package.json`、tsconfig 引用、lockfile 三处上游文件，冲突面更大；散点改上游文件违反二开标准                             |
| host 侧引擎放 desktop 而非 services | `packages/desktop/src/host/fork/webdav/**`，在 `desktop/src/host/index.ts` 的晚注册点注册                                  | 放 services 需要读 zip（`yauzl`），必须改 `packages/services/package.json` + lockfile；desktop 已依赖 `yauzl`/`yazl`/`undici`，且该能力本就是 desktop 专属 |
| 远端模型                            | 按时间命名的 zip 备份包（`zcode-<YYYYMMDD-HHmmss>.zip`），可列出/恢复任意节点/删除任意包，保留最近 N 份（默认 20）         | 常驻两个 JSON 的「当前态同步」没有历史节点、无法回滚                                                                                                       |
| fork 状态存放                       | 独立文件 `{configDir}/v2/fork-webdav.json`                                                                                 | 写进 `setting.json` 需要改上游严格 schema（`shared/src/validationAppSettings.ts:420`），等于给每次同步增加冲突点                                           |
| 并发模型                            | 引擎作为 host 服务注册，周期锁 + 锁内重读基准串行化                                                                        | desktop main 单实例需要改 `channels.ts`/`preload`/`IPlatformService` 三处上游文件；不做串行化则多窗口会互相覆盖                                            |
| 变更检测                            | 内容哈希 + 本地写入轮询 + 60s 远端列表轮询 + 本地变更 2 分钟防抖上传                                                       | 仅用进程内事件（漏跨进程写）；仅用 mtime（不可靠且无法判断「本地是否被改过」）                                                                             |
| 冲突处理                            | 弹窗询问（用远端最新恢复 / 以本地为准备份 / 稍后）                                                                         | 自动以某侧为准会静默丢改动（用户明确选择了询问）                                                                                                           |
| 应用远端配置的方式                  | settings 走 `settingService.update`（只覆盖白名单字段）；providers 原子写文件后靠既有 1s 轮询传播                          | 直接改 provider 内部 API 会绕过单写入者语义并扩大上游接线面                                                                                                |
| 恢复的安全性                        | 恢复前自动把当前本地配置备份为新包 + 确认框                                                                                | 直接覆盖会让误点恢复不可逆                                                                                                                                 |
| 删除策略                            | 直接删除远端备份包（仅确认框）                                                                                             | 本地回收站/软删除会增加状态与清理负担；用户明确选择直接删除                                                                                                |

## 3. 踩坑与注意事项（实现时复用）

- 上游对 `setting.json` 的读写在 `get()` 里会做一次迁移持久化，且不触发 `onDidUpdate`；同步引擎因此不能只依赖事件。
- `provider_config.json` 的写入必须走原子写（仓库既有 `atomicWriteText` 模式），否则轮询方可能读到半截 JSON。
- 隐藏用量/升级项时不要改 `WorkspaceSidebarFooterUsageSummaryContent`（力渲染、`forceMount`），应在 footer 组件层与两个挂载点判断，否则设置页 footer 会漏。
- 过滤智谱预置后，`Detail.tsx:398` 在找不到 provider 时会渲染占位；预置与套餐行需一起过滤，并同时禁用套餐深链意图（`ModelProviderSection.tsx:110`），否则会出现空选中。
