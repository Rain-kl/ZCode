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
