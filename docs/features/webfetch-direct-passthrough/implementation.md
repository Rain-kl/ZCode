# WebFetch 短内容直通 — 实现文档

设计（产品规则、口径、边界、验收场景）见 `design.md`。

## 1. 落地位置

| 角色                        | 文件                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| 判定与计数（纯函数，无 IO） | `apps/zcode-cli/packages/core/src/fork/webfetch-direct-passthrough/policy.ts`                      |
| 剩余预算投影（纯函数）      | `apps/zcode-cli/packages/core/src/fork/webfetch-direct-passthrough/remaining-tokens.ts`            |
| 判定调用点                  | `apps/zcode-cli/packages/core/src/tool/handlers/webfetch-processing.ts`（`processFetchedContent`） |
| 预算计算点（唯一）          | `apps/zcode-cli/packages/core/src/runtime/methods/turn-model-step.ts`                              |
| 单测                        | `apps/zcode-cli/packages/core/test/forkWebfetchDirectPassthrough.test.ts`（14 例）                 |

数据流（所有者与顺序）：

```
turn-loop            turn-model-step                     turn-tools          executor            handler
    │                       │                                 │                  │                  │
    │ messages/sourceEntries│                                 │                  │                  │
    ├──────────────────────►│ estimatedCurrentUsage           │                  │                  │
    │                       │   = estimateCurrentModelInputTokens(...)           │                  │
    │                       │ remainingContextTokens          │                  │                  │
    │                       │   = contextWindow − usage       │                  │                  │
    │                       │ ──── 同一次请求 ────────────────►│                  │                  │
    │                       │              (模型请求发出；工具在响应后执行)      │                  │
    │                       ├────────────────────────────────►│ options.remainingContextTokens     │
    │                       │                                 ├─────────────────►│ ToolExecuteOptions
    │                       │                                 │                  ├─────────────────►│ context
    │                       │                                 │                  │  .remainingContextTokens
    │                       │                                 │                  │  → policy 判定
```

单一事实：剩余预算只在 `turn-model-step` 算一次，其余各层只做透传，工具侧只读快照。

## 2. 上游接线点与标记清单

`rg -n "FORK\(webfetch-direct-passthrough\)|FORK-(BEGIN|END)\(webfetch-direct-passthrough\)"` 应命中 8 个文件、12 处（含 2 对 `FORK-BEGIN/END`）：

| 文件                                   | 位置                                                     | 为什么必须改上游                               |
| -------------------------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| `tool/handlers/webfetch-processing.ts` | import + `FORK-BEGIN/END` 判定块                         | 摘要在 handler 内产生，判定只能在这里做        |
| `tool/types.ts`                        | `ToolExecutionContext.remainingContextTokens`            | handler 唯一的输入通道                         |
| `tool/executor/types.ts`               | `ToolExecuteOptions.remainingContextTokens`              | 执行参数进上下文的通道                         |
| `tool/executor/call-runner.ts`         | 构造 execution context                                   | 同上                                           |
| `runtime/types.ts`                     | `ExecuteToolsOptions.remainingContextTokens`             | runtime → executor 的通道                      |
| `runtime/methods/tools.ts`             | `executeTools` 透传                                      | 同上                                           |
| `runtime/methods/turn-tools.ts`        | options 类型 + `executeTools` 调用                       | 同上                                           |
| `runtime/methods/turn-model-step.ts`   | import、`estimatedCurrentUsage` 提升为局部量、工具步参数 | 剩余预算的唯一计算点；原内联调用只服务输出预算 |

**上游收敛（同步后如何处理）**：上游若自己实现「短内容免摘要」，或把工具结果预算改成按剩余窗口自适应（那么剩余预算应当由 runtime 直接给工具结果层，而不是透传到 handler），则整体删除本功能：删掉两个 fork 文件与测试、删掉 `webfetch-processing.ts` 的判定块、按上表逐行摘除透传字段——每处都是 1 行字段或 1 行透传，摘除不需要恢复任何上游逻辑，唯一需要还原的是 `turn-model-step.ts` 里被提升的 `estimatedCurrentUsage` 重新内联。

## 3. 已知偏差与未覆盖

- **流失败恢复路径**不带预算：`streaming-tool-coordinator.recoverFromModelFailure` 直接调用 `executeToolCallsForModelStep`，没有本次请求的 messages/sourceEntries，因此 WebFetch 在该路径回落上游总结行为。该路径只在流中断后重放工具调用时出现。
- **WebFetch 永远不走 during-stream 执行**：它声明 `needsApproval: true` 且 `sideEffectScope: "network"`，不满足 `shouldExecuteToolDuringStream`（要求 `!needsApproval && sideEffectScope === "none"`），所以端到端执行只有「流结束后批量执行」一条路径，判定必然生效。此结论若上游改动该条件需重新评估。
- **无专属可观测事件**：判定结果不落任何 session 事件（`ToolExecutionSpanWriter` 只有固定 setter，没有自由属性；handler 也拿不到 logger）。可观测信号是「加工模型请求缺席」：直通命中时 `~/.zcode/cli/debug/model-io-*.jsonl` 中不会出现 `querySource=web_fetch_processing`。

## 4. 验证记录

| 项                                                              | 命令/方法                                                                         | 结果                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 单测（14 例：计数口径 3、判定边界 5、预算投影 2、处理器接线 4） | `pnpm test:unit`                                                                  | 通过                                                                  |
| CLI 类型检查（27 个 task）                                      | `pnpm --dir apps/zcode-cli typecheck`                                             | 通过                                                                  |
| 测试文件类型检查                                                | 临时 tsconfig 纳入 `test/forkWebfetchDirectPassthrough.test.ts` 后 `tsc --noEmit` | 通过（仓库的包级 tsconfig 排除 `**/*.test.ts`，测试默认不被类型检查） |
| 未做                                                            | 真实短页面端到端复验（需重启 host/agent 进程让新 bundle 生效）                    | 待补                                                                  |
