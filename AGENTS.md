## 核心原则

- 新增或修改行为前，先更新对应 spec；目录不存在时按需创建。先明确产品规则、状态所有者、接口和验收场景，再实现代码。
- 以当前检出的源码、`package.json` 和架构策略为准。说明中只保留当前仓库提供的功能、命令和文件；删除功能时同步清理指令和技能中的引用。
- 定位问题时，未明确要求修改代码就先调查原因。结合源码、日志和运行时证据，区分已确认原因与待验证假设。
- 保留与任务无关的本地改动，不自行恢复已移除的模块或内部依赖。
- 代码实现前必须以架构师的视角在思维链反问自己, 这么做是否是最佳实现方式, 如果不合理或者存在更高的实现方案必须停止开发, 并将告知用户, 由用户进行决断
- 先写测试再实现, 先写文档再修改. 不可将顺序颠倒

## 代码规范

1. 一个类或模块只做一件事，职责一旦膨胀就会变成改不动、测不了、拆不开的神类。  
2. 优先组合而非继承，继承是把耦合写进类型层次里的最快方式。  
3. 面向接口和抽象编程，调用方不该知道具体实现，否则替换和测试都会牵一发而动全身。  
4. 把会变的部分封起来，把稳定的部分写短、写直、写死。
5. 先做出能跑、能测、能理解的最小实现，真正需要时再抽象，过早设计是屎山的温床。
6. 业务规则留在领域层，IO、框架、中间件和第三方全部推到边界之外。  
7. 禁止将报错隐瞒包装, 将不同类型的错误抛出同一个错误提示结果, 可能产生的错误必须携带该点错误详细的上下文逐级抛出. 避免隐藏错误导致排查困难


## Git 提交规范

每次完成一个功能点开发或修复一个问题后，务必提交 Git commit , 禁止推送远程仓库。
遵循 Conventional Commits：`<type>(<scope>): <subject>`（例：`feat(auth): support email login`）。
若涉及非琐碎改动（技术选型/架构重构/核心改动/踩坑复盘），必须将对应的 Agent Note（`.agents/notes/...`）与代码同批原子提交。
- **改动范围约束**：仅允许提交自己明确修改的文件，严禁提交非本次任务修改的文件（杜绝盲目 `git add .` 或 `git commit -a` 卷入无关变动）。
- **工作区保护**：严禁随意还原、丢弃或覆盖他人或当前工作区正在施工的文件。
- **测试容错与告知**：若工作区正在施工的文件导致全局测试失败，仅验证本次修改相关的测试用例，跳过受无关施工影响的测试并明确告知跳过原因。

## 二开标准（Fork）

本项目基于上游 ZCode 二次开发。核心约束：**把每次同步上游的冲突面压到最小，并让残留冲突可被机械定位**。以下规则对所有改动生效。

### 远端与同步

- `origin` = 本项目 fork（可写）；`upstream` = 上游 `zai-org/ZCode`（只读）。
- 同步用 `git fetch upstream && git merge upstream/main`，不改写已推送的提交历史。`canary` 是集成分支，推送即触发集成构建。
- 同步前确认工作区干净，并在独立分支上解决冲突；同步后按「同步与冲突解决」收尾。

### 代码放置（优先级从高到低）

1. **独立包**：fork 专属能力放 `packages/<feature>/`，用 `package.json` + 公开入口自成边界；被上游包引用时只在上游侧留最小接线并打标记。
2. **宿主包内的 fork 目录**：必须在宿主进程内运行时（Electron main/host 注册点、renderer 入口等）时，放 `packages/<pkg>/src/fork/<feature-id>/`，由该目录向上游入口做单向接线。
3. **改上游文件**：前两者都不可行时才改。改动必须最小、连续、可标记，禁止在上游文件里散点式修改。

三种放置共同要求：职责单一、层次分明、依赖方向单向。目录与文件名用 `<feature-id>` 或 `fork-<feature-id>` 这类上游不会命名的特征名，降低同路径 add/add 冲突概率。新模块在 `architecture-policy.yaml` 登记为 `managed: true` 并声明 `publicEntrypoints`（跨包入口）与 `layers`/`layerOrder`（分层时）；未被登记为 managed 的代码不受分层与深层导入检查约束，等于没有边界保护。

### 上游文件改动标记

改动上游既有**代码与配置文件**的每一处都必须留标记，仅限**产品类**改动（功能、行为、体验、文案）。`<feature-id>` 必须与 `FEATURES.md` 条目标题里的 id 一致（「其他更新」类的小改动同样用 `其他更新` 作为 id）：

```ts
// FORK(<feature-id>): 为什么必须改上游代码；见 FEATURES.md 的 <feature-id> 条目
```

连续多行改动用成对标记包住，便于同步时定位边界：

```ts
// FORK-BEGIN(<feature-id>)
// ... 本项目改动 ...
// FORK-END(<feature-id>)
```

- 注释语法随语言调整（`#`、`<!-- -->` 等），token 固定为 `FORK(<id>)` / `FORK-BEGIN(<id>)` / `FORK-END(<id>)`。
- 标记里写「为什么必须改上游」，不写「改了什么」。
- 新增文件、新增包不需要标记：它们不产生逐行冲突，只在与上游同名同路径时才会 add/add 冲突（用特征命名规避）；只有触碰上游既有文件才必须标记。
- 非产品改动（CI 与发布流水线、构建脚本、仓库规范、开发工具链、面向开发者的文档）不打标记、不登记 `FEATURES.md`：只要求改动最小成块，原因写进提交信息。
- 文档类上游文件（`AGENTS.md`、`DESIGN.md`、`README*.md`、`CONTEXT.md`）不强制标记：二开内容收拢成带二开标识的独立小节（区块），冲突时整块取舍。
- 自查：`rg -n "FORK\(|FORK-BEGIN\(" --glob '!AGENTS.md' --glob '!FEATURES.md'`。

### 文档与 FEATURES.md

`FEATURES.md` 只登记**产品本身**的二开改动（面向用户的功能、行为、体验、文案）。发布流水线、构建脚本、仓库规范、开发工具链、开发者文档等非产品改动不登记，用提交信息记录，避免变成流水账。每条记录包含：需求背景、修改内容、修改文件、上游改动标记、该功能的设计文档与实现文档链接。格式：

- **大功能需求**：独立 `##` 标题，格式 `## <功能名> (<feature-id>)`（id 供标记引用与检索），详细记录，使用 Superpowers 工作流开发（`superpowers:brainstorming` → `superpowers:writing-plans` → `superpowers:executing-plans` 或 `superpowers:test-driven-development` → `superpowers:verification-before-completion`），计划与验收记录留在该功能文档目录。
- **功能增强**：以 `###` 子标题放在对应大功能标题下方，写明增强点与影响的上游标记。
- **产品细节/文案等小改动**：统一写在文末 `## 其他更新`，一行一条（日期 + 简述 + 文件），不单独建设计文档；非产品改动不写进本文件。

每功能的文档目录为 `docs/features/<feature-id>/`：`design.md`（背景、方案、边界、验收场景）与 `implementation.md`（落地位置、关键改动、上游接线点与标记清单、验证记录）。仓库级基础设施改动可用 `docs/specs/<name>.md` 作为设计文档。

### 同步与冲突解决

操作手册见 `MERGE_GUIDE.md`（预演冲突面、去重流程、收尾清单、故障速查）。以下是规则层面不可跳步的顺序：

1. **先外挂**：冲突能靠把改动迁到 fork 包/目录消除时，先迁移，再删掉上游文件里的那段改动。
2. **再贴合**：无法外挂时，以上游最新实现为基线，把我们的改动以最小 diff 重新贴回，并保持标记完整。
3. **再对齐**：上游新实现与二开语义互斥（同一行为、不同方案）时，不机械合并。产品类冲突在 `FEATURES.md` 记录「同步冲突」条目（上游提交、冲突文件、两种语义取舍）；非产品类冲突把取舍写进合并提交信息。与用户确认后再改。

禁止：整文件锁定上游（`-X ours`、`.gitattributes merge=ours`、跳过上游提交）、为保住旧实现删掉上游新逻辑、用 `--force` 覆盖他人分支。

同步完成后必须执行：`pnpm typecheck`、`pnpm lint`、`pnpm architecture:check`、`pnpm fork:check-removals`，以及受影响功能的验收场景；并把同步日期、上游提交范围、冲突文件与处理方式记入对应产品条目的「上游同步记录」，非产品类冲突记在合并提交信息里。

**为什么必须有 `pnpm fork:check-removals`**：二开删掉的文件/符号，merge 不一定会提醒你。实测四类情况：

- 上游没碰被删文件 → 删除保留，无冲突（文件不会回来）；
- 上游改了被删文件 → `CONFLICT (modify/delete)`，git 把上游版本留在工作区。**这里最现实的失误是把冲突按「保留上游版本」解决，等于撤销了删除**；
- 上游用**新文件**重新实现同一能力 → 0 冲突，完全静默；
- 删掉的是文件里的符号、上游在**别的文件**新增调用 → 0 冲突，静默，且只有该文件在类型检查范围内才可能被发现。

所以守卫断言的是**行为不变量**（被移除的符号/端点必须缺席 + 我们那版接线必须在位），而不是路径墓碑。规则表在 `scripts/check-fork-removals.mjs`，新增二开移除项时同步登记，并写进对应 FEATURES.md 条目。

## 命令与仓库结构

开工前运行 `node scripts/check-workspace-freshness.mjs` 检查基线。Node 版本以 `mise.toml` 为准。

以下命令从仓库根目录执行：

| 用途             | 命令                                      |
| ---------------- | ----------------------------------------- |
| 类型检查         | `pnpm typecheck`                          |
| Lint             | `pnpm lint` / `pnpm lint:fix`             |
| 格式检查         | `pnpm fmt:check`                          |
| 桌面开发         | `pnpm dev:desktop`                        |
| Web 开发         | `pnpm dev:web`                            |
| 提交前检查       | `pnpm verify:pre-push`（Lint 与架构检查） |
| 架构检查         | `pnpm architecture:check --changed`       |
| 模块阅读包       | `pnpm architecture:context <module-id>`   |
| 未使用依赖与导出 | `pnpm knip`                               |
| 导出引用查询     | `pnpm dep:refs --list-exports <file>`     |

测试入口以目标包当前的 `package.json` 和实际测试文件为准，不假定存在统一的单测或 E2E 命令。

- `packages/desktop`：Electron main、host、renderer。
- `packages/web`、`packages/server`：Web 客户端与服务端。
- `packages/ui`：共享 React 组件、hooks 与 Zustand store。
- `packages/services`：业务服务；`packages/rpc`：RPC 框架。
- `packages/shared`：共享协议与类型；`packages/client`：Agent 客户端 SDK。
- `apps/zcode-cli`：Agent CLI 与运行时。
- `CONTEXT.md`：插件商店领域词汇；修改相关 UI 前阅读。
- `DESIGN.md`：UI 设计规范；修改 UI 前阅读。
- `FEATURES.md`：二开功能索引；新增或调整二开功能、改动上游文件前阅读并登记。

## 实现与验证

- 代码改动使用 `.agents/skills/architecture-governance/SKILL.md`，先运行架构检查，再读取目标模块的受控上下文。
- 避免重复状态和多条写入路径。明确唯一所有者、接口、依赖方向、事件顺序与幂等边界，不能用超时掩盖同步问题。
- 有行为改动时先补充对应测试；交互改动需要 E2E 场景。检查测试与实现是否一致，并实际执行可用的验证。未执行或环境受限时如实说明。
- 修复 bug 时用中文注释说明原因和修复依据。发现设计缺陷时先与用户对齐，不不断增加兜底分支。
- 涉及状态、时序、远端或异步同步的方案，用图展示所有者及事件顺序。
- 必须执行 `pnpm typecheck` 和 `pnpm lint`，报告真实结果，不将已有失败写成通过。
- 使用异步文件和网络 IO；跨包导入使用公开入口，遵守现有路径别名。
- 禁止 UI 直接调用 Repo、Service 引用 Runtime 具体实现、跨域导入实现细节及循环依赖。

### 依赖契约测试

**目的**：防止已有功能因为**依赖的 API 被更改**而失效。二开代码大量依赖上游模块、第三方 SDK 与协议契约；
这些 API 的形状、默认值、错误语义一旦被上游改掉，类型检查未必报错（可选字段、`any`、运行时取值、
文件名拼接、URL 解析语义都不在类型里），功能会在运行时静默失效——最坏的形态是"看起来正常，实际不生效"。
所以凡是我们依赖的 API，都要有断言"该 API 符合我们的期望"的测试。

- **测契约，不测实现**：断言我们依赖的那部分行为，而不是复述上游内部细节。
- **必测四类**（有则写，不必强求全齐）：
  1. **形状**：我们调用的方法/字段存在，参数与返回符合预期（例如第三方 API 接受并保留我们传的选项）；
  2. **默认值与边界**：缺省时会发生什么（默认值、空值、平台/架构差异）；
  3. **错误语义**：失败时抛什么、是 fail-open 还是 fail-close、是否校验完整性；
  4. **我们依赖的常量与协议字段**：文件名规则、URL 拼接语义、序列化字段名等**不在类型签名里**的约定。
- **断言必须能在上游变更时失败**：不要把期望写成被测对象自身的输出，也不要只断言"函数存在"。
  新增契约测试后，应当能说清"上游改了什么会让这条断言红"。
- **位置与命名**：就近放在使用方所在包的 `test/` 目录，文件名体现契约意图（如 `*Contract.test.ts`）；
  用 `pnpm test:unit` 跑（该命令按包分组执行，并自动带上各包的 tsconfig）。
- **上游升级或同步后，这些测试是第一批信号**：变红时先分清「上游有意变更」（改我们的适配层，并同步更新
  测试与文档）还是「上游回归」（保留断言并如实上报），处理流程见 `MERGE_GUIDE.md`。
- **禁止**用 `as any`、非空断言、可选链兜底、`try/catch` 吞异常来让测试变绿——那是把契约变化藏起来，
  比不写测试更糟。
- 无法直接测的（打包产物行为、native 模块、Electron 主进程交互）必须在实现文档里写清"未验证"与验证方法，
  不要用间接断言冒充覆盖。

范例见 `packages/desktop/test/electronUpdaterFeedContract.test.ts`：它把「更新源依赖 electron-updater」
这一契约固化成断言，落地当天就抓出了一处真实缺陷（feed 基址缺尾斜杠会让 metadata 与资产 URL 全部 404）。

## UI 与平台边界

- 遵守 `DESIGN.md`，复用已有组件，兼顾桌面与手机 Web 的布局、交互、主题和国际化。
- 组件通过 `packages/ui/src/hooks/` 访问服务；平台操作通过 `IPlatformService`（`packages/shared/src/platform.ts`），不直接调用 `window.zcode`。
- 通过依赖注入处理 Desktop、Web、本地和远程环境的差异，并兼顾 Windows、macOS 和 Linux。
- Zustand 状态位于 `packages/ui/src/store/`。广播同步的主题、语言等字段需要防止回环；UI 局部状态不应被误当作服务端事实。
- hooks 中含 JSX 的文件使用 `.tsx`。

## 进程、协议与远程控制

- Desktop app 通过 stdio 与 Agent 通信。协议改动同步更新 `packages/shared/src/zcode-protocol/index.ts`，提供严格类型与运行时校验。
- Main 负责窗口、原生操作、进程调度和消息转发，不承载 task/session 业务状态。
- 每个窗口使用一个 window-scoped Local Host；本地 workspace 共享该 Host。远程 workspace 由窗口内的连接注册表管理，不另建 Desktop Remote Host。
- 手机远控连接桌面已有 Host attachment，复用会话运行时；不为手机另起 Agent、Local Host 或远程会话。
- Desktop 的 `desktop-continuous` 实时链路与手机的 `web-remote-replayable` 恢复链路必须明确区分。修改 stream、snapshot、queue 或重连时，同时验证两种语义。
- 外部 relay 与 Main 只做鉴权、配对、心跳、转发及 attachment 调度，不保存任务队列、快照等业务状态。
- 已接受的 busy/running 输入由 CLI/runtime `CommandInbox` 串行 admission；Renderer 只保留未提交草稿与 pending optimistic overlay，Host owner/lease 负责路由。
- 保留 owner/lease、跨 Host 路由和 stale run 防护，不能仅根据单一路径删除边界判断。

## Workspace Identity

- `workspaceIdentity` 用于身份隔离，`workspacePath` 用于文件操作、命令 cwd、Git 和路径展示。
- 身份 key 统一为 `workspaceIdentity?.trim() || workspacePath`，适用于去重、绑定、缓存、队列、持久化和请求关联。
- 远程链路贯穿传递 `workspaceIdentity` 与 `remoteSessionId`，不得仅按路径匹配。
- 新接口保留本地路径 fallback；远程 identity 复用现有构造和解析工具，不在业务代码中手写格式。

## 日志

- UI 使用 `packages/ui/src/logger.ts`，不直接使用 `console.log` 或 `window.zcode?.log`。
- Agent/session/runtime 相关服务日志使用 `createServiceLogger(scope)`（`packages/services/src/logger/serviceLogger.ts`）。
- `debug` 用于协议原始数据、流式 chunk 和逐条工具更新等高频诊断，生产环境不落盘。
- `info` 用于进程和会话生命周期、权限结果、一次性初始化等生产可用事件。
- `warn` 用于可恢复异常；`error` 用于崩溃、握手失败、鉴权丢失等不可恢复错误。
- 不在日志、示例或提交中写入凭据、真实用户数据和内部服务地址。
