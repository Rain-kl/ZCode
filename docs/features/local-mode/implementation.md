# local-mode 实现文档

- 关联：设计 `docs/features/local-mode/design.md`、索引 `FEATURES.md` 的 `local-mode` 条目
- 状态：四期全部落地（入口屏蔽 / 备份内核 / 设置页栏目 / 首屏与冲突交互）
- 计划：`implementation-plan.md`（第①期）、`implementation-plan-2.md`（第②③期与执行记录）；第④期按设计第 9 节在验证后直接实现，记录见本文「执行记录」

## 1. 新增文件（全部在 `fork/` 目录内，零上游冲突面）

| 位置                                                                                      | 职责                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/fork/flags.ts`                                                       | 本地模式开关与智谱过滤判定（纯函数）                                                                                                                                                                                                |
| `packages/shared/src/fork/webdav-contract.ts`                                             | 通道名/常量/数据契约（状态、凭据、备份条目、设置补丁）                                                                                                                                                                              |
| `packages/services/src/fork/webdav.ts`                                                    | `IForkWebdavService` 服务面 + 描述符（`fork-webdav` 通道，含属性式 `onStatusChanged: Event<T>`）                                                                                                                                    |
| `packages/desktop/src/host/fork/webdav/backup-archive.ts`                                 | zip 打包/解包、`zcode-YYYYMMDD-HHmmss.zip` 命名、稳定序列化哈希、保留清理选择                                                                                                                                                       |
| `.../webdav-client.ts`                                                                    | MKCOL/PROPFIND/GET/PUT/DELETE + Basic Auth，`fetch` 注入复用 host 代理与自定义 CA                                                                                                                                                   |
| `.../state-store.ts`                                                                      | fork 状态文件（原子写、损坏回落默认值）+ 凭据端口                                                                                                                                                                                   |
| `.../local-snapshot.ts`                                                                   | 18 个白名单字段投影、远端快照应用                                                                                                                                                                                                   |
| `.../sync-engine.ts`                                                                      | 四分支状态机、去重、保留清理、恢复前备份、`allowUpload` 防抖门                                                                                                                                                                      |
| `.../service.ts` / `index.ts`                                                             | 装配：远端解析、60s 轮询、2 分钟上传防抖、文件锁（含陈旧锁回收）、状态广播                                                                                                                                                          |
| `packages/ui/src/fork/local-mode/**`                                                      | `useForkWebdav`（服务访问与订阅）、`WebdavConnectionForm`（面板/首屏共用）、`ConfigSyncPanel`（设置栏目）、`FirstRunWebdavScreen`（首屏 + 门禁 hook）、`ForkWebdavConflictDialog` + `conflictDialogBus`、`ForkWebdavStatusMenuItem` |
| `packages/desktop/test/forkWebdav*.test.ts`、`packages/shared/test/forkLocalMode.test.ts` | 内核单测（zip 往返、假 WebDAV 服务端、状态机全分支、保留清理、锁、白名单投影、开关过滤）                                                                                                                                            |

## 2. 上游接线点（全部带 `FORK(local-mode)` 标记，共 21 个文件、43 处）

| 文件                                                                                                                        | 改动                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/index.ts`                                                                                              | 导出 fork 开关与 WebDAV 契约                                                                               |
| `packages/services/src/index.ts` / `accessor.ts`                                                                            | 导出服务面；`IServiceAccessor` 增加可选 `forkWebdavService`                                                |
| `packages/client/src/remoteServiceAccess.ts`                                                                                | 绑定 `fork-webdav` 通道                                                                                    |
| `packages/desktop/src/host/index.ts`                                                                                        | 晚注册点注册服务并 `start()`（注入 settingService / credentialService / 网络 transport / configDir）       |
| `packages/services/src/zcode-agent/zcodeAgentService.ts`                                                                    | 停账号 provider 下发                                                                                       |
| `packages/ui/src/lib/rootStartupGate.ts`                                                                                    | 关闭云账号登录启动门禁                                                                                     |
| `packages/ui/src/Root.tsx`                                                                                                  | 首屏 WebDAV 门禁分支、屏蔽手动登录与会话过期、挂载冲突弹窗                                                 |
| `packages/ui/src/WorkspaceSidebarFooter.tsx`                                                                                | 隐藏登录/登出；插入 WebDAV 状态项（升级项在 `WorkspaceSidebarFooterUsageSummary.tsx` 内按开关隐藏）        |
| `packages/ui/src/root/useRootOAuthEffects.ts`、`useAccountConnectionLossNotification.ts`                                    | 停静默恢复、JWT 失效广播、断连提醒                                                                         |
| `packages/ui/src/settings/model-provider-section/constants.ts`、`ModelProviderSection.tsx`、`useModelProviderNavigation.ts` | 过滤智谱预置/套餐行、禁用套餐深链、跳过空分组标题                                                          |
| `packages/provider/src/facades.ts`                                                                                          | 模型选择视图（聊天选择器与设置页共用）过滤掉「需要智谱账号」的 provider，初始/生效选择也基于过滤后的注册表 |
| `packages/ui/src/i18n/locales/{zh-CN,en-US}.ts`                                                                             | 同步栏目/首屏/状态项/冲突弹窗文案（各 46 个键）                                                            |
| `packages/ui/src/lib/settingsNavigation.ts`、`settings/settingsPageConfig.ts`、`SettingsPage.tsx`                           | 新增 `configSync` 栏目（section id / 基础设置导航项 / 渲染分支）                                           |

## 3. 数据、状态与接口

- 状态文件：`{configDir}/v2/fork-webdav.json`（url/username/directory/autoSync/retentionLimit/lastUploadedHash/lastSyncAt/lastRemoteKey/pendingConflict/firstRunSkipped/source），原子写、损坏回落默认值。
- 凭据：`credentials.json` 的 `fork:webdav:password`（机器派生密钥加密，不参与同步）。
- 远端：`<目录>/zcode-YYYYMMDD-HHmmss.zip`，包内 `manifest.json`（`schemaVersion/createdAt/appVersion/contentHash/source`）+ `setting.json`（白名单字段）+ `provider_config.json`。
- 同步字段白名单：见设计 6.5（18 个键，`local-snapshot.ts` 落实现）。
- 接口：`IForkWebdavService` = `getStatus / testConnection / configure / disconnect / updateSettings / listBackups / backupNow / restoreBackup / deleteBackup / resolveConflict` + `onStatusChanged: Event<ForkWebdavStatus>`；`listBackups` 只返回文件名/时间/大小（`source`、`contentHash` 在包内 manifest，需下载才能读到，故为可选字段）。
- 同步语义：本地变更上传（内容哈希去重）→ 保留最近 N 份（默认 20，1–200）；远端更新且本地无改动 → 自动恢复；双侧都改 → 冲突（只标记，不覆盖）；恢复前先把当前本地配置备份成新包；周期用 `fork-webdav.lock` 串行化，陈旧锁 60s 后回收。
- 防抖：本地变更后 2 分钟内只检测（远端更新/冲突照常提示），不满足防抖则推迟上传。

## 4. 执行记录（验证证据）

- 单测：`pnpm exec tsx --test packages/desktop/test/forkWebdav*.test.ts packages/shared/test/forkLocalMode.test.ts` → **31 passed**（zip 往返/命名/保留、PROPFIND 解析、假 WebDAV 服务端上传列表下载删除与 401/404、状态机全分支含冲突与 `allowUpload`、白名单投影、状态文件损坏回落、开关过滤）。
- 门禁：`pnpm typecheck` 无错误；`pnpm lint` **70 warnings / 0 errors**（与基线一致，改动过程中新增的 3 条 warning 已修）；`pnpm architecture:check` OK。
- 标记自查：`rg -n "FORK\(local-mode\)"` 命中与第 2 节表格一致。
- 渲染层（dev 应用 + CDP）：首屏无登录页；侧栏无登录/登出/升级而保留使用统计；模型设置无智谱分组标题与预置行、自定义提供商详情正常；「同步」栏目渲染并走 host 服务往返。
- 聊天模型选择器（用户反馈后补齐）：过滤「需要智谱账号」的 provider 后，选择器不再出现 Start Plan / GLM-5.3 / 免费 / Coding Plan 条目，用户自己的提供商与「管理模型」保留。
- 端到端（dev 应用 + 本地假 WebDAV 服务）：测试连接提示「连接正常」；配置后自动上传首份备份；「云端备份」再上传一份并在列表出现；断开连接后表单恢复、远端包保留、凭据删除、状态文件重置；**冲突流程**：注入更新的远端备份 + 本地改开关 → 弹窗出现 → 「以本地为准备份」→ 弹窗关闭且远端新增一个包（未删旧包）。
- 后台账号链路停用（日志对照）：改动前「account provider config 已交付」6 次，改动后 0 次；`host log` 中 host/agent 正常（数百次 RPC 正常返回）。

## 5. 与设计的偏差（均已同步回设计/计划文档）

1. `IForkWebdavService` 放在 `packages/services/src/fork/webdav.ts` 而不是 `packages/shared`：它需要 `Event`（来自 `@zcode/rpc`），shared 不依赖 rpc；数据契约仍在 shared。
2. `lastError` 是内存态（设计如此），由 service 层维护，引擎只记日志并向上抛。
3. footer 的用量/登录屏蔽放在组件内部判定，因此 `SettingsPage.tsx` 不需要改（接线数比原设计少 1 个文件）。
4. 新增 `runCycle` 的 `allowUpload` 门：原设计把「2 分钟防抖」整体挡在同步周期前，会让冲突提示也延迟 2 分钟；现在防抖只推迟上传。
5. 服务事件用属性式 `onStatusChanged: Event<T>`（`service.onStatusChanged(listener)`），与 `IModelSelectionService.onDidChange` 一致；方法式声明在渲染层会抛 `TypeError`。
6. 第①期只过滤了设置页的预置行，漏了聊天模型选择器（它读 host 的模型选择视图，只按 `visibility` 过滤）——现按 `access.type === "zhipu-account"` 在视图层统一过滤；期间试过用 `@zcode/shared/fork` 子路径导入判定函数，但 CLI agent 的 esbuild 只认 tsconfig paths、不认子路径导出，构建直接失败，故改为不跨包导入的本地判定。

## 6. 未验证 / 后续可做

- 未在打包产物（dmg/Windows 安装包）里验证，只在 `pnpm dev:desktop` 下验证；发布流水线会带上这些改动，首次打包验收留待发布时执行。
- 未逐项点击验证：状态项在 conflict/error 两态下的菜单项（「处理冲突…」「重试同步」）连线已实现，仅有未配置态的实测证据。
- 远端包内 `provider_config.json` 的 `apiKey` 仍是明文（设计 12.1 已确认接受）；上传前加密是后续可选项。
- 未做上传前加密、未做增量合并、未同步 MCP/skills/agents（设计第 2 节非目标）。
