# 二开功能索引（FEATURES.md）

本文件是本项目（fork）相对上游 `zai-org/ZCode` **产品类**二开改动的唯一索引。规则见 `AGENTS.md` 的「二开标准（Fork）」。

**范围**：只登记面向用户的产品改动——功能、行为、体验、文案。发布流水线、构建脚本、仓库规范、开发工具链、开发者文档等非产品改动不登记（原因写进提交信息），避免本文件变成流水账。

登记要求：每条记录必须写明**需求背景、修改内容、修改文件、上游改动标记、设计文档与实现文档**。格式：

- **大功能需求**：独立 `##` 标题，格式 `## <功能名> (<feature-id>)`，详细记录，使用 Superpowers 工作流开发（`superpowers:brainstorming` → `superpowers:writing-plans` → `superpowers:executing-plans` 或 `superpowers:test-driven-development` → `superpowers:verification-before-completion`）。
- **功能增强**：以 `###` 子标题放在对应大功能标题下方。
- **产品细节/文案等小改动**：写在文末 `## 其他更新`，一行一条（日期 + 简述 + 文件）。

代码里的 `FORK(<feature-id>)` 标记按 id 检索对应条目；「其他更新」类改动使用 `其他更新` 作为 id。

标记自查：`rg -n "FORK\(|FORK-BEGIN\(" --glob '!AGENTS.md' --glob '!FEATURES.md'`

## 本地模式：去云账号 + WebDAV 配置同步 (local-mode)

- **状态**：四期全部实现（2026-09-28）：入口屏蔽、WebDAV 备份内核、设置页「同步」栏目、首屏引导/冲突弹窗/左下角状态项
- **需求背景**：本项目不接入上游 ZCode 云账号体系，需要把「登录 ZCode 账号」从产品面移除（仅保留自定义提供商），并提供一条用户自管的配置同步通道，便于多机共享界面配置与自定义提供商。
- **修改内容**：
  1. 屏蔽云账号全部入口（首屏登录引导、登录页、侧栏登录/登出、会话过期与账号断连提示），并停用后台账号链路（启动静默会话恢复、账号 provider 下发与刷新）。入口屏蔽，不删除代码。
  2. 模型设置里不再展示预置的智谱提供商（Z.ai / BigModel 预设卡片与 Coding Plan 系列行）；「添加提供商」的自定义路径与模板保留。
  3. 移除左下角「连接使用 / 升级」入口，该位置改为 WebDAV 连接状态。
  4. 首屏登录替换为「使用 WebDAV 登录」（可跳过）；远端以**时间命名的 zip 备份包**保存配置历史（`setting.json` 白名单字段 + `provider_config.json`），本地变更防抖 2 分钟后自动上传，保留最近 N 份（默认 20，可配）；双侧都有改动时弹窗询问「用远端最新恢复 / 以本地为准备份 / 稍后」。
  5. 设置 → 基础设置 → 同步：WebDAV 连接配置与状态、开启自动同步、保留份数、云端备份、云端恢复、远端备份包列表（可恢复任意节点、可删除任意包）。
- **修改文件**：
  - 已实现（第①期）：新增 `packages/shared/src/fork/flags.ts`、`packages/shared/test/forkLocalMode.test.ts`、`docs/features/local-mode/**`、`.agents/notes/local-mode/**`；上游接线 `packages/shared/src/index.ts`、`packages/ui/src/lib/rootStartupGate.ts`、`packages/ui/src/Root.tsx`、`packages/ui/src/WorkspaceSidebarFooter.tsx`、`packages/ui/src/root/useRootOAuthEffects.ts`、`packages/ui/src/root/useAccountConnectionLossNotification.ts`、`packages/ui/src/settings/model-provider-section/constants.ts`、`packages/ui/src/settings/ModelProviderSection.tsx`、`packages/services/src/zcode-agent/zcodeAgentService.ts`（共 9 个上游文件，20 处 `FORK(local-mode)` 标记）。
  - 已实现（第②期）：新增 `packages/shared/src/fork/webdav-contract.ts`、`packages/services/src/fork/webdav.ts`、`packages/desktop/src/host/fork/webdav/{backup-archive,webdav-client,state-store,local-snapshot,sync-engine,service,index}.ts`、`packages/desktop/test/forkWebdav*.test.ts`（30 个用例）；上游接线 `packages/shared/src/index.ts`（导出契约）、`packages/services/src/index.ts`（导出服务面）、`packages/services/src/accessor.ts`、`packages/client/src/remoteServiceAccess.ts`、`packages/desktop/src/host/index.ts`（注册服务并 `start()`）。
  - 待实现（第③④期）：新增 `packages/ui/src/fork/local-mode/**`；上游接线 `packages/ui/src/lib/settingsNavigation.ts`、`packages/ui/src/settings/settingsPageConfig.ts`、`packages/ui/src/SettingsPage.tsx`、两个语言文件，以及首屏/冲突弹窗/状态项的接线。
- **上游改动标记**：共 20 个文件、42 处 `FORK(local-mode)`——`shared/src/index.ts`、`services/src/index.ts`、`services/src/accessor.ts`、`client/src/remoteServiceAccess.ts`、`desktop/src/host/index.ts`、`services/src/zcode-agent/zcodeAgentService.ts`、`ui/src/lib/{rootStartupGate,settingsNavigation}.ts`、`ui/src/Root.tsx`、`ui/src/SettingsPage.tsx`、`ui/src/WorkspaceSidebarFooter.tsx`、`ui/src/WorkspaceSidebarFooterUsageSummary.tsx`、`ui/src/root/{useRootOAuthEffects,useAccountConnectionLossNotification}.ts`、`ui/src/settings/{settingsPageConfig.ts,ModelProviderSection.tsx}`、`ui/src/settings/model-provider-section/{constants.ts,useModelProviderNavigation.ts}`、`ui/src/i18n/locales/{zh-CN,en-US}.ts`。
- **设计文档**：`docs/features/local-mode/design.md`
- **实现文档**：`docs/features/local-mode/implementation.md`（文件清单、上游接线 20 个文件/42 处标记、验证证据、与设计的偏差）
- **开发工作流**：Superpowers（`brainstorming` 已完成设计确认；后续 `writing-plans` → `executing-plans` → `verification-before-completion`）。
- **上游同步记录**：暂无。

### 备份范围增强：纳入系统指令配置（identity-preset 第 3 期）

- **增强点**：备份包新增 `presets/active.json` 与 `presets/profiles/<id>.md`；预设正文参与内容哈希（只改提示词也会触发上传）；恢复整目录覆盖，旧包无该条目时保持本地不动。
- **影响的上游标记**：无新增上游文件——改的是 fork 自有文件（`packages/shared/src/fork/webdav-contract.ts`、`packages/desktop/src/host/fork/webdav/{backup-archive,local-snapshot,sync-engine,service}.ts`）与一处宿主装配（`packages/desktop/src/host/index.ts` 的 `FORK(identity-preset)` 标记）。
- **验收**：`packages/desktop/test/forkWebdavPresets.test.ts`（7 个用例：往返、旧包不产生字段、哈希敏感、越界条目名被拒、本地只收合法 id、恢复旧包不动本地、整目录覆盖）。

## 系统指令：用户自定义提示词 (identity-preset)

- **状态**：三期全部完成（2026-09-29）：内核、宿主服务与设置页、WebDAV 同步
- **需求背景**：上游的系统提示词是代码里的固定文本，用户无法调整模型的回答风格；core 虽有 `customSystemPrompt`，但它是「整段替换」语义且没有任何生产写入方，不适合直接暴露给用户。需要一条用户可管理的自定义提示词通道：多组命名配置 + 总开关 + 本地文件存储（与 `~/.zcode/agents` 同级，全机一份），并纳入既有 WebDAV 同步；启用后只替换**身份段**，运行时事实段（环境信息 / gitStatus / 上下文管理 / 桌面契约）保持不变。
- **修改内容**：
  1. 第 1 期（内核）已完成：共享契约与模板常量（`presets/` 目录名、id 规则、`active.json` 形态、`default` / `skeleton` 模板）；agent 侧只读文件端口（读盘失败一律回退系统默认，绝不抛出、不写盘）；身份段构造与激活项解析；`builder.ts` 接线——启用后 `cli_prefix` 不再发出、身份段换成用户配置正文，system 消息由 3 条变 2 条，动态段与缓存语义不变，`workflowActor` / `customSystemPrompt` / 内置子代理三条路径让位；bootstrap 端口装配（`<storageRoot>/presets`，可用 `ZCodeAppOptions.identityPresetPort` 覆盖）。同一 App 内有效值只有一份（并发首次进入可能各读一次、结果相同）、只对新建会话生效，配置目录不存在时行为与改动前一致。
  2. 第 2 期（服务与设置页）已完成：宿主文件层（原子写、空闲 id 分配、名称归一化、正文长度上限、Windows 保留设备名避让、删除激活项同时清空 activeId）；fork 服务面与宿主实现（写操作后广播状态，含 activeMissing 供 UI 提示）；访问层四处接线；设置页「系统指令」栏目（总开关、配置列表与激活标记、按模板新建、编辑器、删除确认，并明示「对新会话生效」）；i18n 与 test-ids。写入方绝不覆盖已有配置——id 派生会撞名（`"a b"` 与 `"a-b"` 都得 `a-b`），冲突时退让成 `-2`、`-3`。
  3. 第 3 期（同步）已完成：`presets/` 纳入 WebDAV 备份包（`presets/active.json` + `presets/profiles/<id>.md`）；预设正文参与内容哈希，只改提示词也会触发上传；恢复时整目录覆盖，但旧备份包（无 `presets/` 条目）保持本地不动；读取侧拒绝 zip 内的嵌套/穿越条目名。
- **修改文件**：
  - 已实现（第 1 期）新增：`packages/shared/src/fork/identity-preset-contract.ts`、`packages/shared/test/forkIdentityPresetContract.test.ts`、`apps/zcode-cli/packages/core/src/fork/identity-preset/{profile-file,identityManager,file-port,index}.ts`、`apps/zcode-cli/packages/core/test/forkIdentityPreset{,Context}.test.ts`、`docs/features/identity-preset/**`。
  - 已实现（第 2 期）新增：`packages/services/src/fork/identityPreset.ts`、`packages/desktop/src/host/fork/identity-preset/{profile-store,service,index}.ts`、`packages/desktop/test/forkIdentityPresetStore.test.ts`、`packages/ui/src/fork/identity-preset/{useForkIdentityPreset.ts,SystemInstructionsSection.tsx,index.ts}`；上游接线 `packages/services/src/index.ts`、`packages/services/src/accessor.ts`、`packages/client/src/remoteServiceAccess.ts`、`packages/desktop/src/host/index.ts`、`packages/ui/src/lib/settingsNavigation.ts`、`packages/ui/src/settings/settingsPageConfig.ts`、`packages/ui/src/SettingsPage.tsx`、`packages/ui/src/i18n/locales/{zh-CN,en-US}.ts`、`packages/shared/src/test-ids.ts`。
  - 待实现（第 3 期）：`presets/` 纳入 WebDAV 备份包（fork 内部既有文件：`packages/shared/src/fork/webdav-contract.ts`、`packages/desktop/src/host/fork/webdav/{backup-archive,local-snapshot,sync-engine,service}.ts`）。
- **上游改动标记**：第 1–3 期共 21 个上游文件、42 行标记（`rg -l "FORK\(identity-preset\)|FORK-BEGIN\(identity-preset\)" -g '!docs/**' -g '!FEATURES.md' -g '!AGENTS.md'` 的实测口径）。
  - 第 1 期（10 文件 / 30 行，16 单行 + 7 对）：`packages/shared/src/index.ts`、`apps/zcode-cli/packages/core/src/{index.ts,context/types.ts,context/builder.ts,runtime/types.ts,runtime/internal.ts,runtime/agent-runtime.ts,runtime/methods/context.ts}`、`apps/zcode-cli/packages/bootstrap/src/app/{types.ts,create-app.ts}`。
  - 第 2 期（11 文件 / 12 行）：`packages/services/src/{index.ts,accessor.ts,node.ts}`、`packages/client/src/remoteServiceAccess.ts`、`packages/desktop/src/host/index.ts`、`packages/shared/src/test-ids.ts`、`packages/ui/src/lib/settingsNavigation.ts`、`packages/ui/src/settings/settingsPageConfig.ts`、`packages/ui/src/SettingsPage.tsx`、`packages/ui/src/i18n/locales/{zh-CN,en-US}.ts`。
  - 第 3 期（0 新文件）：只改 fork 自有的备份链路与 `packages/desktop/src/host/index.ts` 的装配行（该文件已计入第 2 期）。同步范围改由 `packages/desktop/src/host/fork/webdav-sync/manifest.ts` 的清单声明，WebDAV 引擎（`fork/webdav/**`）不认识任何具体资源。
- **设计文档**：`docs/features/identity-preset/design.md`
- **实现文档**：`docs/features/identity-preset/implementation.md`（第 1 期：落地位置、关键改动、上游接线、验证证据、与设计的偏差）与 `implementation-plan-2.md`（第 2 期计划与硬性要求）
- **开发工作流**：Superpowers（`brainstorming` 已完成设计确认；`writing-plans` 产出第 1 期计划，逐任务实现并评审后由 `verification-before-completion` 收口）。
- **上游同步记录**：暂无。

## GitHub 更新通道 (github-update)

- **状态**：已实现（2026-09-28），未打包验收（见实现文档 §4）
- **需求背景**：本项目只把产物发布到自己的 GitHub Release，不部署上游 `zcode.z.ai` 的服务端更新接口。线上包因此有两个问题：桌面自动更新查的是上游地址，永远拿不到本 fork 的版本；启动前还会向上游 `/api/v1/client/configs` 请求 `forceUpdate.minimalVersion`，一旦上游把最低版本抬高，二开版本会被拦在启动页（强更 gate）。
- **修改内容**：
  1. 桌面端自动更新改为查本仓库的 GitHub Release，不再请求上游服务端 manifest。stable 通道用 GitHub 的 `releases/latest/download` 别名（GitHub 定义为「最新非 prerelease」），preview 通道用固定 tag `canary-build` 的指针 Release；通道仍由设置里的「接收 preview 版本」决定，切换时 feed 基址与 channel 文件名同步切换。
  2. 移除启动强更 gate：不再请求 `/api/v1/client/configs` 的 `forceUpdate`，不再因远端配置阻止主窗口创建或退出应用；同时清掉 `requestForceAutoUpdate`、`ForceUpdateConfig`、`getForceUpdateConfig()` 服务方法、`packages/shared/src/forceUpdate.ts` 与两个语言文件里的 `forceUpdate.*` 文案（移除前已无 UI 引用）。
  3. 发布流水线产出并上传 electron-updater 需要的更新元数据：`detectUpdateChannel` 打开（稳定版写 `latest*.yml`，dev 版写 `dev*.yml`），artifact 增加 `*.blockmap` 与两个候选 yml，dev 构建额外把资产覆盖到 `canary-build` 指针 Release。
- **修改文件**：
  - 新增 `packages/desktop/src/main/fork/github-update/feed.ts`、`packages/desktop/test/forkGithubUpdateFeed.test.ts`、`docs/features/github-update/**`。
  - 删除 `packages/desktop/src/main/manifestUpdateProvider.ts`、`forceUpdateGuard.ts`、`forceUpdatePrompt.ts`、`packages/shared/src/forceUpdate.ts`。
  - 上游接线：`packages/desktop/src/main/{autoUpdater.ts,index.ts,desktopSecondInstanceDeepLink.ts}`、`packages/desktop/electron-builder.config.js`、`.github/workflows/release.yml`、`packages/shared/src/{index.ts,remoteAppConfig.ts,coding-plan-subscription.ts}`、`packages/services/src/coding-plan-subscription/*`（3 个）、`packages/ui/src/i18n/locales/{zh-CN,en-US}.ts`。
- **上游改动标记**：3 个上游文件、7 个单点 `FORK(github-update)` + 3 对 `FORK-BEGIN/END`（`autoUpdater.ts`、`electron-builder.config.js`、`release.yml`）；其余为新增文件或纯删除。
- **设计文档**：`docs/features/github-update/design.md`
- **实现文档**：`docs/features/github-update/implementation.md`（落地位置、标记清单、验证证据、未执行项、与设计的偏差）
- **已知边界**：macOS 自更新要求签名（未配置签名 secret 时 macOS 端自动更新不可用）；更新元数据本身无签名，信任根转移到 GitHub 仓库写权限；更新弹窗的 release notes 会退化为空（generic provider 不带 `releaseNotesByLocale`）；移除强更 gate 后没有强制下线能力。
- **上游同步记录**：暂无。
