# 系统指令：用户自定义提示词（identity-preset）实现文档

> 状态：**第 1 期（内核）完成；第 2、3 期未实施**（见第 6 节，范围定义在 `implementation-plan.md` 的「后续计划」）。
> 设计依据：`docs/features/identity-preset/design.md`；实施计划：`docs/features/identity-preset/implementation-plan.md`。
> 本期提交：`6d0e3d7` → `915aa23`（契约 `6d0e3d7` / `5cca485` / `c1bbb15`；core `c864f7f` / `bb218a6` / `047419b` / `521192d` / `d6d71df` / `6198bb4` / `6070131`；bootstrap `915aa23`），另有文档提交 `29a0f02`（设计）、`c144080`（计划）、`f161150`、`7f2b029`（计划同步）。全部为本地提交，未推送。

## 1. 落地位置

新增文件全部落在 fork 边界内（新文件不产生逐行冲突面）：

| 文件                                                                                | 职责                                                                                                                                                                              |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/fork/identity-preset-contract.ts`（187 行）                    | 三方共用契约：通道名、目录/文件名常量、id 与名称规则、`active.json` 解析、`default` / `skeleton` 两个模板常量                                                                     |
| `apps/zcode-cli/packages/core/src/fork/identity-preset/profile-file.ts`（43 行）    | 单个 `.md` 的 frontmatter（`name`）解析与序列化；不引入 YAML 解析器，坏输入回退文件名 stem                                                                                        |
| `apps/zcode-cli/packages/core/src/fork/identity-preset/identityManager.ts`（44 行） | `buildIdentityPresetSection`：把用户正文构造成与 `context/sections/identity.ts` 同构的 `ContextSection`；`resolveActiveIdentityPreset`：开关 + activeId + 配置集合 → 生效的那一份 |
| `apps/zcode-cli/packages/core/src/fork/identity-preset/file-port.ts`（155 行）      | 只读端口 `createFileIdentityPresetPort({ root })`：读 `active.json` + `profiles/<id>.md`，任何异常都转成 `diagnostic`，绝不抛出                                                   |
| `apps/zcode-cli/packages/core/src/fork/identity-preset/index.ts`（7 行）            | 该目录唯一公开入口，re-export 上面三个模块                                                                                                                                        |
| `packages/shared/test/forkIdentityPresetContract.test.ts`（116 行）                 | 契约层单测：id 规则与派生不变量、名称校验、状态文件容错、模板常量                                                                                                                 |
| `apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts`（200 行）            | 解析 / 身份段构造 / 模板一致性 / 端口降级矩阵单测                                                                                                                                 |
| `apps/zcode-cli/packages/core/test/forkIdentityPresetContext.test.ts`（67 行）      | `ContextBuilder` 集成：system 消息形态与三条让位路径                                                                                                                              |

未新增第三方依赖，未新建 workspace 包。

## 2. 关键改动

### 2.1 替换语义：3 条 system 消息变成 2 条

启用并命中配置时，`context/builder.ts` 的第 1、2 段分流（`builder.ts:101-113`、`:128-130`）：

| 系统段         | 未启用（改动前）                                                                | 启用后               |
| -------------- | ------------------------------------------------------------------------------- | -------------------- |
| ① `cli_prefix` | `You are ZCode, an interactive coding agent`                                    | **不再发出**         |
| ② stable body  | 身份声明 + 安全行 + `# Harness`                                                 | **换成用户配置正文** |
| ③ dynamic      | Communicating / Session guidance / Environment / Context management / gitStatus | 原样保留             |

- 用户正文所在 section 沿用 `source: "identity"`、`cacheHint: "stable"`（由 `buildIdentityPresetSection` 保证），因此仍带 `cacheControl: ephemeral`，缓存语义不变——只是缓存断点由 3 个变成 2 个。沿用既有 `source` 是因为下游（缓存分层、context 用量统计、恢复快照）都按 `source` 分流，换新 source 会让这些地方各漏一路。
- `# Harness` 随身份段一起消失是「身份完全由用户决定」的必然结果：`default` 模板含它，`skeleton` 不含（设计 §5.4 与风险 2）。

`forkIdentityPresetContext.test.ts` 用 `systemMessages.length` 把这条钉住：未启用 = 3 条且第一条仍是 `cli_prefix`，启用 = 2 条且第一条即用户正文、第三条仍含动态段。

### 2.2 优先级门禁

`customIdentity` 只在「非工作流子代理且无 `customSystemPrompt`」时取 `config.identityPreset`，让位不抛错（设计 §6.2）：

| 场景                                        | 行为                                                            |
| ------------------------------------------- | --------------------------------------------------------------- |
| `workflowActor` 在场（动态工作流子代理）    | 忽略自定义身份，身份由工作流契约提供                            |
| `customSystemPrompt` 在场（宿主程序化注入） | 忽略自定义身份，宿主意图优先（**不抛错**）                      |
| `subagentContext` 在场（内置子代理）        | 走 `SubagentContextBuilder`，构造时提前返回，不涉及 identity 段 |
| 以上都不在且配置启用                        | 替换 ①②                                                         |
| 配置未启用 / 解析失败 / 文件缺失            | 与改动前逐字节一致                                              |

不采用「两者同时在场即抛错」的原因：工作流子进程会继承父会话的 `runtimeConfig`，抛错会把正常的继承路径变成崩溃（设计 §6.2）。

### 2.3 每 App 只读一次盘

`runtime/methods/context.ts:68-83` 的 `ensureContextInitialized`：`this.identityPresetPort` 在场时 `await loadActive()` 一次，结果写入 App 级 `this.config.identityPreset` 并随之冻结；有 `diagnostic` 时记 `warn`（`event: identity_preset.load.failed`，`module: core.runtime`）。随后 `createContextBuilderFromSnapshot`（`:153`）把这份结果下传给 `ContextBuilderConfig.identityPreset`，每个 model step 的 context 重建读到的都是同一份。由此：

- 会话中途改配置不改变已启动会话，本功能只对**新建会话**生效（设计 §6.3，不做热切换）；
- 端口缺席（未装配）即不启用，行为与改动前一致。

### 2.4 读盘、降级与装配位置

磁盘布局 `<storageRoot>/presets/{active.json, profiles/<id>.md}`，`storageRoot` 取 `config.storage.dir`（默认 `~/.zcode`，与 `agents/`、`skills/` 同级，**不是** `cliStorageRoot`）。`create-app.ts:749-757` 在 `AgentRuntime` 的 deps 对象里装配 `createFileIdentityPresetPort({ root: join(storageRoot, FORK_IDENTITY_PRESET_ROOT_NAME) })`；`ZCodeAppOptions.identityPresetPort` 可覆盖（测试与同进程嵌入宿主用）。

降级矩阵（全部不抛错；agent 侧只读，不写任何文件）：

| 情况                                                          | 结果       | 诊断            |
| ------------------------------------------------------------- | ---------- | --------------- |
| 目录 / 状态文件不存在（首次使用、关了同步的机器）             | 未启用     | 静默            |
| `active.json` 不是合法 JSON                                   | 未启用     | 有，点名文件    |
| 文件在场但契约不认（schemaVersion / enabled / activeId 非法） | 未启用     | 有，带具体原因  |
| `enabled: false` 或 `activeId: null`（用户主动关闭）          | 未启用     | 静默            |
| `profiles/` 目录不可读                                        | 未启用     | 有，带 errno 码 |
| activeId 悬空 / 命中配置正文 trim 后为空                      | 未启用     | 有              |
| 单个配置文件读失败                                            | 跳过该文件 | 有（同上）      |

「静默」与「有诊断」的分界写进了 `file-port.ts` 的函数注释：缺失与主动关闭不记日志，文件在场却读不懂必须留 `warn`，否则用户只看到「配置莫名不生效」而日志里什么都没有。契约刻意把「缺失」与「损坏」归零成同一份 fallback，调用方不得据此覆写用户文件。

### 2.5 契约、id 派生与模板

- id 规则 `^[a-z0-9-]{1,50}$`，文件名 stem 即 id；`createForkIdentityPresetId` 的三条不变量由测试固定：纯 ASCII 且 slug 非空 → 干净可读的 slug；含非 ASCII 或 slug 为空 → 追加名称 hash 后缀；**任何**能通过 `normalizeForkIdentityPresetName` 的输入都派生合法 id。
- `FORK_IDENTITY_PRESET_PROFILE_EXTENSION = ".md"`：文件名后缀收在契约里，避免各调用点写字面量。
- `FORK_IDENTITY_PRESET_DEFAULT_TEMPLATE` 与 core 的 `buildCliPrefixSection().content + "\n" + buildIdentitySection().content` 逐字节一致，由 `forkIdentityPreset.test.ts` 的镜像断言固定（host 进程无法 import `@zcode/core`，只能靠测试兜住漂移）。

## 3. 上游接线点与标记清单

自查命令（AGENTS.md 规定）：`rg -n "FORK\(|FORK-BEGIN\(" --glob '!AGENTS.md' --glob '!FEATURES.md'`。按该命令逐文件核对，本功能实际接线为 **10 个既有上游文件、30 行标记**（16 个单行 `FORK(...)` + 7 对 `FORK-BEGIN/END`，成对含 BEGIN 与 END 两行）：

| 上游文件（均为既有文件）                                      | 位置（标记行号）                                                              | 标记数        | 落地提交              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------- | --------------------- |
| `packages/shared/src/index.ts`                                | `:246`（紧跟 `fork/webdav-contract.js`）                                      | 1 单行        | `6d0e3d7`             |
| `apps/zcode-cli/packages/core/src/index.ts`                   | `:11-14` 导出块（成对）                                                       | 1 对          | `6198bb4`             |
| `apps/zcode-cli/packages/core/src/context/types.ts`           | `:16` 类型导入（单行）、`:120-124` `ContextBuilderConfig` 字段（成对）        | 1 单行 + 1 对 | `6198bb4`             |
| `apps/zcode-cli/packages/core/src/context/builder.ts`         | `:30` 导入、`:101-111` 门禁块、`:116` 第 1 段、`:133` 第 2 段                 | 3 单行 + 1 对 | `6198bb4`             |
| `apps/zcode-cli/packages/core/src/runtime/types.ts`           | `:113` 导入、`:226-231` config 解析结果（成对）、`:380-383` deps 端口（成对） | 1 单行 + 2 对 | `6198bb4` / `6070131` |
| `apps/zcode-cli/packages/core/src/runtime/internal.ts`        | `:59` 导入、`:99` `AgentRuntimeInternal` 字段                                 | 2 单行        | `6070131`             |
| `apps/zcode-cli/packages/core/src/runtime/agent-runtime.ts`   | `:130` 导入、`:171` 私有字段、`:286` 构造函数转存                             | 3 单行        | `6070131`             |
| `apps/zcode-cli/packages/core/src/runtime/methods/context.ts` | `:68-85` 读取块（成对）、`:155` 下传                                          | 1 单行 + 1 对 | `6198bb4` / `6070131` |
| `apps/zcode-cli/packages/bootstrap/src/app/types.ts`          | `:6` 类型导入、`:170` `ZCodeAppOptions` 端口覆盖点                            | 2 单行        | `915aa23`             |
| `apps/zcode-cli/packages/bootstrap/src/app/create-app.ts`     | `:24` 值导入、`:40` 目录名导入、`:749-757` 装配块                             | 2 单行 + 1 对 | `915aa23`             |

合计 **16 处单行 + 7 组成对（14 行）＝ 30 行标记，覆盖 10 个上游文件**。行号以交付提交后的 `rg -n "FORK-BEGIN\(identity-preset\)"` 输出为准。

对上表的核对结论：

- 计划「文件结构」表原本只列 7 个上游文件；实际多出 3 个——`runtime/internal.ts`、`runtime/agent-runtime.ts`（端口落 `AgentRuntimeDeps` 这一裁决的后果）与 `bootstrap/src/app/types.ts`（`ZCodeAppOptions` 端口覆盖点的计划遗漏）。两处偏差见第 5 节。
- `rg` 的其余 `identity-preset` 命中都在设计/计划文本里（`design.md` 2 行、`implementation-plan.md` 16 行），是标记示例而非上游接线；`MERGE_GUIDE.md` 与 `FORK(local-mode)`、`FORK(github-update)` 的命中属其他条目。该命令在全仓共 118 行，本功能的代码子集为 30 行（16 单行 + 7 对成对标记各两行，逐文件与上表一致），无遗漏、无多余。

## 4. 验证记录

2026-09-28/29 在仓库根目录执行，Node v26.8.1。

### 4.1 单测（三个文件，29 个用例）

```
$ pnpm exec tsx --test packages/shared/test/forkIdentityPresetContract.test.ts
ℹ tests 8  ℹ pass 8  ℹ fail 0
$ pnpm exec tsx --test apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts
ℹ tests 17  ℹ pass 17  ℹ fail 0
$ pnpm exec tsx --test apps/zcode-cli/packages/core/test/forkIdentityPresetContext.test.ts
ℹ tests 4  ℹ pass 4  ℹ fail 0
```

合计 **29 通过 / 0 失败**（计划「本期完成的定义」写的是 16 个用例，实际随各任务修复轮增至 29）。覆盖设计 §10 的验收场景 1–4：

- 场景 1 = `未启用自定义身份时系统提示词与现状一致`（3 条 system 消息）；
- 场景 2 = `启用后第 1 段消失，身份段换成用户内容，动态段保留`（2 条，第一条即用户内容）；
- 场景 3 = 端口四条降级用例 + `schemaVersion 不认识` / `enabled 非布尔值` / `activeId 不符合 id 规则` / `用户主动关闭时不产生诊断`；
- 场景 4 = `工作流子代理身份在场时忽略自定义身份`（内置子代理走 `SubagentContextBuilder`，不涉及 identity 段）。

### 4.2 类型检查

```
$ pnpm typecheck
（tsc -b，无错误输出，exit 0）
$ PATH="/Users/ryan/Code/Node/ZCode/node_modules/.bin:$PATH" pnpm --dir apps/zcode-cli typecheck --force
 Tasks:    27 successful, 27 total
 Cached:   0 cached, 27 total
   Time:   40.01s
exit 0
```

`--dir` 版本无法直接启动（`turbo` 未链接进 `apps/zcode-cli/node_modules/.bin`，属本机陈旧安装的环境缺陷，非本功能引入），故按 PATH 兜底执行；`--force` 是为了绕过 turbo 缓存拿到本次工作区的真实结果。core 的 tsconfig 排除测试文件，`@zcode/core` 的 `tsc --noEmit` 覆盖 `src/fork/identity-preset/**` 与全部接线点，测试文件由 tsx 运行时编译。

### 4.3 Lint 与架构检查

```
$ pnpm lint
Found 70 warnings and 0 errors.
Finished in 233ms on 2644 files using 8 threads.
# 70 条全部落在未改动文件；按 identity-preset|forkIdentityPreset|presets 过滤 → 0 命中

$ pnpm architecture:check --changed
architecture: OK / violations: 0 / baseline: 0 / new: 0

$ pnpm architecture:check
architecture: OK / violations: 0 / baseline: 0 / new: 0

$ pnpm fork:check-removals            # 额外跑的不变量自查
✓ github-update: 移除不变量成立
扫描 4283 个代码/配置文件，无违规。
```

`apps/zcode-cli/packages/core` 未登记为 managed 模块（与既有三个 fork 目录一致），故分层检查不涉及本目录；边界目前由「`index.ts` 是唯一入口 + 跨包只走 `@zcode/core`」表达。

### 4.4 格式检查（真实结果与处理）

```
$ pnpm fmt:check        # 本任务开始时的基线
Format issues found in above 48 files. Run without `--check` to fix.
Finished in 2160ms on 2965 files using 8 threads.   # exit 1

$ pnpm fmt:check        # 写完本文件、修掉 FEATURES.md 的 EOF 空行之后
Format issues found in above 47 files. Run without `--check` to fix.
Finished in 1895ms on 2966 files using 8 threads.   # exit 1
```

47 个文件是仓库既有问题（含其他 worker 正在施工的 `packages/services/src/bots/**`、`packages/desktop/src/main/fork/github-update/**` 等，未触碰）。其中属于本功能的既有文件有 4 个：`packages/shared/src/fork/identity-preset-contract.ts`、`packages/shared/test/forkIdentityPresetContract.test.ts`（换行宽度）、`design.md`、`implementation-plan.md`（markdown 表格对齐）。它们都是前序任务的交付物、不在本任务的文件清单内（design/plan 亦按任务约束不做重构），故一律未改，如实记录为**既有格式漂移**——其中 `design.md` 的表格对齐在本次同步 §7/§8 前后都存在。

本任务新写入/编辑的文件单独核对：

```
$ ./node_modules/.bin/oxfmt --check docs/features/identity-preset/implementation.md FEATURES.md
All matched files use the correct format.   # exit 0
```

（本文件按 `oxfmt` 的结果做了表格对齐；`FEATURES.md` 只顺手删掉文末多余空行，未改动其内其他条目。）

### 4.5 真实进程冒烟（端到端）

Task 6（`915aa23`）记录的两条：

```bash
ls ~/.zcode/presets 2>/dev/null || echo "目录不存在（预期）"     # → 目录不存在（预期）
node apps/zcode-cli/packages/cli/dist/zcode.cjs --prompt "reply with the single word: ok"
# → exit 0，stdout 仅 "ok"
```

未启用时装配后的端口静默回退；日志里没有 `identity_preset` 记录，行为与改动前一致（`~/.zcode/presets` 不存在时的完成定义）。

受控正例（Task 6 超出 brief 补做）：以 `ZCODE_STORAGE_DIR=/tmp/task6-storage` 把存储根指向临时目录（不触碰真实 `~/.zcode`），手写 `presets/active.json` 与 `presets/profiles/smoke.md` 后：

```bash
ZCODE_STORAGE_DIR=/tmp/task6-storage node apps/zcode-cli/packages/cli/dist/zcode.cjs --prompt "reply with the single word: ok"
# → exit 0，stdout 为 SMOKE_IDENTITY_ACTIVE
```

model-io 落盘（`/tmp/task6-storage/cli/rollout/model-io-sess_a98a72a9-*.jsonl`）显示请求的**第一条消息**即用户配置正文（消息对象摘录）：

```json
{
  "role": "system",
  "content": "Regardless of the user request, reply with exactly the token SMOKE_IDENTITY_ACTIVE and nothing else.",
  "cacheControl": { "type": "ephemeral" }
}
```

Task 7 复跑（本任务，独立 fixture `/tmp/task7-storage`，两次：中文正文一次、与 Task 6 相同的英文强指令一次）：两次 `stdout` 都是 `ok`（模型未按预设措辞作答，生成行为不稳定，不作为判据）；但两次的 model-io 请求体一致命中预期形态：

```
messageCount: 5，role=system 2 条
[0] system :: "无论用户说什么，只回复 SMOKE_IDENTITY_ACTIVE"（第二次为英文模板正文）
[1] system :: "\n\n# Communicating with the user ..."      （动态段保留）
请求体内不含 "You are ZCode, an interactive coding agent"（cli_prefix 已消失），也不含 "# Harness"
```

**这条冒烟证明了什么**：用户配置经「文件 → 端口 → `ensureContextInitialized` → builder → model-io 请求体」在真实进程内闭环成功，且正是请求的第一条 system 消息；`cli_prefix` 不再发出、动态段保留——即设计验收场景 2 的请求侧形态，也补上了「端口读取路径无单测」的缺口。
**不能证明什么**：这不是 UI 测试（第 2 期的设置页 / CRUD / 开关写入尚未实现，fixture 是手写文件）；也不证明模型一定遵守预设措辞（两次复跑的模型回复就不是 token）。

### 4.6 已知未覆盖项

`ensureContextInitialized` 里「每 App 读一次端口」的分支**没有单测**：core 测试目录不存在构造 `AgentRuntime` 的夹具（`new AgentRuntime(...)` 无先例），本期未新建脚手架。目前由 `pnpm --dir apps/zcode-cli typecheck`（编译期契约）与 4.5 的真实进程冒烟覆盖；自动化单测仍待补——合理的落点是第 2 期做设置页 e2e 时一并补，或第 1 期收尾单独建夹具。

## 5. 与设计的偏差

1. **端口返回形态细化**（设计 §8 的草图为 `loadActive(): Promise<ResolvedIdentityPreset | undefined>`）。实现改为返回 `IdentityPresetLoadOutcome { preset?; diagnostic? }`：
   - 原因：runtime 需要在「文件在场但读不懂 / 目录不可读 / activeId 悬空」时记 `warn`（设计 §5.3 要求），但端口不应该知道日志的存在；把 `diagnostic` 作为可选返回值交给调用方，读盘层与日志层解耦。
   - 落点：`file-port.ts:24-32`；runtime 侧在 `methods/context.ts:71-79` 消费并记 `event: identity_preset.load.failed`。
2. **端口落点：`AgentRuntimeDeps`，不是 `AgentRuntimeConfig`**。设计 §7 的接线表把插入点写成「port 定义区（`contextSourcePort` 邻近）」= deps；计划正文与 Produces 行写成 `AgentRuntimeConfig`，两者矛盾。控制器裁决采用 **deps**（design 优先）：仓库既有 14 个端口全部在 `AgentRuntimeDeps`，经 `AgentRuntimeInternal` 字段在构造函数逐项转存，`this.config.<port>` 是本仓库不存在的形状；且 `AgentRuntimeConfig` 会被子运行时整体 spread（`script-workflow-child-runtime.ts`），带函数的端口对象不应进 config。解析结果 `identityPreset`（纯数据）留在 `AgentRuntimeConfig` 随 App 冻结。
   - 后果：比计划的文件清单多改 2 个上游文件——`runtime/internal.ts`（导入 + 字段）与 `runtime/agent-runtime.ts`（导入 + 私有字段 + 构造函数转存），即第 3 节表中新增的两行；`create-app.ts` 的装配点维持计划原文（deps 对象）。
3. **计划的第二处遗漏：`ZCodeAppOptions` 的端口覆盖点**。计划的装配片段使用 `options.identityPresetPort`，但 `ZCodeAppOptions` 当时没有该字段；不补 `bootstrap/src/app/types.ts:170`，片段无法编译。它是可选字段，`options.identityPresetPort ?? createFileIdentityPresetPort(...)` 保证默认行为不变（宿主侧与测试可替换）。
4. **`createForkIdentityPresetId` 经两轮修复定型，并新增导出常量**：
   - 第一轮（`5cca485`）：名字含非 ASCII 时一律追加名称 hash 后缀——否则「极简Style」与「完整Style」都派生 `style`，用户配置会写进同一个文件；
   - 第二轮（`c1bbb15`）：slug 为空时也必须落到 hash 分支——第一轮的收窄让 `"!!!"`、`"---"` 这类纯符号名返回空串（非法 id、且全部塌成同一个 `profiles/.md`）；
   - 新增 `FORK_IDENTITY_PRESET_PROFILE_EXTENSION = ".md"`：文件名后缀收进契约，避免各处硬编码（评审 Finding 2）。
   - 两轮都由测试钉住（`含非 ASCII 字符的名带 hash 后缀，不因共同 ASCII 部分撞 id`、`派生 id 恒满足 id 规则（含 50 字符上限）` 的「各名字各 id」断言）。
5. **已知缺口：每 App 一次端口读取无单测**。core 没有 `new AgentRuntime(...)` 夹具，本期未新建；覆盖它的是 `pnpm --dir apps/zcode-cli typecheck` 与 4.5 的 Task 6 正例冒烟（预设成为 model-io 请求的第一条 system 消息）。自动化测试仍开放（见 4.6）。

接受但未修的既有取舍（记账用，不是本期的遗留缺陷）：

- 非 ASCII / 空 slug 的 hash 后缀是 32 位滚动哈希转 base36，理论可碰撞；当前规模（用户手写配置）可接受，若后续做导入/批量生成需改为带序号去重的分配逻辑。
- frontmatter 只剥双引号（`name: 'q'` 会保留单引号）、BOM / 空 frontmatter 不被识别；均由计划指定的正则决定，行为已由评审实测。
- 四种不同原因共用「激活的配置 … 不存在或为空」这一条诊断文案（目录不可读已单独如实报告，见 2.4）。

## 6. 第 2、3 期未做

本期只交付内核（agent 侧生效链路）。以下**均未实施**，范围与验收场景见 `implementation-plan.md` 的「后续计划」一节：

- **第 2 期（服务与设置页）**：`packages/services/src/fork/identityPreset.ts` 服务面、`packages/desktop/src/host/fork/identity-preset/**` 文件 CRUD 与 `active.json` 写入、访问层接线、`packages/ui/src/fork/identity-preset/**` 设置页「系统指令」栏目、i18n、test-ids，覆盖验收场景 5–10；第 2 期开始前另写 `implementation-plan-2.md`。该节还列出了设计风险 6 的附带修复与登记方式，按计划在第 2 期一并处理。
- **第 3 期（同步）**：`presets/` 纳入 WebDAV 备份包，覆盖验收场景 11–13，并在 `FEATURES.md` 的 local-mode 条目下加功能增强记录。

因此本期没有任何 UI 入口：用户此时只能手写 `~/.zcode/presets/` 下的文件（尚未提供写入方），`~/.zcode/presets` 不存在时的行为与改动前完全一致。

## 7. 第 3 期：WebDAV 同步（已完成）

**落地位置**：无新文件——改的是 fork 自有的备份链路与一处宿主装配。

| 文件                                                      | 改动                                                                                                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/fork/webdav-contract.ts`             | 新增 `FORK_WEBDAV_PRESETS_STATE_FILE` / `_PROFILES_PREFIX` 与 `ForkWebdavPresetsSnapshot`；`ForkWebdavBackupContent` 多一个可选 `presets` 字段 |
| `packages/desktop/src/host/fork/webdav/backup-archive.ts` | 打包写入 presets 条目；解包读回并校验条目名；内容哈希纳入预设正文                                                                              |
| `packages/desktop/src/host/fork/webdav/local-snapshot.ts` | 读/写 `presets/`：只收合法 id 的 `<id>.md`；恢复整目录覆盖                                                                                     |
| `packages/desktop/src/host/fork/webdav/sync-engine.ts`    | 上传带上 `presets`；恢复把 `content.presets` 传进快照；哈希回退分支同样带上                                                                    |
| `packages/desktop/src/host/fork/webdav/service.ts`        | `CreateForkWebdavServiceOptions` 新增必填 `presetsDir`，传给两个端口                                                                           |
| `packages/desktop/src/host/index.ts`                      | 装配时传 `join(await resolveZCodeStorageRoot(), FORK_IDENTITY_PRESET_ROOT_NAME)`                                                               |

**语义要点**：

- 预设正文参与内容哈希——否则只改提示词时哈希不变，永远不会上传。
- 旧备份包（无 `presets/` 条目）解包后**不产生** `presets` 键，恢复时保持本地不动：用户不该因为恢复一个旧包而丢掉后来新建的配置。
- 恢复是整目录覆盖（先删本地 `profiles/` 再写入）：远端删过的配置不会在本地复活。
- 条目名校验：读取侧拒嵌套路径、拒非法 id；写入侧 `yazl` 自身拒绝 `..`，测试把这条也钉住了。

**验证记录**：`pnpm exec tsx --test packages/desktop/test/forkWebdavPresets.test.ts` → 7/7；全部 WebDAV 测试 33/33；本功能其余测试 41/41；`pnpm typecheck`、oxlint、oxfmt 均干净。设计第 10 节验收场景 11–13 分别对应用例「zip 往返保留系统指令配置」「恢复到旧备份（无 presets）时保持本地配置不动」「备份包内的越界预设文件名被拒绝」。

**与设计的偏差**：无。

## 8. 增强：是否注入动态段（injectDynamic）

**需求**：写了完整自定义提示词的用户不希望内置的动态段（环境、gitStatus、沟通风格、会话指导、上下文管理）混进来；关闭后第 ③ 条整段不发出。

**状态归属**：功能级开关，落在 `presets/active.json` 的 `injectDynamic`（缺省 `true`）。不放 `.md` 的 frontmatter——它不随预设切换而变；旧状态文件缺该字段时按 `true` 处理，且不因此被判成「不认识」（`describeUnhonoredState` 不检查这个字段）。

**接线**：`IdentityPresetContent`（配置内容：id/name/content）与 `ResolvedIdentityPreset`（内容 + 本次生效的 `injectDynamic`）分成两层——开关来自状态而非配置正文，混在一个类型里会出现「字段必填但会被覆盖」的假象。builder 用 `customIdentity?.injectDynamic ?? true` 门控第 ③ 条；功能未启用时恒为 `true`，行为与改动前一致。

**验证**：`forkIdentityPresetContract.test.ts`（缺省注入 / 显式 false / 非布尔回落）、`forkIdentityPresetStore.test.ts`（写入不影响开关与激活项）、`forkIdentityPresetContext.test.ts`（关闭后 system 消息只剩 1 条且不含 `# Environment`）。全量 84/84。

### 8.1 附：skills 清单开关（injectSkills）

与 `injectDynamic` 同形：功能级状态落在 `presets/active.json` 的 `injectSkills`（缺省注入），`ResolvedIdentityPreset` 携带，builder 的 skills 段门控从 `this.config.skills && this.skillToolAvailable()` 变为先看 `injectSkills`。

语义边界：只停那条 meta-user 消息（`source: "skills_listing"`），**不摘掉 Skill 工具**——模型仍可调用它，只是不知道有哪些技能（除非提示词里自己列）。要不要连工具一起摘，是另一个开关，未做。

`context_prefix`（`# agentsMd` + `# currentDate`）不受这两个开关影响：它是独立的一条 meta-user 消息，注不注入目前没有开关。
