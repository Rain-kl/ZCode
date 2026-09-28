# 系统指令（identity-preset）第 2 期：宿主服务与设置页 —— 实施计划

> **给执行者：** 用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 逐任务执行。步骤用 `- [ ]` 跟踪。
> 第 1 期（内核）已完成并通过最终整包审查（提交 `6d0e3d7..79f7421`，报告见 `.superpowers/sdd/implementation-plan/progress.md`）。本期只做宿主服务与设置页 UI；WebDAV 同步是第 3 期。

**目标**：让用户在 **设置 → Agent 能力 → 系统指令** 里开关自定义指令、创建/编辑/删除多组提示词配置、选一组激活，并在详情区看到「对新会话生效」的说明。

**架构**：宿主侧新增一个 fork 服务承担 `~/.zcode/presets/` 的**唯一写入口**（agent 侧只读，第 1 期已实现）；渲染层经 `IServiceAccessor` 访问该服务，UI 组件放 `packages/ui/src/fork/identity-preset/**`。

**技术栈**：TypeScript / Electron host 服务 / React + Zustand / node:test + tsx。

## 全局约束

- 设计依据：`docs/features/identity-preset/design.md`（第 5、8 节为本期契约）。偏差记入 `docs/features/identity-preset/implementation.md`。
- 上游文件（`packages/**` 与 `apps/zcode-cli/**` 里**已存在**的文件）每一处改动必须带 `FORK(identity-preset)` 标记；连续多行用 `FORK-BEGIN/END`。新增文件不需要标记。
- 契约与常量**只从** `@zcode/shared` 的 `fork/identity-preset-contract.ts` 取（`FORK_IDENTITY_PRESET_*`），不要在新代码里写 `"presets"`、`"profiles"`、`"active.json"`、`".md"` 字面量。
- 不新增第三方依赖、不新建 workspace 包。
- 提交遵循 Conventional Commits，只 `git add` 本任务显式改动的文件，禁止 `git add .` / `git commit -a`，禁止推送。
- 工作区有他人施工文件，**绝对不要碰**：`packages/desktop/src/main/**`、`packages/desktop/src/fork/**`、`packages/desktop/test/forkGithubUpdateFeed.test.ts`、`docs/features/github-update/**`、`.zcodeignore`、`mise.toml`、`MERGE_GUIDE.md`、`scripts/run-unit-tests.mjs`、`packages/desktop/src/scheduler/**`。
- 测试在**仓库根目录**执行：`pnpm exec tsx --test <file>`。`apps/zcode-cli` 下的 typecheck 需 `PATH="/Users/ryan/Code/Node/ZCode/node_modules/.bin:$PATH" pnpm --dir apps/zcode-cli typecheck`（该目录的 turbo 未链接，属既有环境缺陷）；根 `pnpm typecheck` 正常。
- 每期结束执行 `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed`，并对本功能文件跑 `node node_modules/.bin/oxfmt --check`（仓库整体 fmt 有约 45 个既有失败文件，与本功能无关）。

## 第 1 期最终审查留下的硬性要求（本期必须逐条满足）

1. **写入方绝不覆盖已有配置**：派生 id 可能撞名（`"a b"` 与 `"a-b"` 都得 `a-b`）。`createProfile` 必须分配空闲 id：`createForkIdentityPresetId(name, takenIds?)` 的第二个参数为已占用集合，冲突时追加 `-2`、`-3`；拿不到空闲 id 就以可读错误拒绝。**静默覆盖是数据丢失，禁止。**
2. **序列化前归一化名称**：`serializeIdentityPresetFile` 自身不归一化，含换行的名称会破坏 frontmatter；写入前必须过 `normalizeForkIdentityPresetName`。
3. **Windows 保留设备名**：`nul`、`con`、`prn`、`aux`、`com1..9`、`lpt1..9` 是合法 id 但在 Windows 不可写；写入失败要呈现可读错误，不能抛原始 `EPERM`。
4. **正文长度上限**：预设正文逐字进入每次模型请求，写入前设上限（建议 200 000 字符，常量放契约）。
5. **原子写入**：`active.json` 与 profile 文件都走 temp + rename（先写 `*.tmp` 再 `rename`），避免半写状态让每次会话启动都告警。
6. **e2e 断言冻结不变量**：验收必须断言「一次会话只读一次，且请求体第一条 system 消息就是被激活的预设」，不能只验「开关能用」。

---

## 文件结构

**新增：**

| 文件 | 职责 |
| --- | --- |
| `packages/services/src/fork/identityPreset.ts` | `IForkIdentityPresetService` 接口 + 描述符（通道 `fork-identity-preset`） |
| `packages/desktop/src/host/fork/identity-preset/profile-store.ts` | 纯文件层：列出/读/原子写/删 profile，读写 `active.json`，id 分配，名称归一化，长度与平台名校验 |
| `packages/desktop/src/host/fork/identity-preset/service.ts` | 服务实现：把 store 暴露成 RPC 面 + 状态事件广播 |
| `packages/desktop/src/host/fork/identity-preset/index.ts` | 该目录唯一入口（`createForkIdentityPresetService`） |
| `packages/desktop/test/forkIdentityPresetStore.test.ts` | store 单测（新增） |
| `packages/desktop/test/forkIdentityPresetService.test.ts` | service 单测（新增） |
| `packages/ui/src/fork/identity-preset/useForkIdentityPreset.ts` | 渲染层控制器：订阅服务、维护本地草稿与 busy 状态 |
| `packages/ui/src/fork/identity-preset/SystemInstructionsSection.tsx` | 设置页栏目：开关、配置列表、编辑器、模板选择、删除/激活 |
| `packages/ui/src/fork/identity-preset/index.ts` | 该目录唯一入口 |

**修改（上游文件，逐处 `FORK(identity-preset)`）：**

| 文件 | 改动 |
| --- | --- |
| `packages/services/src/index.ts` | 导出 `IForkIdentityPresetService` |
| `packages/services/src/accessor.ts` | 注册访问器条目 |
| `packages/client/src/remoteServiceAccess.ts` | 注册远程访问条目 |
| `packages/desktop/src/host/index.ts` | 晚注册点注册服务 |
| `packages/ui/src/lib/settingsNavigation.ts` | section id 联合类型 + `isSettingsSectionId`；**同时补 `configSync` 漏守卫** |
| `packages/ui/src/settings/settingsPageConfig.ts` | `agentCapabilities` 组新增导航项 |
| `packages/ui/src/SettingsPage.tsx` | 导入 + 渲染分支 |
| `packages/ui/src/i18n/locales/zh-CN.ts` / `en-US.ts` | `settings.systemInstructions.*` 文案，两份同步 |
| `packages/shared/src/test-ids.ts` | `TID_SETTINGS_SYSTEM_INSTRUCTIONS_*` 常量（含中文注释） |

---

## Task 1: 宿主文件层（profile-store）

**Files:**
- Create: `packages/desktop/src/host/fork/identity-preset/profile-store.ts`
- Test: `packages/desktop/test/forkIdentityPresetStore.test.ts`

**Interfaces（Produces）：**

```ts
export interface IdentityPresetStore {
  list(): Promise<ForkIdentityPresetSummary[]>;
  read(id: string): Promise<ForkIdentityPresetProfile>;
  readState(): Promise<ForkIdentityPresetStateFile>;
  /** 名称已归一化、id 已分配空闲值；返回新状态。 */
  create(input: { name: string; template: ForkIdentityPresetTemplateId }): Promise<void>;
  save(input: { id: string; name: string; content: string }): Promise<void>;
  delete(id: string): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  activate(id: string | null): Promise<void>;
  root: string;
}
export function createFileIdentityPresetStore(input: { root: string }): IdentityPresetStore;
```

**要求：**
- 模板常量取自 `@zcode/shared`（`FORK_IDENTITY_PRESET_DEFAULT_TEMPLATE` / `_SKELETON_TEMPLATE`）。
- `create` 用「已占用集合」版 id 分配，绝不覆盖；`save` 先归一化名称、校验长度上限、再原子写。
- 目录不存在时 `create` 才 `mkdir -p`；读取路径沿用第 1 期「缺失=未启用」语义。
- Windows 保留名与写入失败都转成带文件名的可读错误（自定义 Error 子类或带 code 的错误），不泄漏原始 errno。

- [ ] **Step 1: 写失败测试**（覆盖：创建-列出-读取往返；同名创建得到不同 id 且旧文件不被改；超长正文被拒；含换行的名称被归一化后写入；`active.json` 原子性=写入后无 `.tmp` 残留；删除激活项后 `activeId` 置空）
- [ ] **Step 2: 跑测试确认失败**（`pnpm exec tsx --test packages/desktop/test/forkIdentityPresetStore.test.ts`）
- [ ] **Step 3: 实现 profile-store.ts**
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交**（`feat(identity-preset): 宿主侧配置存储与 id 分配`）

## Task 2: fork 服务面与宿主实现

**Files:**
- Create: `packages/services/src/fork/identityPreset.ts`、`packages/desktop/src/host/fork/identity-preset/{service,index}.ts`
- Test: `packages/desktop/test/forkIdentityPresetService.test.ts`

**Interfaces（Produces）：** 与设计 §8 一致的服务面：

```ts
export interface IForkIdentityPresetService {
  getState(): Promise<ForkIdentityPresetState>;
  setEnabled(enabled: boolean): Promise<ForkIdentityPresetState>;
  createProfile(input: { name: string; template: ForkIdentityPresetTemplateId }): Promise<ForkIdentityPresetState>;
  readProfile(id: string): Promise<ForkIdentityPresetProfile>;
  saveProfile(input: { id: string; name: string; content: string }): Promise<ForkIdentityPresetState>;
  deleteProfile(id: string): Promise<ForkIdentityPresetState>;
  activateProfile(id: string | null): Promise<ForkIdentityPresetState>;
  /** 属性式 Event：渲染层用 `service.onStateChanged(listener)`。 */
  onStateChanged: Event<ForkIdentityPresetState>;
}
export const IForkIdentityPresetService = createServiceDescriptor<IForkIdentityPresetService>(FORK_IDENTITY_PRESET_CHANNEL);
```

- `getState()` 组装 `{ enabled, activeId, activeMissing, root, profiles }`，`activeMissing` 由第 1 期的 `resolveActiveIdentityPreset` 语义推导（enabled 为真但目标缺失/为空）。
- 每个写操作后广播 `onStateChanged`；事件必须在状态写入**之后**发出，避免 UI 看到旧值。

- [ ] **Step 1: 写失败测试**（覆盖：`getState` 的 `activeMissing`；删除激活项后 state 的 `activeId` 为 null 且 `enabled` 不变；写操作触发一次 `onStateChanged` 且载荷等于新 state）
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现服务与描述符**
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交**（`feat(identity-preset): fork 系统指令服务面与宿主实现`）

## Task 3: 访问层接线

**Files（全部是上游文件，逐处标记）:** `packages/services/src/index.ts`、`packages/services/src/accessor.ts`、`packages/client/src/remoteServiceAccess.ts`、`packages/desktop/src/host/index.ts`

- 照 `IForkWebdavService` 的既有接法逐条对齐（第 1 期 local-mode 的四个接线点即模板）。
- 宿主注册点在 `packages/desktop/src/host/index.ts` 的晚注册区，与 fork WebDAV 服务相邻；端口根目录用与 agent 侧同一规则解析（`storage root`，不是 `cliStorageRoot`）。

- [ ] **Step 1: 接线并让 `pnpm typecheck` 通过**
- [ ] **Step 2: 用假 store 驱动一次服务调用**（在 `forkIdentityPresetService.test.ts` 追加一条「经 accessor 面可调用」的冒烟，或如实说明该层由 typecheck 覆盖）
- [ ] **Step 3: 提交**（`feat(identity-preset): 访问层接线`）

## Task 4: 设置页「系统指令」栏目

**Files:**
- Create: `packages/ui/src/fork/identity-preset/{useForkIdentityPreset.ts,SystemInstructionsSection.tsx,index.ts}`
- Modify: `packages/ui/src/lib/settingsNavigation.ts`、`packages/ui/src/settings/settingsPageConfig.ts`、`packages/ui/src/SettingsPage.tsx`

**要求：**
- 新 section id：`systemInstructions`，加入 `settingsNavigation.ts` 的联合类型**和** `isSettingsSectionId`（并补 `configSync`）。
- 导航项放 `agentCapabilities` 组，文案 key `settings.systemInstructions.title`。
- 组件骨架复用既有件：`SettingsGroupCard` / `SettingsRow`（`packages/ui/src/settings/SettingsPageParts.tsx`）、列表与编辑器参照 `SubagentsSection.tsx` 的交互（新建/编辑/删除/开关）。
- 服务经 `useBaseWorkspaceServices()` 取（与 `ConfigSyncPanel` 同法）；不要直接调 `window.zcode`。
- 必须呈现的行为：总开关；配置列表（含当前激活标记）；新建时选模板（默认 / 基础框架）；编辑器可改名称与正文；保存/删除/激活；**「对新会话生效」的明确提示**；删除正在激活的配置时给提示并回退系统默认。

- [ ] **Step 1: 接线导航与渲染分支**（先让空栏目出现在侧栏，`pnpm dev:desktop` 肉眼确认）
- [ ] **Step 2: 实现 hook 与组件**
- [ ] **Step 3: 手工走验收场景 5–10**（见第 10 节；必要时用既有 CDP + playwright-core 断言 test-id）
- [ ] **Step 4: 提交**（`feat(identity-preset): 设置页系统指令栏目`）

## Task 5: i18n、test-ids 与文档回写

**Files:** `packages/ui/src/i18n/locales/{zh-CN,en-US}.ts`、`packages/shared/src/test-ids.ts`、`FEATURES.md`、`docs/features/identity-preset/implementation.md`

- `settings.systemInstructions.*` 两份同步（导航标题、开关、列表为空、新建、模板、名称、正文、保存、删除确认、激活、生效提示、删除激活项的提示）。
- test-ids 至少覆盖：栏目导航项、总开关、列表行、新建按钮、模板选择、保存按钮、删除按钮、激活按钮。
- `FEATURES.md` 的 identity-preset 条目状态更新为「第 1、2 期完成；第 3 期（同步）待实施」。
- `configSync` 守卫修复登记到 `FEATURES.md` 的 `## 其他更新`（一行：日期 + 简述 + 文件）。

- [ ] **Step 1: 补文案与 test-ids**
- [ ] **Step 2: 回写 FEATURES.md 与 implementation.md（含与设计的偏差、验收证据）**
- [ ] **Step 3: 全量检查**（`pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed`、本功能文件 `oxfmt --check`；`rg -n "FORK\(" ` 自查与文档一致）
- [ ] **Step 4: 提交**（`docs(identity-preset): 回写第 2 期实现记录与文案`）

---

## 验收场景（对应设计 §10 的 5–10）

5. 设置 → Agent 能力 → 系统指令：可开关；列表显示全部配置及当前激活项。
6. 新建选「默认」模板 → 编辑器预填当前身份段原文；保存后若未激活，提示词不变。
7. 新建选「基础框架」模板 → 预填四小节骨架 + 安全行；可自由编辑保存。
8. 编辑并保存 → 文件写盘（frontmatter 的 `name` 与正文同步），列表名称随之更新。
9. 激活配置 → `active.json` 的 `activeId` 更新；**新会话**第一条 system 消息即用户内容（用第 1 期的冒烟方法在模型请求体上核对）。
10. 删除正在激活的配置 → 转为系统默认并给出提示；其余配置与开关状态不变。

## 风险与边界

1. **写入方与 agent 读取方的路径必须同源**：宿主解析 `storage root` 的规则要与 bootstrap 一致（`~/.zcode`，不是 `~/.zcode/cli`），否则表现为「UI 看得见、agent 读不到」。Task 3 落地后立刻用一个真实配置端到端核对。
2. **不做热切换**：保存后不新建会话看不到变化，UI 必须明说（第 1 期设计 §6.3）。
3. **Windows 与自定义 `storage.dir`** 的边界同上；本期只保证默认路径下的行为，异常路径给出可读错误。
4. **`IServiceAccessor` 接线是上游高频改动区**：冲突时按二开标准的冲突阶梯处理，优先把逻辑收回 `packages/*/src/fork/**`。
