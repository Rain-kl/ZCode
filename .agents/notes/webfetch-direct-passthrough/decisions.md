# webfetch-direct-passthrough 设计与决策记录

日期：2026-09-29
关联：`docs/features/webfetch-direct-passthrough/design.md`、`docs/features/webfetch-direct-passthrough/implementation.md`、`FEATURES.md` 的 `webfetch-direct-passthrough` 条目

## 1. 需求与现状

上游 WebFetch 固定两段式（`tool/handlers/webfetch-processing.ts`）：抓页面 → 抽正文 → **再调一次模型**把正文压成
摘要交给调用方。短页面压摘要纯损失：多一次往返（可失败，失败时整页内容丢失，调用方只看到
`webfetch_processing_failed`），且摘要会丢表格/代码/字段名细节，抓取方无从察觉。

在本次会话中抓取 `docs.github.com/.../evaluate-expressions-in-workflows-and-actions` 时记录了该路径的真实形状：
`querySource=web_fetch_processing`、`tools: []`、`max_completion_tokens: 4096`、单条 user 消息
（`Web page content:\n---\n{正文}\n---\n\n{prompt}\n\n{合规指令}`），输入 17092 字符。

需求（用户给出）：正文去标点 `< 15000` 字、且此时上下文窗口剩余 `30000` 时，不做总结，直接传给大模型。

## 2. 关键决策

### 2.1 「剩余上下文预算」的口径与所有权

- **决策**：`剩余 = model.properties.contextWindow − estimateCurrentModelInputTokens(本次请求的 messages, sourceEntries)`，
  在 `turn-model-step` 里**算一次**，随执行参数逐级透传到 `ToolExecutionContext.remainingContextTokens`。
- **权衡过的替代方案**：
  1. _在 tool handler 里自行估算_（读 session store 或重建 provider messages）——会产生第二套「当前用量」事实，
     与 runtime 的压缩/预算决策可能分叉，且每次工具调用都要重算一次请求投影。**否**。
  2. _给 executor deps 注入 getter，运行时读「当前」状态_——runtime 上没有「当前 turn 请求状态」这个所有者
     （`turnRequestState` 是 turn loop 的局部量，`runtime.activeTurn` 只是 steering 状态），要么新增可变字段
     并让 turn loop 去写（第二条写入路径），要么读不到。**否**。
  3. _不做预算判断，只看长度_——丢掉用户明确给出的第二个条件。**否**。
- 结论：显式快照 > 活的 getter；单一写者（turn step）> 多处读。

### 2.2 为什么预算要穿过 9 个上游文件

`turn model step → ExecuteToolsOptions → ToolExecuteOptions → ToolExecutionContext` 这条链每一层都是上游的
显式字段（`model` 就是同款走法的先例），加一个字段就是每层 1 行。尝试压缩后只剩下「读活的运行时状态」这条
被否掉的路。代价是 9 个上游文件各 1~2 行、共 14 处标记，因此额外在 `scripts/check-fork-removals.mjs` 里把每一层
都钉成 `requiredPatterns`：哪一层被上游版本覆盖，透传就断了，产品表现只是「又变回总结」——不报错、不影响类型
检查，属最典型的静默失效，必须由守卫兜住（已用「注释掉调用行/透传行」实测多处都会红）。

**踩坑（第一版实现真的断了）**：`tool/executor/batch-runner.ts` 不是 object spread，而是**逐个字段重建** options
（分片执行 + 按并行组调度两个重建点），漏写就静默丢字段。第一版只改了 `call-runner.ts`，字段到不了 handler，
而单测（直接调 `processFetchedContent`）与类型检查都发现不了。补上后除 guard 规则外，还加了一条「配对断言」：
每处 `model: options?.model,` 旁必须有一处 `remainingContextTokens`——上游新增重建点同样会红。

### 2.3 字数口径（`\p{P}`、码点、空白与符号计入）

- 单位取 **Unicode 码点**（`for...of` 语义），一个 emoji 算 1，不是 UTF-16 的 2。
- 只排除 **`P*` 标点**；空白、换行、`S*`（`+` `=` `$` `|`）**计入**。取保守方向：宽算只会更早回落总结，
  不会把大内容放进来；若日后要放宽（把符号也排除），改 `policy.ts` 一处即可。

### 2.4 原始长度守卫（`<= 100000`）

先于字数判定生效。没有它，「10 万个逗号」这种页面去标点后字数为 0，会把超过模型输入上限的正文灌进上下文。
阈值与 `webfetch-constants.ts` 的 `MAX_MODEL_INPUT_CHARS` 同值（两处常量不共享是因为其一在上游文件、其一在 fork
文件；改上游那个值时需要同步这里）。

### 2.5 已知取舍

- 直通时不再走加工分支的「引用合规指令」（125 字符引用上限等）：正文原文进上下文，这是直通的定义使然，已明确接受。
- 流失败恢复路径（`streaming-tool-coordinator.recoverFromModelFailure`）没有本次请求的 messages/sourceEntries，
  不带预算 → 回落总结。该路径只在流中断重放工具调用时出现。
- WebFetch 声明 `needsApproval: true` + `sideEffectScope: "network"`，不满足 `shouldExecuteToolDuringStream`
  （要求 `!needsApproval && sideEffectScope === "none"`），所以它永远走「流结束后批量执行」，判定必然生效。
  这个前提写进实现文档，上游若改该条件需重新评估。

## 3. 验证

- 单测 15 例（口径 3 / 判定边界 5 / 预算投影 2 / 处理器接线 4 / 接线配对 1），`pnpm test:unit` 通过。
  接线用例用「不带 `model` 的工具上下文」把「是否调了加工模型」变成可断言事实：直通则正常返回正文，
  未直通则抛 `Model is not configured for WebFetch prompt processing`。
- `pnpm --dir apps/zcode-cli typecheck` 27/27 通过；`pnpm lint` 0 error；`pnpm fork:check-removals` 通过
  （含两处负面实测）。
- **未做**：真实短页面端到端复验（需要新 bundle 起进程）。可观测信号是 `~/.zcode/cli/debug/model-io-*.jsonl`
  里不再出现 `querySource=web_fetch_processing`。
