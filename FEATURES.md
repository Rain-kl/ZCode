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

### 备份范围增强：同步范围改为 manifest 声明，并纳入子代理与命令（2026-09-29）

- **增强点**：同步范围由 `packages/desktop/src/host/fork/webdav-sync/manifest.ts` 的清单声明，WebDAV 引擎不再包含业务逻辑；新增用户级子代理 `agents/`（`.md`/`.markdown`，递归）与自定义命令 `commands/`（`.md`，递归）两个同步条目——两者加载器都递归扫描，故条目显式声明 `recursive`，并新增「非递归条目拒收嵌套路径」规则。
- **影响的上游标记**：无新增上游文件；改的是 fork 自有文件与 `packages/desktop/src/host/index.ts` 的装配行（已在第 2、3 期计入）。
- **验收**：`packages/desktop/test/forkWebdav*.test.ts` 36 个用例（新增递归往返、递归条目越界拒收、非递归条目拒收嵌套路径、清单扩展点）。

### 备份范围增强：纳入系统指令配置（identity-preset 第 3 期）

- **增强点**：备份包新增 `presets/active.json` 与 `presets/profiles/<id>.md`；预设正文参与内容哈希（只改提示词也会触发上传）；恢复整目录覆盖，旧包无该条目时保持本地不动。
- **影响的上游标记**：无新增上游文件——改的是 fork 自有文件（`packages/shared/src/fork/webdav-contract.ts`、`packages/desktop/src/host/fork/webdav/{backup-archive,local-snapshot,sync-engine,service}.ts`）与一处宿主装配（`packages/desktop/src/host/index.ts` 的 `FORK(identity-preset)` 标记）。
- **验收**：`packages/desktop/test/forkWebdavPresets.test.ts`（7 个用例：往返、旧包不产生字段、哈希敏感、越界条目名被拒、本地只收合法 id、恢复旧包不动本地、整目录覆盖）。

### 云账号额度链路下线：删除调用点而非加开关（2026-09-29）

- **需求背景**：第①期的「入口屏蔽」只覆盖界面门面（首屏登录、侧栏登录/登出、升级入口）与部分后台通知（会话恢复、断连提醒、provider 下发），但**账号 provider 可用性查询**与**额度查询**这两条云链路完全没有判定。实测启动日志仍出现 `[server] [coding-plan-availability] billing/balance 请求完成` 与 `[server] [usage-stats] billing/balance 请求完成`，请求 `https://zcode.z.ai/api/v1/zcode-plan/billing/balance?app_version=3.14.3`，并因磁盘上残留的 `zcodejwttoken` 拿回了真实账号套餐（`ZCode Start Plan`）与额度（GLM-5.3 / GLM-5.3-Flash）。用户要求「不要用开关的方式，直接删掉其相关的调用，让其成为死代码」。
- **修改内容**：删除调用点，不新增 `FORK_LOCAL_MODE` 判定分支。
  1. `packages/services/src/node.ts`：`accountProviderConfigSource` 不再装配 `createCodingPlanFamilyAvailabilityResolver`（该链会经 `validateZai/BigModelAccountProviderAvailability` → `validateStartPlanAvailability` → `GET /zcode-plan/billing/balance`），改为本地实现：`loadCodingPlanApiKey` 直接返回 `null`、`resolveFamilyAvailability` 对所有 provider 返回 `coding_plan_not_connected`。返回「未连接」而非空对象，是因为空对象会退化成 `status:"unknown"`，且 Start Plan 的 `current` 只看登录身份，会在无权益时仍被标成当前套餐。
  2. `packages/services/src/usage-stats/usageStatsService.ts`：不再构造 `BigModelUsageQuotaProvider`，整条云端额度实现（含 `/billing/balance`）成为死代码。`getEntitlementSnapshot` 返回 fail-closed 的 `not_configured` 快照（UI 已是一等状态，`hasActiveCodingPlanSnapshot` 会因此判为无有效套餐）；`getCodingPlanUsageSnapshot` / `getCodingPlanResetStatus` / `requestCodingPlanResetOpportunity` / `useCodingPlanReset` / `markCodingPlanResetHistoryRead` / `getSnapshot` 改为携带方法名与原因的显式报错，不静默返回空数据。
  3. `packages/services/src/coding-plan-subscription/codingPlanSubscriptionService.ts`：`getEnterprisePricing` 不再转发到 provider（该方法是云账号读路径，且被常驻侧栏 footer 在启动时调用），返回空 `productList`。
  4. 保留 `getAppUsageSnapshot`——它读取 agent 数据库本地统计，是用户要求保留的「使用统计」，与云账号无关。
- **修改文件**：`packages/services/src/{node.ts,usage-stats/usageStatsService.ts,coding-plan-subscription/codingPlanSubscriptionService.ts}`；新增 `packages/services/test/forkLocalModeCloudUsageRemoval.test.ts`（3 个用例）。
- **上游改动标记**：3 个上游文件、4 处 `FORK(local-mode)`（含 1 处注释说明被停用的导入）。
- **验收**：契约测试断言三条不变量——本地统计仍走 agent 数据库；`getEntitlementSnapshot` 返回 `not_configured` 且不触达网络/凭据（传入的 `apiClient` 与 `credentialService` 桩一旦被调用即抛错）；云额度方法显式报错且错误信息含方法名与移除原因。整仓 `pnpm typecheck` 0 错误、`pnpm lint` 0 error。
- **已知边界**：本次按「删调用」处理，`BigModelUsageQuotaProvider`、`codingPlanProviderAvailability.ts`、`createCodingPlanFamilyAvailabilityResolver` 等实现文件保留为死代码（未删除源文件）。磁盘上残留的 `zcodejwttoken` 与按 endpoint/版本隔离的 `zcode-builtin.json` 未清理（调用点已无，不会再生效）。UI 层 `useUsageEntitlement` 的调用点保留：服务层已 fail-closed，它们拿不到有效套餐、不会触达云端。

## 移除闲时任务入口 (offpeak-removal)

- **状态**：已实现（2026-09-29）：工具面与创建路径两处入口撤掉，其余实现保留为死代码。
- **需求背景**：闲时任务（off-peak）要云端取号服务 + 账号上的 Coding Plan 连接才能用。本 fork 正在去云账号与 Coding Plan 体系（见 `local-mode`），用户只用自定义服务提供商，于是这个功能**永远无法创建**，却仍留在模型上下文里：宿主下发的灰度开关一旦为真，两个工具（描述 + 每个 8 条模型指令 + JSON Schema）就会进入**每一次**模型请求（实测本机会话的工具面里就有它们），token 买来的是一个必然失败的工具，模型也可能去调它并拿到「没有可用连接」这类无用失败。
- **修改内容**：掐掉两个入口，让功能在模型与执行两侧都不可达：
  1. **工具面**：两个闲时工具从工具注册表下架，因此不进入 provider 契约（模型请求的 `tools`）。这个保证与云端灰度开关无关——不是「开关关了所以没有」，而是没有能被打开的门。
  2. **创建路径**：协议宿主不再创建/注入闲时端口，创建整体不可达（协议字段保留，老宿主下发开关现在是无效果）。
  3. **开关清理**：`includeOffPeak` 选项与运行时推导一并删除，不留「看起来还能开」的假门。
- **修改文件**：上游接线 3 个文件、7 处 `FORK(offpeak-removal)`；移除守卫规则登记在 `scripts/fork-removal-rules.mjs`（该文件由扫描器 `scripts/check-fork-removals.mjs` 拆出，同时新增 `absentPatternsInFile` 规则类型）——`apps/zcode-cli/packages/core/src/tool/handlers/index.ts`（import、条目、选项、过滤分支）、`apps/zcode-cli/packages/core/src/runtime/helpers/runtime-tools.ts`（装配开关）、`apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-operations.ts`（端口注入与 import）。新增 `apps/zcode-cli/packages/core/test/forkOffPeakRemoval.test.ts`（5 例）、`docs/features/offpeak-removal/**`。
- **上游改动标记**：3 个上游文件、7 处（详见实现文档）。
- **设计文档**：`docs/features/offpeak-removal/design.md`
- **实现文档**：`docs/features/offpeak-removal/implementation.md`
- **已知边界（保留为死代码，逐项写明为什么已是死路）**：`core` 的 off-peak handler 与 contracts schema、`OffPeakPort` 类型与上下文透传、协议字段（`offPeakTaskId` / `offPeakRunType` / `offPeakToolEnabled`）与 `off-peak-tool-policy.ts`、UI 的闲时区块与 store/hook、服务层（service/repo/server client/gateway）、桌面调度器的领号/派发/结算、运行时里的闲时轮身份与 denylist。**不删除的理由**：本仓库对上游能力一贯「入口屏蔽，不删除代码」（local-mode 同款），且该功能横跨 6 个包 50+ 文件，全删会把协议 schema 与整个 UI 卷进来。**不做数据迁移**：库里已有的闲时任务记录保持原样。
- **上游收敛**：上游若把闲时任务的开关/工具改成默认关闭或移除，本条目可整体退场（摘除范围见实现文档 §2）；若上游继续演进该功能，保持移除即可，同步时按守卫报错逐处取舍。
- **上游同步记录**：暂无。

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

## 编辑 stale 判据改为内容哈希 (edit-stale-guard)

- **状态**：已完成（2026-09-29）
- **需求背景**：`Edit` / `Write` 写入前要判「文件自模型读取后是否被改过」，上游用 mtime + size 代理，两个方向都会出错。**误报**：唯一的豁免只对「严格整读」生效，range Read（offset/limit）拿不到它，于是格式化器空保存、IDE 保存、git 触碰、同一 workspace 的另一个会话只要推进了 mtime，就被判 stale，哪怕字节没变。**漏报**：判「变了」要求 mtime 严格变大，mtime 不前进且 size 相同时直接放行且不比对内容（write.ts 的最终内容比对只覆盖整读），于是 `cp -p`、`tar -x`、`rsync -t` 这类保留时间戳的写入会静默覆盖别的进程刚写下的内容。
- **修改内容**：
  1. 读路径补齐整文件内容哈希：range 读取（`text-range-reader.ts` 快路径与流式路径）的 revision 补上 `hash`，与上游既有的整文件读、写路径共用同一算法与 `sha256:` 前缀（实现收拢到 fork 模块 `content-hash.ts`，避免各写一份而漂移）。哈希对象一律是磁盘原始字节——`utf16le`/`latin1` 等编码下「解码后再按 utf8 编码」会与写路径写下的字节不同，会让未改动文件永久判 stale。
  2. `ReadFileStateEntry` 增可选 `contentHash`，由 Read、Bash 回填、Edit、Write 四个写入方落库。
  3. 判据新增 fork 模块 `hash-staleness.ts`：两侧哈希都有且相同 → 不判 stale（消除误报，无视 mtime/size）；都有且不同 → 直接判 stale（消除漏报，无视 mtime/size）；任一缺失 → 原样回落上游 mtime/size 判据。`FILE_NOT_READ`/partial view 的拒绝位置不变。
  4. 持久化 schema 不动：resume 从历史 metadata 恢复的 read-state 没有哈希，回落旧判据。
- **修改文件**：新增 `apps/zcode-cli/packages/adapters/src/fork/edit-stale-guard/content-hash.ts`、`apps/zcode-cli/packages/core/src/fork/edit-stale-guard/hash-staleness.ts`、`apps/zcode-cli/packages/core/test/forkEditStaleGuard.test.ts`（8 个用例）、`docs/features/edit-stale-guard/**`；上游接线 `apps/zcode-cli/packages/adapters/src/fs/index.ts`、`apps/zcode-cli/packages/adapters/src/fs/text-range-reader.ts`、`apps/zcode-cli/packages/core/src/tool/types.ts`、`apps/zcode-cli/packages/core/src/tool/handlers/{read,edit,write,bash-read-file-state}.ts`。
- **上游改动标记**：7 个上游文件、20 处 `FORK(edit-stale-guard)` / `FORK-BEGIN` / `FORK-END`——`adapters/src/fs/index.ts`（4）、`adapters/src/fs/text-range-reader.ts`（5）、`core/src/tool/handlers/edit.ts`（4）、`core/src/tool/handlers/write.ts`（4）、`core/src/tool/types.ts`（1）、`core/src/tool/handlers/read.ts`（1）、`core/src/tool/handlers/bash-read-file-state.ts`（1）。两处判据块（`edit.ts`、`write.ts`）成对标记，可整块摘除。
- **设计文档**：`docs/features/edit-stale-guard/design.md`
- **实现文档**：`docs/features/edit-stale-guard/implementation.md`（落地位置、标记清单、验证记录、与设计的偏差）
- **上游收敛**：上游若自己实现内容哈希判据（或让 range 读取自带 hash），删除本功能并采用上游实现——摘除范围见实现文档第 2 节。
- **已知边界**：判据是字节级的，只改行尾（CRLF↔LF）或 BOM 的重写也算 stale，模型需重新 Read；`Read` 的 `file_unchanged` 短路（`read.ts` 的 `isCachedReadFresh`）仍按 mtime+size，属同族残留但不在本次范围。
- **上游同步记录**：暂无。

## 非流式走流式通道 (nonstream-via-stream)

- **状态**：已实现（2026-09-29），未做真实 provider 端到端验证（见实现文档 §4）
- **需求背景**：应用对 provider 有两条请求通道——流式（主对话/子代理）与非流式（会话标题、上下文压缩、WebFetch 内容处理、子代理汇总）。第三方中转存在只把流式做对的情况：非流式返回的响应体不符合 OpenAI 兼容协议（实测 `{"data":{"choices":[...]}}`，`choices` 未在顶层 → AI SDK 校验失败），或该通道直接不可用（500 `empty response content`）。后果是所有非流式调用方一起失效，而流式正常。
- **修改内容**：新增 `Model` 端口层的 stream→non-stream 适配器——非流式调用改为发起**流式**请求，在本地把流事件汇总成一次性结果；流式行为原样透传，`bind()` 递归包装。汇总语义逐条对齐 core 流式分支（reasoning 按 id 分桶、工具调用按 id 去重、`finish` 提供 finishReason/usage/providerMetadata、`error` 经 `normalizeStreamError` 抛出），复用 `getOrCreateReasoningBlock` 与 `normalizeStreamError`，不复制归并规则。接线点在 `createRuntimeModel`——全仓库唯一调用 `runtime.modelFactory` 的位置，因此一处覆盖主对话、子代理、压缩、标题与 WebFetch 处理。
- **修改文件**：
  - 新增 `apps/zcode-cli/packages/core/src/fork/nonstream-via-stream/model.ts`、`apps/zcode-cli/packages/core/test/forkNonstreamViaStream.test.ts`（7 例）、`docs/features/nonstream-via-stream/**`。
  - 上游接线：`apps/zcode-cli/packages/core/src/runtime/methods/runtime-model.ts`（1 个单点标记 + 1 对 `FORK-BEGIN/END`）。
- **上游改动标记**：1 个上游文件、2 处 `FORK(nonstream-via-stream)`。
- **设计文档**：`docs/features/nonstream-via-stream/design.md`
- **实现文档**：`docs/features/nonstream-via-stream/implementation.md`
- **已知边界**：未覆盖结构化输出（当前全产品无 `responseJsonSchema` 调用方）；按 provider 类型是全量切换，若某 provider 恰好流式有缺陷而非流式正常会反向受损（接线单点，回退只需去掉包装）；不修复 provider 侧通道不可用（`No available channel` 之类与请求方式无关）。
- **上游同步记录**：暂无。

## WebFetch 短内容直通 (webfetch-direct-passthrough)

- **状态**：已实现（2026-09-29），单测覆盖决策边界与处理器接线；运行期以「日志里不再出现 `querySource=web_fetch_processing`」验证，待真实短页面抓取复验。
- **需求背景**：上游 WebFetch 永远两段式——抓页面抽正文后，再调一次模型把正文压成摘要交给调用方。短页面（几段文档、单个 API 章节）压成摘要纯损失：多一次模型往返（可能超时/失败，失败时整页内容丢失，调用方只看到 `webfetch_processing_failed`），且摘要会丢表格、代码片段、字段名等细节，而抓取方无法察觉丢了什么。
- **修改内容**：正文去标点后 `< 15000` 字、且发起本次调用的请求剩余上下文预算 `>= 30000`、且原始长度仍 `<= 100000`（模型输入上限守卫，防「几乎全是标点」的页面绕过字数判定）时，跳过加工模型，直接把抽取出的正文交给调用方模型。判定与计数是纯函数（`policy.ts`），剩余预算由 runtime 在发起请求前算一次（`remaining-tokens.ts`）并逐级透传，工具侧只读快照；任一条不满足或预算不可得都回落上游行为。
  - 字数口径：Unicode 码点数，排除 `P*`（标点）；空白、换行与 `S*`（符号，如 `+` `=`）计入——保守取法，只会更早回落总结。
  - 剩余预算口径与 `resolveModelStepMaxOutputTokens` 的 `estimatedCurrentUsage` 同源同值，不引入第二套估算。
- **修改文件**：
  - 新增 `apps/zcode-cli/packages/core/src/fork/webfetch-direct-passthrough/{policy.ts,remaining-tokens.ts}`、`apps/zcode-cli/packages/core/test/forkWebfetchDirectPassthrough.test.ts`（14 例）、`docs/features/webfetch-direct-passthrough/**`。
  - 上游接线：`tool/handlers/webfetch-processing.ts`（判定调用），`tool/types.ts` + `tool/executor/{types.ts,call-runner.ts,batch-runner.ts}` + `runtime/types.ts` + `runtime/methods/{tools.ts,turn-tools.ts,turn-model-step.ts}`（剩余预算透传）。
- **上游改动标记**：9 个上游文件、14 处 `FORK(webfetch-direct-passthrough)`（含 2 对 `FORK-BEGIN/END`）。
- **设计文档**：`docs/features/webfetch-direct-passthrough/design.md`
- **实现文档**：`docs/features/webfetch-direct-passthrough/implementation.md`
- **已知边界**：直通时不再执行加工分支的「引用合规指令」（125 字符引用上限等），正文原文进上下文——这是直通的定义使然，已明确接受；流失败恢复路径（`streaming-tool-coordinator.recoverFromModelFailure`）不带预算，回落总结；WebFetch 描述未改（仍是 "answers `prompt` against it using a small fast model"，对大多数调用成立）。
- **上游收敛**：上游若自己实现「短内容免摘要」或把工具结果预算改成按剩余窗口自适应，删除本功能并采用上游实现——摘除范围见实现文档 §2。
- **上游同步记录**：暂无。

## 网络搜索渠道 (search-providers)

- **状态**：已实现（2026-09-29），未做打包产物与真实 Tavily 端到端验证（见实现文档 §7）
- **需求背景**：`WebSearch` 原本仅有 provider-native 服务端搜索一条实现路径，且编码层只支持 anthropic 通道。在 openai-compatible 通道上（`supportsNativeWebSearch` 恒为假），`WebSearch` 对模型被硬性过滤，模型拿不到任何搜索工具只能猜 URL。需要将搜索后端解耦为可插拔、可降级的渠道链，以服务端搜索为首选，并允许用户配置自带 Key 的 Tavily 外部搜索渠道作为备用和兜底。
- **修改内容**：
  1. **渠道模型**：抽象 `SearchChannel` 与 `SearchChannelOutcome`，服务端搜索与 Tavily 渠道统一纳管，对外维持单一 `WebSearch` 工具外观。
  2. **路由与降级**：瀑布流按序尝试，首个成功渠道立即返回；前置失败留痕（`console.warn`）；全渠道失败抛出结构化 `SearchChannelsExhaustedError`；支持 `AbortSignal` 快速中断不降级。
  3. **暴露门改造**：`shouldExposeWebSearch` 判据从「模型是否支持原生搜索」改为「可用渠道数 > 0」，为非原生模型解锁搜索能力，且无渠道时保持隐藏（回归保护）。
  4. **设置页「搜索」栏目**：设置 → 基础设置 → 搜索，呈现活动模型服务端搜索只读状态，支持 Tavily 渠道的添加、启用/禁用、Key 掩码显示、拖拽排序与删除。
  5. **存储与 WebDAV 同步**：渠道配置以 `0o600` 权限安全保存在 `<homedir>/.zcode/cli/fork/settings.json`（原子写与文件锁）；新增 `cliConfigDir` base 变体并纳入 WebDAV 同步清单。
- **修改文件**：
  - 新增文件：`packages/shared/src/fork/search-providers-contract.ts`、`packages/services/src/fork/search-providers.ts`、`packages/desktop/src/host/fork/search-providers/{file-store,service,index}.ts`、`packages/ui/src/fork/search-providers/{useForkSearchProviders.ts,SearchProvidersSection.tsx,ChannelList.tsx,ChannelDialogs.tsx}`、`apps/zcode-cli/packages/core/src/fork/search-providers/{channel,router,tavily,channels}.ts`、`packages/shared/test/forkSearchProvidersContract.test.ts`、`apps/zcode-cli/packages/core/test/forkSearchProviders{Router,Tavily,Channels,Exposure,Handler}.test.ts`、`packages/desktop/test/forkSearchProvidersFileStore.test.ts`、`packages/desktop/test/forkSearchProvidersSyncEntry.test.ts`、`packages/ui/test/forkSearchProvidersSection.test.ts`、`docs/features/search-providers/**`。
  - 上游接线文件（14 个）：`apps/zcode-cli/packages/core/src/tool/handlers/websearch.ts`、`apps/zcode-cli/packages/core/src/runtime/methods/config.ts`、`apps/zcode-cli/packages/contracts/src/tools/websearch.ts`、`packages/shared/src/index.ts`、`packages/services/src/{index.ts,accessor.ts}`、`packages/client/src/remoteServiceAccess.ts`、`packages/desktop/src/host/index.ts`、`packages/ui/src/settings/settingsPageConfig.ts`、`packages/ui/src/settings/model-provider-section/ApiKeyInput.tsx`、`packages/ui/src/lib/settingsNavigation.ts`、`packages/ui/src/SettingsPage.tsx`、`packages/ui/src/i18n/locales/{zh-CN,en-US}.ts`（注：`packages/desktop/src/host/fork/webdav-sync/manifest.ts` 为 fork 自有清单文件，无上游标记）。
- **上游改动标记**：按可复现命令 `rg -n "FORK\(search-providers\)|FORK-BEGIN\(search-providers\)|FORK-END\(search-providers\)" --glob '!AGENTS.md' --glob '!FEATURES.md' --glob '!docs/**' --glob '!.superpowers/**'` 检索，当前实况为 **14 个上游文件，共 36 行标记**；按逻辑改动处口径（单点 1 处，成对块 1 处）统计为 **32 处**（包含 28 处单点标记与 4 对 `FORK-BEGIN/END` 块），分项之和与总计严格一致：
  - `contracts/src/tools/websearch.ts`（2 处 / 2 行：`max_results` 入参字段、`channel` 可选输出字段）
  - `core/src/runtime/methods/config.ts`（3 处 / 4 行：计数方法 import、守卫函数导出、渠道数暴露门判据 [含 1 对成对块]）
  - `core/src/tool/handlers/websearch.ts`（4 处 / 7 行：import 块保持上游第 24 行零 diff [1 对成对块]、工具名常量导出、描述函数导出与去掉 US-only [1 对成对块]、处理器主体接线与降级留痕 [1 对成对块]）
  - `client/src/remoteServiceAccess.ts`（4 处 / 4 行：通道常量、映射表、服务接口、工厂方法）
  - `desktop/src/host/index.ts`（5 处 / 5 行：服务接口导入、工厂导入、运行时导入、`resolveBase` 的 `cliConfigDir` 分支、服务注册）
  - `services/src/accessor.ts`（1 处 / 1 行：服务访问器属性）
  - `services/src/index.ts`（1 处 / 1 行：服务面导出）
  - `shared/src/index.ts`（1 处 / 1 行：契约导出）
  - `ui/src/SettingsPage.tsx`（2 处 / 2 行：组件导入、渲染分支）
  - `ui/src/i18n/locales/en-US.ts`（1 处 / 1 行：英文翻译区块）
  - `ui/src/i18n/locales/zh-CN.ts`（1 处 / 1 行：中文翻译区块）
  - `ui/src/lib/settingsNavigation.ts`（3 处 / 3 行：分区 ID 类型、守卫导出、守卫分支）
  - `ui/src/settings/model-provider-section/ApiKeyInput.tsx`（2 处 / 2 行：支持外部自定义 placeholder）
  - `ui/src/settings/settingsPageConfig.ts`（2 处 / 2 行：图标导入、栏目注册）
- **设计文档**：`docs/features/search-providers/design.md`
- **实现文档**：`docs/features/search-providers/implementation.md`
- **已知边界**：见实现文档 §8（测试替身 `as never`、`statSync` 异常粒度、`createServerSearchChannel` 缺乏独立单测、测试临时目录清理、host 装配内联路径风格）。
- **上游同步记录**：暂无。

## 通道清单驱动的服务可用性 (rpc-channel-manifest)

- **状态**：已实现（2026-09-29），单测覆盖判定边界、客户端过滤与装配时序；网页端与桌面端均已 CDP 实测（桌面端为「新旧混跑」验证，见实现文档 §5.4）。
- **需求背景**：网页端打开「设置 → Agent 能力 → 系统指令」时报 `Channel name 'fork-identity-preset' timed out after 1000ms`，本应是空态的列表被错误取代。根因是「通道是否存在」在协议里没有表达：`RemoteServiceAccess` 为每个通道无条件创建惰性代理（代理恒为真值对象），服务端收到未知通道则挂起 1s 后回 `Unknown channel`。于是 UI 里 `available: Boolean(service)` 探测永远为真，真正的「能力缺席」被伪装成「一条超时错误 + 空数据」，且与「调用出错」共用同一个 `error` 状态。
- **修改内容**：**传输层预登记可用通道**。服务端 `ChannelServer` 在既有的 `ResponseType.Initialize` 握手里带上当前已注册通道名数组，不新增往返；客户端 `ChannelClient` 保存并暴露同步读取的 `channelNames()` / `isInitialized()`；`RemoteServiceAccess` 上 `IServiceAccessor` 的可选成员（7 个：media-preview、onboarding-record、window-controller、cua-permission 及三个 fork 服务）改为按清单惰性解析，清单里没有的通道为 `undefined`；清单未知（旧服务端 / 握手未完成）时保持历史行为（照旧建代理）保证向前兼容。UI 两段时间分离：`available` 读成员（清单缺席即「当前环境不支持」），调用由 `usable` 门控（清单到达前不发探测请求）。
  - 时序硬约束：Initialize 必须在通道注册完成后才发，否则会把真实服务误判为不可用（比原报错更糟）。立即初始化改为 `queueMicrotask` 推迟到本 tick 末尾；`deferInit` 路径保持原语义并由契约测试锁定顺序。核查结论与残余风险见实现文档 §6。
  - 判定为「空清单 = 未知」：服务端在注册完成前发送会得到空清单，若当成事实会把本端全部服务显示成不支持——静默失效比可见报错更难排查（设计文档 §2.1）。
- **修改文件**：
  - 新增文件：`packages/client/src/channelManifest.ts`、`packages/services/src/fork/channel-availability.ts`、`packages/ui/src/hooks/useChannelAvailabilityReady.ts`、`packages/rpc/test/rpcChannelManifestHandshake.test.ts`、`packages/client/test/{channelManifest,remoteServiceAccessManifest,channelManifestAssembly}.test.ts`、`docs/features/rpc-channel-manifest/**`。
  - 上游接线文件（12 个）：`packages/rpc/src/{channels.shared.ts,channelServer.ts,channelClient.ts,logging-middleware.ts,network-telemetry-middleware.ts}`、`packages/services/src/{accessor.ts,index.ts}`、`packages/client/src/remoteServiceAccess.ts`、`packages/ui/src/fork/identity-preset/useForkIdentityPreset.ts`、`packages/ui/src/fork/local-mode/{useForkWebdav.ts,FirstRunWebdavScreen.tsx}`、`packages/ui/src/fork/search-providers/useForkSearchProviders.ts`。
- **上游改动标记**：按可复现命令 `rg -n "FORK\(rpc-channel-manifest\)|FORK-BEGIN\(rpc-channel-manifest\)|FORK-END\(rpc-channel-manifest\)" --glob '!AGENTS.md' --glob '!FEATURES.md' --glob '!docs/**' --glob '!.superpowers/**'` 检索；当前为 **12 个上游文件、30 行标记、30 处逻辑改动**（无成对块；逐处分项见实现文档 §4）。
- **设计文档**：`docs/features/rpc-channel-manifest/design.md`
- **实现文档**：`docs/features/rpc-channel-manifest/implementation.md`
- **已知边界**：`deferInit === true` 链路无生产调用方，仅有契约测试覆盖；桌面端验收是「旧 host + 新 renderer 混跑」而非全新实例复验；空清单兜底会掩盖「服务端真的零通道」（当前无此装配点）。
- **上游收敛**：上游若自带服务能力协商（Initialize 携带可用服务声明等），整体删除本功能并采用上游实现；摘除范围与「必须保留的时序不变量」见实现文档 §2。
- **上游同步记录**：暂无。

## 其他更新

- 2026-09-29：WebDAV 报错不再只有一句 `fetch failed`——展开错误 `cause` 链、补上请求方法与 URL，并区分「未收到 HTTP 响应（网络/代理问题）」与「服务端返回错误状态」；`packages/desktop/src/host/fork/webdav/{error-message.ts,webdav-client.ts,service.ts}`。
- 2026-09-29：亮色主题配色——对话/主区域底色改纯白 `#ffffff`，侧边栏改 `#f7f8f9`。侧边栏此前不铺底色、直接透出窗口底色（`bg-background-alt`），现改为消费设计系统里原本闲置的 `--color-sidebar`（展开态 aside 与折叠态轨道都铺底色）。暗色主题 `theme-zai-dark` 本次未改；`packages/ui/src/styles.css`、`packages/ui/src/app-shell/WorkspaceShellLayout.tsx`、`packages/ui/src/WorkspaceSidebar/WorkspaceSidebarCollapsedRail.tsx`。
- 2026-09-29：首次启动默认值调整——界面字号 14px → 12px，颜色主题 `zai-dark` → 跟随系统（`system`）。只影响没有 localStorage 偏好的首次启动，已有偏好不被覆盖。字号必须同时改 JS 默认值与 CSS 变量，否则首屏先按 14px 渲染再跳；主题必须同时改 Zustand store 与 `useTheme` hook 的兜底值，否则两个主题入口分叉；`packages/ui/src/{lib/uiFontSize.ts,styles.css,store/index.ts,useTheme.ts}`。
