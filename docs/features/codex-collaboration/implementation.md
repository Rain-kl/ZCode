# 实施与证据记录

## 当前状态

2026-11-02：Task 1（有界模型 API 恢复）已实施并通过独立 spec/quality review。
Task 2 控制器通过双审，53 条回归；Task3a 正在实现合同、工具条目与角色，尚未切换默认 runtime。
调度器、六工具迁移、角色提示词和 mailbox 生命周期属于后续任务，不代表本功能已全部交付。
设计见 [design.md](design.md)，实施计划见 [implementation-plan.md](implementation-plan.md)。
Task 1 的 Codex 参考为 `6b3b3349f3f559d65b101998a65cad44e5b2ee7b`；21 请求和30秒硬上限来自用户政策。
2026-11-02 已修正 steer 安全请求边界，参考用户指定本地 checkout `3026a8e54e0f48c4d8074cd700f35b0697abc329`；
相关回归通过，桌面启动阻塞已修复，隔离与默认模式实际 Electron 回放均为 5/5；
见 [desktop-steer-acceptance.md](desktop-steer-acceptance.md)。

## Task3a：六工具合同与旧入口移除

2026-11-02：提供 strict 输入/输出、caller-scoped 端口、六个普通 ToolEntry、条件角色和消息信封。
公开入口为 contracts/core 各自的 fork 模块；本阶段尚未接入默认 child driver，不能宣称六工具已在产品默认启用。
Task3b 将统一根/子 runtime、持久 mailbox、冷恢复及原生 UI stop 的 controller 路由。

用户要求完全移除旧工具：删除 Agent/Task、SendMessage、RespondToCoordinator 的 handler 和注册；
移除旧开关、后台 AgentOutput 别名与旧工具指导。TaskOutput/TaskStop 拒绝 local_agent，
Bash、dynamic workflow 与原 local_workflow 文件读取仍保留。fork 移除守卫与真实目录测试共同防回归。

配置使用 subagents.delegationMode/maxTotalAgents/maxDepth/maxLoadedChildren；默认 explicit/4/1/3。
Zod 3 contracts 与 Zod 4 adapter 通过公开 safeParse 结果桥接，逐字段错误完整保留，避免导出私有依赖类型。
继承全部历史时拒绝模型/推理覆盖；等待零毫秒交给 controller 夹紧，深度要求正整数，与 Task2 一致。
角色来源与调整见新模块 NOTICE/LICENSE；不复制不可用宿主语法，按实际权限/深度描述 spawn。

RED：旧 Agent 仍能注册、spawn_agent 不存在、消息空成功被通用输出占位改写、后台工具仍接受 child、
分层配置 getAll 缺字段及覆盖丢失。修复后新工具/配置与后台正向回归 75/75，另新增 resident ToolSearch 回归 9/9；独立 node:test 工具档 3/3。
根 typecheck/lint 通过，完整 CLI typecheck 32/32；architecture 与 fork-removals 通过。所改 TS 在所属包执行 scoped lint 零错误。
完整 CLI lint 已执行，仍有原有两个 max-lines 错误：adapters/src/fs/index.ts、bootstrap/src/zcode-protocol-v4/product-projection.ts，
以及 71 条警告。未将它们记为通过。包原始 core lint 另报原有 session-fork/background-tasks 行数。
实际 provider 空 tool result、child 权限/消息等待、完整 fork 与冷 UI 下钻仍由 Task3b/4 验证。

### Task3a spec review：工具能力与提示一致

实际注册器的 includeCollaboration、allowedTools 和归一化 disallowedTools 共同决定是否推荐
spawn_agent；EnterPlanMode 在能力缺席或禁止时改为直接搜索/读取探索。内置 `/workflow`
实际展开正文改用新工具名，避免要求已删除的 Agent。ToolEntry 合同明确仅校验 schema，
profile/模型目录校验由 Task3b 宿主负责，不将未实现行为写为当前能力。

RED：四种能力缺席/禁止场景与实际工作流展开共5例失败；GREEN：两个相关文件41/41通过。
core/bootstrap typecheck 与所改文件 scoped lint 通过；该内置命令文件按上游基线属于新增文件，
因此作为提示词接线点纳入既有 managed tools 模块，不改变业务状态所有者。

## Task 1：单一物理请求预算

公开合同位于 `contracts/src/fork/codex-collaboration/model-recovery/contract.ts`，
由 `@zcode/contracts` 公开入口导出：

```ts
interface ModelRecoveryBudget {
  readonly attempts: number;
  readonly maxAttempts: number;
  claimAttempt(): number | undefined;
  constrainMaxAttempts(maxAttempts: number): void;
}
```

`createModelRecoveryBudget()` 创建唯一可变 owner：最多21个物理请求，不能重置计数，
`constrainMaxAttempts()` 只能缩小上限。Core 的逻辑模型步骤保存同一引用，
通过 `ModelInvocationContext.modelRecoveryBudget` 到 Adapter；只在完整模型步骤成功后释放。
Adapter 在本地配置/准入通过、真正调用 SDK 前领取一次。独立 Adapter 请求自行建立同一合同的 owner。
SingleAttempt 只限制当前声明式 fallback provider，不提前耗尽整条链。
普通 env/config 下调尝试数会收紧全链，不能在 Core reconnect 时恢复成21。

```text
Core step owns budget -> Adapter claim -> physical SDK request
       ^                         | pre-output failure -> abort/cleanup -> backoff
       | partial failure -> settle tool results -> discard tail -> safe anchor
       +-------------------------+ same counter and monotonic limit
complete model step -> release owner -> next step creates fresh budget
```

工作流默认改为 bounded；旧 unbounded wire 枚举兼容读取，不能放宽次数。
鉴权/PAT、签名修复、空补全、offpeak 探测、provider fallback、stream reconnect 都计入同一预算。
workflow inspection 沿 cause 查找 `recoveryBudgetExhausted`，耗尽后交给 recoverable provider stop，
禁止 driver 自动重开一条无限请求链。独立 compact 自建一个 owner，stream/nonstream fallback 共用；
reactive compact 与失败链中的 preflight compact 继承外层 owner。

## 错误与时间边界

- 默认退避为2/4/8/16/30秒，保留 jitter；base/factor 覆盖仍可改变曲线，所有配置与
  Retry-After 都受30秒硬上限约束。配置可以收紧21请求上限。
- 未知 provider 错误、4xx/5xx、解析错误和 SDK 内部 AbortError 进入有界恢复。
  明确 context-exceeded 保留语义 handoff，立即由 Core compact 改写上下文；compact 的物理请求仍占原预算。
  显式 caller signal、本地配置、权限和 `FORK_UPSTREAM_REQUEST_BLOCKED` 不重试。
  SDK typed local 校验沿 cause 链识别；`UnsupportedModelVersionError.isInstance` 在当前 SDK
  继承通用 AISDKError 判定，会误收 APICallError，必须用该类的 instanceof，已有依赖契约回归。
  `localControl` 将权限、网络门禁与准备/header 刷新失败传给 workflow inspector，阻止外层 redrive。
- error chunk 与 iterator reject 进入同一 catch/cleanup；TerminalStreamChunkError 不再绕开恢复。
  SDK 合成的 other/unknown finish 若没有 provider stop reason，仍是结构化 incomplete-stream 错误，
  包括 text、reasoning、tool-only 与未完成工具输入；不得把 EOF 当作成功半句或执行待提交写工具。
- 输出后的失败交给既有 provider-safe anchor；丢弃失败 assistant tail，保留已完成工具结果。
  已完成 workspace/system/session 副作用不会重跑；未完成的写工具使用既有 synthetic interrupted result。
- 退避可取消，正常完成与取消均移除 abort listener。SDK promise 在 setup 期间已取消时也必须
  安装 rejection observer，避免迟到 rejection 冒到 CLI fatal boundary。
- SDK 默认 stderr hook 由 fullStream 唯一错误 owner 接管，仍保留原 cause/trace/provider/request 事实并发布
  既有 retry/session 事件；没有全局吞掉 process error，也没有新增客户端日志式 reprompt。
- subagent activity watchdog 接收声明式 retryDelayMs 与 SSE attempt 的 timeoutMs，
  合法 backoff、第二次请求递增后的 idle deadline 不再被误判为死亡。terminal 状态清理 allowance。
  permission/message 显式等待的 watchdog 暂停是 Task 2/3 的 driver 生命周期交接项，尚未在 Task 1 实现。

## 落地位置与标记

| 边界 | 文件 |
| --- | --- |
| Managed budget | `contracts/src/fork/codex-collaboration/model-recovery/{contract,module,contract.example,contract.test}.ts`、`CONTRACT.md` |
| Invocation port | `contracts/src/index.ts`、`contracts/src/model/invocation-context.ts`、`adapters/src/model/runner-runtime.ts`、`core/src/runtime/types.ts` |
| Retry/failure | `adapters/src/model/{retry-policy,retry-budget,runner-retry,failure-inspection,failure-classifier}.ts` |
| Physical SDK loop | `adapters/src/model/{runner-generate,runner-stream,runner-options}.ts` |
| Managed workflow policy | `adapters/src/fork/codex-collaboration/model-failure-policy/**`；原 `model/workflow-model-failure-policy.ts` 仅保留 re-export |
| Core owner/anchor/compact | `core/src/runtime/methods/{model,model-request-session-type,turn-loop,turn-loop-state,turn-model-step,streaming-recovery,streaming-tool-coordinator,compact-summary-model-request}.ts` |
| Watchdog | `core/src/runtime/methods/subagent.ts`、`core/src/subagent/runner.ts` |
| Request gate | `packages/shared/src/fork/upstream-network/contract.ts` 增加稳定 error code，保留原消息 |

上表 CLI 路径相对于 `apps/zcode-cli/packages/`。两个新增模块在 `architecture-policy.yaml`
以 `codex-model-recovery`、`codex-adapter-failure-policy` 登记 managed/public entrypoints。
上游产品接线均为 `FORK(codex-collaboration)`；`runner-stream.ts` 原已超过800行，
统一错误路径后缩短约140行，保留注明理由的局部 max-lines suppression，避免在修复中重写整个状态机。

测试辅助 `test-runtime-model.ts` 补齐 ModelEvent 合同：流必须产出 generateText 返回的 tool_call。
原 helper 丢掉工具，父代理在隔离基线复现两个既有失败，仅补这一行后两例通过；没有削弱工具断言。
Explore WebFetch 测试同步既有 direct-return 产品规则：0次二次模型处理，保留 HTTP 请求与真实工具结果断言。

## RED / GREEN 证据

| 回归 | RED 观察 | 修复后验收 |
| --- | --- | --- |
| 默认/覆盖/Hint/取消 | 11请求、60秒、4xx不重试、AbortError误作取消、listener泄漏 | 21/30硬上限、37例 retry helper 合同 |
| 共用计数与 EOF | 新调用预算被重置，缺少 finish 正常返回 | runtime request counter、同一 budget 引用、结构化失败 |
| 真实 SDK partial EOF | 返回 discarded partial text | HTTP断连/clean EOF后2请求，完整答案，第二请求不含失败正文 |
| 真实 SDK tool-only EOF | 待提交 workspace effect 执行1次 | effect0次，安全锚点恢复 |
| 真实 SDK context overflow | 重复21请求后失败 | normal -> compact -> normal，恢复链3请求 |
| env/config 收紧 | maxAttempts2实际21请求 | 同一 Core+Adapter HTTP链恰好2请求 |
| 独立 compact | stream/nonstream预算缺失，可合计22请求 | 单一 owner；无剩余请求时保留最后真实 provider cause |
| setup取消迟到拒绝 | pending.then无 observer；独立子进程 unhandled=true | observer存在；独立子进程 unhandled=false |
| 完成工具/新步骤 | 既有 anchor 与已完成工具需保持 | workspace/system/session 三例各执行1次；成功步骤后新预算，partial恢复沿用预算 |
| watchdog | 20ms无活动在100ms声明 backoff内判死 | 合法退避；fake clock 第二次210s请求超过180s仍存活 |
| SDK local / API 区分 | nested SDK local被重试，UnsupportedModelVersionError通用isInstance误收HTTP错误 | 真实空messages零HTTP、一次SDK；API400/503仍有界重试 |
| 语义超窗 finish | SDK返回后提前释放budget，compact新建owner | 非空normal→compact→normal同一引用，attempts=[1,2,3] |
| 本地拒绝外层恢复 | EACCES/EPERM/blocked/header准备失败retryable=false仍被workflow重驱 | localControl→stop；嵌套cause原样保留；准备失败0次SDK |
| native compact stop | SDK合成other时误拒已观察到的raw stop_reason | raw真终态在后续null后仍有效；原provenance断言不变 |
| backoff factor | 配置/env允许0.5和1 | 非递增覆盖回退2，允许大于1，仍受30s硬上限 |

最终验证（2026-11-01）及范围：

- 扩展专项 21 文件 / 633 测试全部通过：涵盖 adapters retry/EOF/PAT/准入/工具输入，
  core stream/budget/compact/watchdog/工具内准入，contracts 公共预算和 bootstrap 调用方。
- 既有 fallback/工具锚点/流式工具身份相关定向 11/11 通过；
  既有 thrown context-error recovery 单独通过（1/1），嵌套 local/context/cancel 六例包含在专项中；
  原 context-finish 文件另外三例失败由父代理在 399fd40e 基线独立复现，未改其断言。
- 两个新增 managed 模块的 `src/**/contract.test.ts` 用显式 include 配置运行，2/2 通过；
  CLI 默认测试 glob 不含 src，不能用默认专项冒充这一检查。
- CLI `pnpm --dir apps/zcode-cli typecheck`：32/32 tasks 通过；
  `pnpm architecture:check --changed`：0 violations / 0 baseline / 0 new。
- CLI lint：2 errors / 71 warnings / 9 pristine upstream line-count diagnostics；错误仅为
  未改动的 `adapters/src/fs/index.ts`、`bootstrap/src/zcode-protocol-v4/product-projection.ts`
  既有 max-lines，不能记为 lint 通过。
- 父代理独立 root freshness：origin/main adbc5993，ahead3/behind0；root typecheck 通过，
  root lint 102 warnings / 0 errors，fork removals 4 条不变量通过。
- 完整 CLI 命令曾被 plugin-creator 的既有 scaffold MCP JSON 解析失败提前终止；继续模式与
  后续受影响包全量留有日志。受影响包大范围 474 文件 / 6872 测试运行结果为
  6693 pass / 153 fail / 26 skip，3 unhandled（发生在最终专项修复之前，非全绿）。
  父代理使用 399fd40e 源码独立复现其中132个同名失败（共享 compiled node_modules，属部分隔离）；
  余下20个为本轮已修复的恢复门禁/策略 fixture，1个 disabled plugin 超时未稳定复现。
  不把全部153项笼统归为基线，也不宣称最终完整 CLI 全绿。

真实 wire fixture 通过显式 maxAttempts=1 捕获一次请求，保留原 schema/请求数断言；
PAT 恢复 fixture 使用两次物理预算，另断言预算1不会出现额外换证请求。
runtime admission fixture 区分主请求与 web_search_tool 请求，复用真实 tool_call 投影，
保留准入端口与调用层不能覆盖宿主的全部断言。并发 spec 同步移除 workflow 无界恢复规则。

## Task 1 spec review 修正轮 1

spec review 在 `f1857b94` 确认两个 compact transport 入口缺口：

- Core 仅按 response_body/commit 判断 SSE→HTTP fallback，未优先检查嵌套 localControl；
  现在沿 cause/lastError/error 链检查稳定控制事实，原样抛出已有错误，不发 replacement request。
- Core collector 将 stop_reason.present=true 覆盖为后续 false；现在同一 attempt 内用 OR
  单调保留真实 native 终态，和 Adapter 已有规则一致。真实缺失终态与既有提交边界继续保留。

真实 Adapter error-chunk 回归进一步证明：provider 业务码扫描会把 `Error(code=EPERM)` 等
本地错误先包装成 ProviderBusinessError，导致后续归一化失去 localControl 和原 cause。
现在实际 Error 实例若经统一分类器确认为本地控制错误，先原样进入 catch；普通 provider JSON
错误仍走既有业务码映射。正向回归使用 provider `invalid_model_request` payload，确认仍可
SSE1次→HTTP1次 fallback、共享同一个 budget 且 attempts=2。

RED：12例先失败（4种控制×direct/nested共8例、真实 Adapter EACCES/EPERM/blocked共3例、
native true→false终态1例）；额外 provider payload 正向回归捕获过宽准入，先红再收窄。
GREEN：5个相关文件391/391通过，含整个 compact63例与 Adapter/native/业务码/分类回归。
该轮 fresh CLI typecheck、架构与 lint 结果在任务报告记录；未重跑6872例大范围套件。

## Task 1 质量复核修正轮 2

独立质量复核补充确认3个入口缺口：重试包装器同时携带 `cause` 与 `lastError` 时，Core 只沿
单一路径扫描会漏掉 `localControl`；model admission 在 SDK 前拒绝时虽然状态事件写成不可重试，
最终 adapter error 仍保留通用 `retryable=true`；workflow governor 直接使用 provider 原始
`Retry-After`，使 adapter 已按30秒退避醒来后仍被准入冷却阻塞。

修正后 compact 对已知包装字段做有界、循环安全的图遍历；generate/stream 共用 admission
失败分类入口，非取消错误固定为 `prepare_failed` 且不领取物理请求预算；governor 仅将
`min(Retry-After, 30000ms)` 交给并发控制器，状态事件仍保留原始值用于诊断。

RED：3个文件共4例按预期失败，分别观察到 compact 错误转为HTTP fallback、两种 runner 均暴露
`retryable=true` 且0次SDK请求、300秒提示产生300秒冷却。GREEN：同3个文件115/115通过，
off-peak 的既有冷却断言同步锁定30秒实际等待上限。

## 后续交接与边界

- Task 2/3 必须让 permission/message 明确等待与 scheduler 状态停止盲目 watchdog；不得新增另一套模型重试 owner。
- 预算是 runtime-only 引用，不序列化进 provider JSON、会话存储或客户端协议。
- 本轮未做桌面/手机 UI 或 CLI process 全量端到端验收；真实 HTTP SDK -> Adapter -> Core 与独立
  rejection 子进程验证不能冒充所有客户端生命周期均已覆盖。
- 版本标签仍不在本轮 Task 1 代码修正范围；分支推送与 canary 出包按用户后续指令执行。

## 2026-11-02：steer 安全边界修复

用户更正了产品语义：steer 等当前 provider request 完整返回后插入，不能取消流来抢先响应。
现场 `zcode-2026-11-02.jsonl:2412–2424` 记录了同一轮 5 个 child 和父轮都因
`v4 sendQueuedNow preempts active turn` 取消；这条链由旧 sendQueuedNow 的 stop barrier 触发。

本轮以本地 `codex/` 的 `3026a8e54e0f48c4d8074cd700f35b0697abc329` 为行为参考：
`session/turn_input.rs::steer_input` 接纳 pending input；`session/turn.rs` 在 sampling 与工具结束后
检查 pending input 并继续请求。未复制 Rust 源码或提示词，也未将此修复标为六工具迁移完成。

### 实现边界

- `bootstrap/.../commands/handlers/session-flow.ts`：删除 startNow 的 stop/lease/wait 编排，
  使用现有 prompt admission 的 guide 车道；Highspeed 在 busy 时仍用独立队列并保留 requestedDelivery。
- `bootstrap/.../commands/handlers/queue.ts`：手动普通文本项在原 reservation 下调用 guideQueueItem；
  不停止当前流，不移除尚未消费的输入。不能 inline 时只允许 idle-only lease 独立提升。
- `core/src/runtime/methods/steering.ts::guidePendingInputById`：唯一 queue owner 原地转换原 ID，
  保留 sourceCommandId/client/selection/admission 顺序；复用同 ID queued 事件、durable ledger 和现有 drain。
  事件持久化期间若原轮已结束，发明确的 queue fallback，不向过期 activeTurn 插入。
- Core public/internal runtime 方法声明、原型装配、Bootstrap input facade/types 与 prompt-turn 参数只做接线。
  未新增 accepted queue、超时补偿、进程或远程状态所有者。
- 原地修改必须留在现有 runtime queue owner：另建 fork 状态模块会复制 queue 真相或深导入 runtime 内部状态。
  接线和连续行为块均标 `FORK(codex-collaboration)`；不修改既有子代理取消控制器来掩盖父流被取消。
- UI 只清理两处旧的 stop 注释；桌面 continuous 与手机 replayable 的路由、owner/lease 与事件序列不变。
- `product-projection.ts`：同 ID 显式重新获准 guide 时清除旧 fallback；正文编辑事件仍保留既有投递事实。

### 回归与验收

先更新 turn-steering / 权威队列 spec，再写失败回归：旧 startNow 确实取消父 controller，
旧 sendQueuedNow 没有调用 guide 原地转换。新测试覆盖：

1. 受控流先输出 prefix，接纳 steer 后保持原 signal 与 turn；suffix 正常返回后，下一请求才包含引导。
2. V4 command → 真实 input facade → Core → 受控模型流，两种入口都只产生一个 turn 和一次原 ID drain。
3. 相同事件经 live / hydration replay 后只有一条对应 userInput，且 queue 同步清空。
4. 父线程等待前台 child 时接纳 guide，child 正常完成，父下一请求同时包含结果与 steer。
5. 重复转换、跨 reservation 竞争、持久化与轮次收口竞争，以及附件/typed goal/compact/Highspeed 不抢占。
6. 更新正式 running-send-now E2E 和 case-local fixture：迟到尾部必须出现在 steer 后续 provider 请求；
   busy typed goal 保留原项，不提前设置目标，自然空闲后再按原意图执行。

### 验证记录

- CLI 定向回归 9 个文件、385/385 通过：native commands / queue、prompt admission、queue auto-drain、
  guide model refresh、前台 child 边界、queue fidelity，以及 product projection / cold hydration。
  追加的 live/replay 降级状态清理用例先观察到 `fellBack` 而失败，再修正为 `steering` 后通过。
- 补查7个调用方文件为266通过、3失败；6个文件全部通过，失败仅在未修改的 `session-persistence.test.ts`：
  oversized tool artifact、多轮工具持久化、headless checkpoint 恢复。由 `git archive HEAD` 导出的独立
  CLI 源码快照复跑这3例，得到相同失败位置与结果；依赖目录与 compiled 包复用当前 workspace，属于
  源码部分隔离的基线证据，不宣称完整独立构建。未修改这3个无 steer 场景的既有测试。
- 根 `pnpm typecheck`、`pnpm lint` 均通过；lint 为0错误、102项既有 warning。
- `pnpm --dir apps/zcode-cli typecheck` 使用根 workspace 的 Turbo bin（PATH）执行，32/32 成功；
  projection 最终小修后另跑 `@zcode/bootstrap typecheck` 通过。
- CLI lint 原入口将本机 native pnpm 当 JS 执行而报语法错误；使用临时 Node shim 委托同一个 pnpm 后
  完整执行，结果2错误、71 warnings、9项原样上游行数诊断。两个行数错误为既有的
  `adapters/src/fs/index.ts` 与 `bootstrap/.../product-projection.ts`；本轮后者有最小投影修正，仍超限，
  不将 CLI lint 写成通过，也不夹带整文件拆分。
- `pnpm architecture:check --changed` 0违规；`pnpm fork:check-removals` 4项不变量通过；
  `pnpm audit:conversation-session-coverage` 通过，6份生成文档无过期项；`git diff --check` 通过。
- 桌面 `typecheck:e2e` 与 case-local fixture check 通过。正式隔离 replay 首次在构建时缺已声明的
  `@fontsource/noto-sans-sc`，按 frozen lockfile 补齐依赖后 Desktop、插件和 Agent 构建成功。
  后续 replay 在测试执行前因 Electron Main 启动 `unhandledRejection`、无窗口而 WebDriver session
  超时，未到达任何场景断言。对应 artifact：`packages/desktop/.e2e-artifacts/desktop-e2e-20261102-101521-740`。
  在隔离 cache 的 Main 入口临时添加诊断监听后取到原始堆栈：`Config not initialized`，
  `@arms/rum-core` ConfigManager → `@arms/rum-electron` setConfig → Main 的
  `armsUserIdentitySync.refresh()`/`setUser`；源码接线为 `main/index.ts:910` 与启动处 `:2449`。
  该启动故障未修改；诊断只改 ignored E2E cache，没有对被测产品绕过 ARMS 或伪造成功。
  SN/GR 等新版桌面场景保持待复验，不能将协议/Core 通过冒充桌面或手机 GUI 验收。
- 未执行 CLI 全量测试、手机 GUI、Windows/Linux 或完整六工具/mailbox 迁移验收。

## Task 2：独立协作控制器（2026-11-02）

新增 managed 模块 `codex-collaboration-controller`，公共入口为
`core/src/fork/codex-collaboration/{contract,module}.ts`（CLI packages 下）。
`contracts/` 定义身份、消息、版本化图、结构化错误及有限 driver；`app/controller.ts` 是唯一状态所有者；
`app/activity-waiters.ts` 仅维护临时订阅；`app/snapshot.ts` 校验 schema、同树引用与规范路径。
设计和时序见 [controller-contract.md](controller-contract.md)。

完成：根保留名额的运行容量、独立驻留上限与idle卸载、规范身份树、调用方局部 call-ID 幂等接受、
FIFO durable ACK 邮箱、queue-only send、原会话 followup、单目标interrupt、独立取消与run generation、
冷恢复、subscribe投影，以及先订阅后检查的wait。持久运行缺少session-entry端口明确失败。
接受前错误分别清理 admission/runtime/临时身份；清理错误保留原 cause 并聚合，不吞异常。

先写合同和有限端口设计，再写fake driver回归：第一轮19/19因控制器尚未实现而失败，随后19/19通过。
继续测试捕获冷恢复临时占位、terminal保存失败重试、严格schema、观察者异常、interrupt通知及
调用方局部call-ID等缺口；最终两个文件36/36通过。core typecheck通过；模块架构检查0违规。
core lint的失败仅为未改动的 `tool/executor/background-tasks.ts` 与 `runtime/methods/session-fork.ts`
既有max-lines；未将CLI全量lint记为通过。根最终typecheck/lint和完整CLI检查由后续整合阶段统一执行。

Task 2 不修改旧registry或真实runtime接线，不宣称六工具、实际会话存储和Desktop/Web生命周期已经验证。
Task 3 必须为prepared prompt补齐“先admit持久任务，接受后run”的真实执行器接口；旧admitPrompt会立即
驱动CommandInbox，不能直接冒充该边界。真实deliver要按messageId持久去重并在安全边界转换消息来源。
CLI默认Vitest glob不含src测试，本轮以专用include配置运行，不能把默认测试成功冒充本模块覆盖。

### Task 2 spec review：恢复数据与复合清理失败

审查确认：缺失accepted记录的running/terminal身份曾被当作临时占位，冷恢复可能错误discard；
installMailbox之后的release异常、接受保存之后的admission.cancel异常也会覆盖最初失败。
现先拒绝非idle/generation0的无接受记录身份，再做恢复清理；prepare保留原runtime句柄及释放选项，
start在清理前abort独立signal，复合错误通过带阶段上下文的CollaborationError和AggregateError保留。
失败cancel由flush先重试，完成后才释放未接受runtime，避免删除仍有未释放admission的会话。

RED：9种损坏状态/generation组合及2个复合失败用例全部失败（共11例）；GREEN：两文件47/47通过。
回归明确断言没有discard历史、第二次release使用同一真实handle、abort已发生、flush先cancel再release。
专项类型、架构与lint验证记录随修正提交；未改Task3/runtime或桌面E2E。

### Task 2 spec rereview：重试卸载完成投影

flush 的释放重试曾只删除 pending 标记，仍把已释放句柄留在 loaded，导致list残留且followup复用失效runtime。
现在正常release与flush成功重试共用completeRelease：删除pending和loaded，并发布派生投影。
重试资源记录继续携带原discard，新增回归断言接受会话两次释放均为false、邮箱和历史保留，
list/投影移除后followup重新prepare原childSessionId。该例先RED（list仍有child），最终48/48 GREEN。

### Task 2 quality review：清理隔离与关闭失败

确认两个交错：unload失败后followup复用pending句柄，随后flush将新轮次释放；flush释放driver等待期间
并发followup同样可准入到待释放句柄。现ensureLoaded/mailbox drain先通过retryCleanup完成该身份清理，
flush也在原enqueue通道重试，清理与admission互斥，不递归等待已占有通道的finish。

另确认dispose原先在abort前save，保存失败会使所有child继续运行；单个release失败也会截断后续清理。
现先关闭普通准入、abort所有child，再独立尝试保存和每个资源；复合异常保留各code/phase/cause，
失败快照与清理保留给maintenance flush/dispose。保存失败的内存状态已中断；旧持久running可按既定
冷恢复规则转interrupted。宿主仍须await清理后才关闭parent/root store，不能把异常当作资源已全部释放。

纯settings校验提取为无状态helper；fake driver迁到core/test/fork-codex-collaboration并登记同一managed
模块，避免测试文件超过800行，不新增调度owner。3个新场景先RED，另补关闭后abort reject/迟到completion的无异步错误与generation保护验证，最终3文件53/53 GREEN；
core typecheck、模块lint、架构0违规与diff check通过。未运行冗余根全局检查，未改真实runtime或E2E。
