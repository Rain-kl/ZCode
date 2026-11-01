# 实施与证据记录

## 当前状态

2026-11-01：Task 1（有界模型 API 恢复）已实施，最终验证已完成，等待独立 spec/quality review。
调度器、六工具迁移、角色提示词和 mailbox 生命周期属于后续任务，不代表本功能已全部交付。
设计见 [design.md](design.md)，实施计划见 [implementation-plan.md](implementation-plan.md)。
Codex 参考固定为 `6b3b3349f3f559d65b101998a65cad44e5b2ee7b`；21 请求和30秒硬上限来自用户政策。

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

## 后续交接与边界

- Task 2/3 必须让 permission/message 明确等待与 scheduler 状态停止盲目 watchdog；不得新增另一套模型重试 owner。
- 预算是 runtime-only 引用，不序列化进 provider JSON、会话存储或客户端协议。
- 本轮未做桌面/手机 UI 或 CLI process 全量端到端验收；真实 HTTP SDK -> Adapter -> Core 与独立
  rejection 子进程验证不能冒充所有客户端生命周期均已覆盖。
- 不推送远端、不创建版本标签。
