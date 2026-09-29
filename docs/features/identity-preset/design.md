# 系统指令：用户自定义提示词（identity-preset）

> 二开功能条目 id：`identity-preset`。代码中所有上游接线标注 `FORK(identity-preset)`，检索见 `AGENTS.md` 的「二开标准（Fork）」。
> 开发工作流：Superpowers（`brainstorming` 已完成本节设计确认 → `writing-plans` → `executing-plans` / `test-driven-development` → `verification-before-completion`）。

## 1. 背景与目标

不同用户希望模型有不同的回答风格。上游 ZCode 的提示词是代码里的固定文本，用户无法改；core 虽已存在 `customSystemPrompt`（`context/builder.ts:84-122`），但它是「整段替换」语义且没有任何生产写入方，不适合直接暴露给用户。

目标：在 **设置 → Agent 能力 → 系统指令** 提供一个用户可管理的自定义提示词功能——

1. 用户可以创建**多组**命名的提示词配置，选择其中一组加载；
2. 提供总开关，关闭时回到系统默认提示词；
3. 新建配置可从模板（默认 / 基础框架）起步，然后在 UI 里自由编辑；
4. 配置以本地文件存储，并纳入既有 WebDAV 同步；
5. 生效后模型收到的**身份段**被用户内容取代，其余运行时事实段保持不变。

## 2. 非目标

- **不替换动态段**：环境信息、gitStatus、Context management、ZCode Desktop Context、Session-specific guidance 全部保留。这些是运行时事实与平台契约，不是风格（详见 6.1）。
- **不影响子代理**：内置子代理（general-purpose / Explore）与动态工作流子代理各有自己的身份来源（`subagent_agent_prompt` / `workflow_actor`），本功能不介入。
- **不做多工作区隔离**：全机一份配置，与 `~/.zcode/agents`、`~/.zcode/AGENTS.md` 同级。
- **不做提示词变量插值、条件片段、版本历史、导入导出**。
- **不改 `outputStyle`**：它是 core 里另一条未接线的通道，本功能不复用它也不激活它。

## 3. 状态所有者

| 状态                                         | 唯一所有者                                        | 存储位置                            |
| -------------------------------------------- | ------------------------------------------------- | ----------------------------------- |
| 提示词配置正文与名称                         | fork 系统指令服务（host 进程内实例）              | `~/.zcode/presets/profiles/<id>.md` |
| 总开关与当前激活的配置 id                    | 同上                                              | `~/.zcode/presets/active.json`      |
| 解析后的有效提示词（agent 视角）             | `AgentRuntimeConfig.identityPreset`（App 级冻结） | 不持久化                            |
| 设置页开关 / 列表 / 编辑器草稿等 UI 局部状态 | 渲染层 fork 组件                                  | 不持久化                            |

**单一写入路径**：文件只由 fork 系统指令服务写；UI 只经该服务的 RPC 写入，不直接碰文件系统。agent 侧只读不写。

**为什么开关状态与配置同目录**：两者必须一起同步、一起回滚。若把开关放进 `setting.json`，恢复旧备份时会出现「开关来自 A 机、配置目录来自 B 机」的错配。

**为什么 agent 读盘而不是宿主下发**：与 `~/.zcode/AGENTS.md`、`MEMORY.md`、`~/.zcode/agents/*.md` 完全一致（bootstrap 的 `loadZCodeAgentProfiles` 就是直接读盘）。宿主下发需要在 `.strict()` 的 `zcodeSessionCreateParamsSchema` 加字段，并改动 `server-operations`、桌面宿主每个建会话入口，改动面大 3～4 倍，且手机远控 / 远端工作区每个入口都要重复接线。

## 4. 总体结构

| 位置                                                       | 内容                                                                                        | 说明                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `packages/shared/src/fork/identity-preset-contract.ts`     | 通道名、状态与配置类型、`active.json` 形态、两个模板常量                                    | 新文件；core / host / UI 三方共用，避免漂移 |
| `apps/zcode-cli/packages/core/src/fork/identity-preset/**` | `identityManager.ts`：读盘、解析 frontmatter、产出与 `identity.ts` 同构的 section、模板回退 | 新目录；agent 侧只读实现                    |
| `packages/services/src/fork/identityPreset.ts`             | `IForkIdentityPresetService` 接口与描述符                                                   | 新文件；与 fork WebDAV 服务同构             |
| `packages/desktop/src/host/fork/identity-preset/**`        | 文件 CRUD、`active.json` 读写、路径校验、事件广播                                           | 新目录；host 侧实现（唯一写入方）           |
| `packages/ui/src/fork/identity-preset/**`                  | 「系统指令」设置栏目、配置列表、编辑器、模板选择                                            | 新目录；React 实现                          |
| 上游接线                                                   | 逐处 `FORK(identity-preset)` 标记                                                           | 见第 7 节                                   |

放置理由：

- core 侧必须有 fork 目录（`apps/zcode-cli/packages/core/src/fork/identity-preset/`），因为提示词组装发生在 agent 进程内，无法外挂到别的包。
- 模板常量放 `packages/shared/src/fork/`：`@zcode/core` 已依赖 `@zcode/shared`（`core/package.json` 的 `dependencies`），三方都能 import，且不产生新的跨包依赖。
- 文件读写放 `packages/desktop/src/host/fork/`：该能力只在桌面宿主有 UI 消费者，与 fork WebDAV 同位置，不污染 `packages/services` 的依赖。

## 5. 数据与文件格式

### 5.1 磁盘布局

```
~/.zcode/presets/
├── profiles/
│   ├── concise.md
│   └── teacher.md
└── active.json
```

- 根目录解析规则与 `~/.zcode/agents` 一致：`<storage.dir>/presets`，`storage.dir` 取自 `~/.zcode/cli/config.json`，默认 `~/.zcode`。不使用 `cli/` 后缀（那是 memories / plugins / logs 的根）。
- 目录不存在时视为「未启用且无配置」，不报错、不自动创建；首次新建配置时才 `mkdir -p`。
- 目录名与文件名都不做用户输入直拼：`<id>` 限 `[a-z0-9-]{1,50}`，非法 id 直接拒绝。

### 5.2 配置文件格式

每个配置一个 `.md`，YAML frontmatter + 正文，与 `~/.zcode/agents/*.md` 同构：

```markdown
---
name: 极简风格
---

你是 ZCode……
```

- `name`：展示名，1–50 字符，必填；文件缺失或为空时回退用文件名 stem。
- 正文：**原样**作为身份段内容，不做 trim 之外的加工（首尾空白裁剪，避免空配置被当成有效内容）。
- 文件名 stem 即 `id`，重命名名称不重命名文件（避免 UI 上的重命名引发文件跳变与同步抖动）。

### 5.3 `active.json`

```jsonc
{ "schemaVersion": 1, "enabled": true, "activeId": "concise", "injectDynamic": true }
```

`injectDynamic` 是**功能级**开关（不随预设切换而变，所以不进 `.md` 的 frontmatter）：缺省 `true`（注入动态段），`false` 时第 ③ 条整段不发出。旧状态文件没有该字段时按 `true` 处理，不能被判成「不认识」。

- 缺失、损坏、`schemaVersion` 不认识 → 按 `{ enabled: false, activeId: null }` 处理并记 `warn` 日志；**不覆写文件**（避免把用户配置在一次读取失败中抹掉）。
- `enabled: true` 但 `activeId` 为空或指向不存在的配置 → 等同关闭（回退系统默认），设置页给出提示。

### 5.4 模板

| 模板       | 内容                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `default`  | 当前系统身份段原文：`You are ZCode, an interactive coding agent` 一行 + 身份声明 + `IMPORTANT` 安全行 + `# Harness` 块  |
| `skeleton` | 带组织结构的骨架：`# 角色` / `# 沟通风格` / `# 工作方式` / `# 边界` 四个小节各配一句写作提示，末尾附 `IMPORTANT` 安全行 |

- 模板常量定义在 `packages/shared/src/fork/identity-preset-contract.ts`，是**新建时的预填文本**，只在创建瞬间读取一次，之后与配置内容无关。
- `default` 模板与 core 的 `identity.ts` 存在镜像关系（host 进程无法 import `@zcode/core`）。因此**用测试固定**：在 `apps/zcode-cli/packages/core/test/` 断言常量等于 `buildCliPrefixSection().content + "\n" + buildIdentitySection().content`。漂移的后果只是「新配置的起点略旧」，不影响已有配置的生效。
- `skeleton` 不含 `# Harness`：用户选择自定义身份即接受不再收到这些运行时行为约束，设置页给出对应提示。

## 6. 生效链路

### 6.1 替换语义

生效时替换系统提示词的**身份段**：

| 系统消息       | 现状（默认）                                                                    | 启用自定义后                                                                              |
| -------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| ① `cli_prefix` | `You are ZCode, an interactive coding agent`                                    | **不再发出**                                                                              |
| ② stable body  | 身份声明 + 安全行 + `# Harness`（+ Desktop 契约）                               | **换成用户配置正文**（+ Desktop 契约）                                                    |
| ③ dynamic      | Communicating / Session guidance / Environment / Context management / gitStatus | 由 `injectDynamic` 决定：`true` 原样保留；`false` 整段不发出（开关未开功能时恒为 `true`） |
| meta-user 附件 | skills 清单、`# agentsMd` + `# currentDate`                                     | 原样保留                                                                                  |

两个可预期的结构性后果，实现时按此验收：

- 系统消息由 3 条变成 2 条（①被并入②），Anthropic 侧的缓存断点相应由 3 个变成 2 个。
- 自定义正文落在 stable 段（`source: "identity"`），因此仍带 `cacheControl: ephemeral`，缓存语义不变。

### 6.2 优先级

| 场景                                        | 行为                                                      |
| ------------------------------------------- | --------------------------------------------------------- |
| `workflowActor` 在场（动态工作流子代理）    | 忽略 identityPreset；身份由工作流契约提供                 |
| `subagentContext` 在场（内置子代理）        | 走 `SubagentContextBuilder`，不涉及 identity 段，天然忽略 |
| `customSystemPrompt` 在场（宿主程序化注入） | 忽略 identityPreset，宿主意图优先（**不抛错**）           |
| 以上都不在且配置启用                        | 替换 ①②                                                   |
| 配置未启用 / 解析失败 / 文件缺失            | 与现状逐字节一致                                          |

不采用「两者同时在场即抛错」的原因：工作流子进程会继承父会话的 `runtimeConfig`（`script-workflow-child-runtime.ts` 的 spread），而工作流脚本的 `opts.systemPrompt` 可能同时在场——抛错会把正常的继承路径变成崩溃。

### 6.3 生效时机

- 端口在 `ensureContextInitialized`（`runtime/methods/context.ts`）被 await 一次，结果写入 App 级 `config.identityPreset` 并随之冻结；`rebuildContextPrefix` 每轮读到的是同一份。
- **只对新建会话生效**。既有会话中途换配置会改变 prompt cache 前缀、破坏「前缀在会话内不可变」的既定不变量，因此不做热切换。设置页在开关与配置列表处明示「对新会话生效」。
- 设置页保存后不需要重启应用：用户下一次新建对话即生效。

## 7. 上游接线点与标记清单

| 文件                                                          | 位置                                                                                               | 改动                                                                                                                                          |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/index.ts`                                | 导出块                                                                                             | 导出 fork 契约                                                                                                                                |
| `apps/zcode-cli/packages/core/src/runtime/types.ts`           | `AgentRuntimeDeps` 的 port 定义区（`contextSourcePort` 邻近）；解析结果字段在 `AgentRuntimeConfig` | **端口只声明在 deps**：`identityPresetPort?: IdentityPresetPort`；`identityPreset?: ResolvedIdentityPreset`（纯数据）留在 config，随 App 冻结 |
| `apps/zcode-cli/packages/core/src/runtime/internal.ts`        | `AgentRuntimeInternal` 字段                                                                        | 镜像 deps 端口字段（供构造函数一次性转存）                                                                                                    |
| `apps/zcode-cli/packages/core/src/runtime/agent-runtime.ts`   | 导入 + 私有字段 + 构造函数                                                                         | `this.identityPresetPort = deps.identityPresetPort`（唯一消费点是 `ensureContextInitialized`）                                                |
| `apps/zcode-cli/packages/core/src/runtime/methods/context.ts` | `ensureContextInitialized`                                                                         | await 端口一次并写入 config；`createContextBuilderFromSnapshot` 下传                                                                          |
| `apps/zcode-cli/packages/core/src/context/types.ts`           | `ContextBuilderConfig`                                                                             | 新增 `identityPreset?: ResolvedIdentityPreset`                                                                                                |
| `apps/zcode-cli/packages/core/src/context/builder.ts`         | 第 1、2 段（`:100-122`）                                                                           | 有自定义身份时跳过 `buildCliPrefixSection()`，第 2 段改 push 自定义身份段                                                                     |
| `apps/zcode-cli/packages/bootstrap/src/app/create-app.ts`     | 端口装配处（`contextSourcePort` 邻近）                                                             | 构造 file-backed `identityPresetPort`                                                                                                         |
| `apps/zcode-cli/packages/bootstrap/src/app/types.ts`          | `ZCodeAppOptions` 的 port 覆盖位（`contextSourcePort` 邻近）                                       | `identityPresetPort?: IdentityPresetPort`（测试与宿主注入点）                                                                                 |
| `apps/zcode-cli/packages/core/src/index.ts`                   | 公开入口                                                                                           | 导出 `./fork/identity-preset/index.js`                                                                                                        |
| `packages/services/src/index.ts`                              | 公开入口                                                                                           | 导出 `IForkIdentityPresetService`                                                                                                             |
| `packages/services/src/accessor.ts`                           | 服务面                                                                                             | 注册访问器条目                                                                                                                                |
| `packages/client/src/remoteServiceAccess.ts`                  | 远程访问表                                                                                         | 注册同一条目                                                                                                                                  |
| `packages/desktop/src/host/index.ts`                          | 晚注册点                                                                                           | 注册 fork 系统指令服务                                                                                                                        |
| `packages/ui/src/lib/settingsNavigation.ts`                   | section id 联合类型 + `isSettingsSectionId`                                                        | 新增 `systemInstructions`（**同时修 `configSync` 漏守卫**）                                                                                   |
| `packages/ui/src/settings/settingsPageConfig.ts`              | `agentCapabilities` 组                                                                             | 新增导航项                                                                                                                                    |
| `packages/ui/src/SettingsPage.tsx`                            | 导入 + 渲染分支                                                                                    | 挂载 fork 栏目                                                                                                                                |
| `packages/ui/src/i18n/locales/{zh-CN,en-US}.ts`               | 文案                                                                                               | `settings.systemInstructions.*` 两份同步                                                                                                      |
| `packages/shared/src/test-ids.ts`                             | testid 常量                                                                                        | 新增 `TID_SETTINGS_SYSTEM_INSTRUCTIONS_*`                                                                                                     |
| `packages/desktop/src/host/index.ts`（同文件第二次）          | WebDAV 装配                                                                                        | 传入 presets 目录                                                                                                                             |

上述 10 行属**第 1 期已交付**（`create-app.ts` 与 `runtime/**` 四个文件按端口惯例落地，端口在 `AgentRuntimeDeps`）；其余行是第 2、3 期的计划接线点，尚未实施。第 1 期实测标记总数为 10 个上游文件、30 行标记（16 单行 + 7 对；`rg` 自查口径，另有 2 行出现在本文档与实施计划中，属说明性文字）。

fork 内部既有文件（自己新增、非上游）也要改的地方：`packages/shared/src/fork/webdav-contract.ts`、`packages/desktop/src/host/fork/webdav/{backup-archive,local-snapshot,sync-engine,service}.ts`（见第 9 节第 3 期）。

## 8. 接口

服务通道：`FORK_IDENTITY_PRESET_CHANNEL = "fork-identity-preset"`；UI 只经此访问：

```ts
interface IForkIdentityPresetService {
  getState(): Promise<IdentityPresetState>; // { enabled, activeId, root, profiles: IdentityPresetSummary[] }
  setEnabled(enabled: boolean): Promise<IdentityPresetState>;
  setInjectDynamic(injectDynamic: boolean): Promise<IdentityPresetState>;
  createProfile(input: {
    name: string;
    template: "default" | "skeleton";
  }): Promise<IdentityPresetState>;
  readProfile(id: string): Promise<IdentityPresetProfile>; // { id, name, content }
  saveProfile(input: { id: string; name: string; content: string }): Promise<IdentityPresetState>;
  deleteProfile(id: string): Promise<IdentityPresetState>;
  activateProfile(id: string | null): Promise<IdentityPresetState>;
  /** 状态变化订阅。属性式 Event：渲染层用 `service.onStateChanged(listener)`。 */
  onStateChanged: Event<IdentityPresetState>;
}
```

删除正在激活的配置时，服务在同一事务内把 `activeId` 置空（`enabled` 保持不变），并在返回状态里带 `activeMissing: true` 供 UI 提示。

agent 侧端口（第 1 期交付形态——读盘诊断随 outcome 返回，端口自身不记日志）：

```ts
interface IdentityPresetLoadOutcome {
  preset?: ResolvedIdentityPreset;
  /** 非致命诊断（状态文件损坏或不被识别 / 配置目录不可读 / activeId 悬空），由 runtime 记 warn。 */
  diagnostic?: string;
}
interface IdentityPresetPort {
  loadActive(): Promise<IdentityPresetLoadOutcome>;
}
interface ResolvedIdentityPreset {
  id: string;
  name: string;
  content: string;
}
```

core 的 fork 模块对外只暴露一个函数，供 `builder.ts` 使用：

```ts
function buildIdentityPresetSection(preset: ResolvedIdentityPreset): ContextSection;
// 返回 { name: "Agent Identity", source: "identity", injectionTarget: "system",
//        cacheHint: "stable", chars, tokens, preview } —— 与 identity.ts 逐字段同构
```

## 9. 实施分期

每期结束都应可运行、可验收：

1. **内核期**：共享契约与模板常量、core fork 模块（解析 + 端口 + 身份段构造）、bootstrap 端口装配、`builder.ts` 接线。验收场景 1–4；不涉及 UI 与同步。
2. **服务与设置页期**：fork 系统指令服务（文件 CRUD、`active.json`、路径校验、事件）、访问层接线、设置页「系统指令」栏目（开关、列表、新建、编辑、删除、激活）、i18n、test-ids。验收场景 5–10。
3. **同步期（已完成）**：`presets/` 纳入 WebDAV 备份包——契约新增 entry 名与 `ForkWebdavPresetsSnapshot`、`buildBackupZip` / `readBackupZip`、内容哈希纳入正文、恢复写盘（目录级覆盖 + 条目名校验）、`CreateForkWebdavServiceOptions` 与宿主装配新增 `presetsDir`。验收场景 11–13 已由 `packages/desktop/test/forkWebdavPresets.test.ts` 覆盖。

## 10. 验收场景

1. 开关关闭（默认）→ 系统提示词与现状逐字节一致：3 条 system 消息、第一条仍是 `You are ZCode, an interactive coding agent`。
2. 开启并激活某配置 → 新会话第一条 system 消息即用户内容，不再是 `cli_prefix`；第三条仍含 `# Environment` 与 `gitStatus`。
3. 禁用 / 删除 / `active.json` 损坏 → 回退系统默认，应用可正常使用，日志有 `warn`。
4. 工作流子代理与内置子代理的身份不因本功能改变。
   4.1 关闭「注入动态提示词」后，新会话的 system 消息只剩一条（身份段 + Desktop Context）：不含 `# Environment`、`# Context management`、gitStatus；重新打开后恢复为两条。
5. 设置 → Agent 能力 → 系统指令：可开关；列表显示全部配置及当前激活项。
6. 新建配置选「默认」模板 → 编辑器预填当前身份段原文；保存后若未激活，提示词不变。
7. 新建配置选「基础框架」模板 → 预填四小节骨架 + 安全行；可自由编辑保存。
8. 编辑并保存 → 文件写盘（frontmatter 的 `name` 与正文同步），列表名称随之更新。
9. 激活配置 → `active.json` 的 `activeId` 更新；新会话生效。
10. 删除正在激活的配置 → 转为系统默认并给出提示；其余配置与开关状态不变。
11. 在 A 机新建配置并激活 → 备份包内出现 `presets/` 内容；B 机恢复后能看到同一批配置与激活状态。
12. 旧版本备份包（无 `presets/` entry）恢复 → 本地 presets 目录**不被清空**（视为该备份未包含该资源），其余恢复行为不变。
13. 备份包内含越界路径（如 `presets/../../x.md`）→ 恢复时被拒绝并记 `warn`，不写出目录外文件。

## 11. 测试与验证策略

- 纯逻辑单测（node native，`pnpm exec tsx --test`）：
  - frontmatter 解析与序列化往返、缺 `name` / 空正文 / 非法 id 的拒绝；
  - `active.json` 解析：缺失、损坏、未知 `schemaVersion`、`activeId` 悬空；
  - 身份段构造：`source` / `cacheHint` / `chars` / `tokens` / `preview` 与 `identity.ts` 同算法；
  - 模板常量与 `buildIdentitySection()` 的一致性断言（防止上游改文案后模板漂移）；
  - `builder.ts` 的三种组合：仅自定义、自定义 + Desktop 契约、自定义 + `customSystemPrompt`（后者应忽略自定义）。
- host 服务单测：CRUD 往返、删除激活项、路径校验（拒绝 `..`、绝对路径、非法 id）。
- WebDAV 单测（扩展既有 `packages/desktop/test/forkWebdav*.test.ts`）：含 presets 的打包/解包往返、哈希纳入、无 presets 的旧包恢复不清空本地、越界路径拒绝。
- 交互：`pnpm dev:desktop` 手工走完第 10 节场景；必要时用既有 CDP + playwright-core 方式断言渲染结果。
- 每期结束执行 `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check`，并核对 `rg -n "FORK\(" ` 与第 7 节接线表一致。

## 12. 风险与边界

1. **镜像文本漂移**：`default` 模板与 `identity.ts` 是镜像关系（host 无法 import `@zcode/core`），上游改文案后模板会滞后。影响仅限「新建配置的起点略旧」，用一致性单测兜住。
2. **`# Harness` 丢失**：选择自定义身份即不再收到 Harness 里的运行时行为约束（markdown 渲染、权限拒绝语义、hook 语义、工具偏好、`file:line` 引用）。这是「身份完全由用户决定」的必然代价，已在设置页明示；`default` 模板包含它，`skeleton` 不含。
3. **storage.dir 自定义**：v1 按默认 `~/.zcode` 解析。若用户在 `~/.zcode/cli/config.json` 改了 `storage.dir`，host 与 agent 两侧必须用同一规则解析（见 5.1），实现时以 `~/.zcode/agents` 的既有行为为准对齐；两侧解析不一致会导致「UI 看得见、agent 读不到」。
4. **备份包体积**：presets 是纯文本，纳入 zip 后体积可忽略；但恢复是整目录覆盖，用户在同名文件上的并发编辑会被远端版本覆盖——本期不做合并，与 `provider_config.json` 的既有取舍一致。
5. **上游漂移**：第 1 期接线点为 10 个上游文件、30 行标记（见第 7 节），其中 `context/builder.ts`、`runtime/methods/context.ts`、`runtime/types.ts` 位于 core 提示词主链路；第 2、3 期还要动 UI 设置页与 WebDAV 打包链路。冲突时按二开标准的冲突阶梯处理，优先把逻辑迁回 `core/src/fork/identity-preset/**`。
6. **`configSync` 漏守卫**：`packages/ui/src/lib/settingsNavigation.ts` 的 `isSettingsSectionId` 未包含 fork 上次加的 `configSync`，导致持久化的「上次所在栏目」无法恢复。本功能顺手修复，属既有缺陷，随本期提交并在「其他更新」登记。
7. **不做热切换**：用户在设置页保存后若不新建会话会看不到变化。设置页文案必须明确，否则会被当成 bug 反馈。
