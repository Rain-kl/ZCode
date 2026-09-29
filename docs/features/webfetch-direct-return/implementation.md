# 实现记录：WebFetch 直返正文（取消摘要）

关联：`docs/features/webfetch-direct-return/design.md`、`FEATURES.md` 的 `webfetch-direct-return` 条目、
`.agents/notes/webfetch-direct-return/decisions.md`

## 1. 落地位置

| 层 | 文件 | 改动 |
| --- | --- | --- |
| 契约 | `apps/zcode-cli/packages/contracts/src/tools/webfetch.ts` | 输入 schema 去掉 `prompt`；错误码去掉 `ProcessingFailed` |
| 常量 | `apps/zcode-cli/packages/core/src/tool/handlers/webfetch-constants.ts` | 新增 `MAX_WEBFETCH_INLINE_BYTES = 32 * 1024` |
| 内容 | `apps/zcode-cli/packages/core/src/tool/handlers/webfetch-content.ts` | 删除 `truncateContentForModel` |
| 处理 | `apps/zcode-cli/packages/core/src/tool/handlers/webfetch-processing.ts` | **整文件删除**（加工阶段入口） |
| 处理器 | `apps/zcode-cli/packages/core/src/tool/handlers/webfetch.ts` | 结果直取 `fetched.content`；结果预算改为内联上限；描述/能力文案/重定向文案更新 |
| 错误 | `apps/zcode-cli/packages/core/src/tool/handlers/webfetch-errors.ts` | 去掉 `ProcessingFailed` 映射与它的 `retryable` 归类 |
| 单测 | `apps/zcode-cli/packages/core/test/forkWebfetchDirectReturn.test.ts` | 新增（11 例） |

被退役的旧功能（`webfetch-direct-passthrough`）相关文件全部删除：
`fork/webfetch-direct-passthrough/{policy.ts,remaining-tokens.ts}`、
`test/forkWebfetchDirectPassthrough.test.ts`，以及穿过 9 个上游文件的剩余预算透传。

## 2. 数据结构与所有权

没有新增状态。正文的所有者仍是 `webfetch-network.ts` 产出的 `CachedFetchContent.content`；
上下文封顶的所有者仍是工具执行器的 `resultBudget`。本次只是把「正文 → 模型」这条边拉直，
并把 `resultBudget` 调到会真正生效的阈值。

```
抓取 → extractReadableContent(html→markdown) → CachedFetchContent.content
     → WebFetchOutput.result                              （直返，无模型介入）
     → resultBudget：≤32KiB 内联 / 超出写会话级 artifact + 头部预览 + 路径
```

## 3. 上游改动标记

按 `rg -n "FORK\(webfetch-direct-return\)" --glob '!docs/**' --glob '!node_modules' --glob '!dist'`：

**5 个上游文件、7 处标记**（均为单点标记，无成对块）：

| 文件 | 行 | 为什么必须改上游 |
| --- | --- | --- |
| `packages/contracts/src/tools/webfetch.ts` | 13 | `prompt` 原本只喂给加工模型，取消加工后没有接收方 |
| `packages/contracts/src/tools/webfetch.ts` | 110 | `ProcessingFailed` 不再有产生点 |
| `core/src/tool/handlers/webfetch-constants.ts` | 7 | 内联上限是新引入的封顶口径 |
| `core/src/tool/handlers/webfetch-content.ts` | 46 | 删除 `truncateContentForModel`（只为保护加工模型输入） |
| `core/src/tool/handlers/webfetch-errors.ts` | 34 | 同上，错误码退场 |
| `core/src/tool/handlers/webfetch.ts` | 53 | 结果直取抽取正文，不再走加工分支 |
| `core/src/tool/handlers/webfetch.ts` | 198 | 封顶改由 `resultBudget` 承担 |

**净变化**：移除 9 个上游文件里的透传与标记（`runtime/{types.ts,methods/{tools,turn-tools,turn-model-step}.ts}`、
`tool/{types.ts,executor/{types,call-runner,batch-runner}.ts}`），只留下上面 5 个文件的单点标记。
相对被取代的 `webfetch-direct-passthrough`（9 文件 / 14 处标记，含 2 对成对块），二开面缩小。

## 4. 守卫（`scripts/fork-removal-rules.mjs` 的 `webfetch-direct-return` 条目）

- `absentFiles`：`webfetch-processing.ts` 与旧 fork 的三个文件不许复活。
- `absentPatternsInFile`：
  - `webfetch.ts` 不得出现 `runWithModelInvocationContext` / `web_fetch_processing` / `processFetchedContent`；
  - `contracts/.../webfetch.ts` 不得出现 `^\s*prompt:`。
- `requiredPatterns`：
  - `webfetch.ts` 的 `result: fetched.content`（上游版本胜出会换成加工产物）；
  - `webfetch.ts` 的 `maxModelBytes: MAX_WEBFETCH_INLINE_BYTES`（否则退化成整页正文进上下文）；
  - `webfetch-constants.ts` 的 `MAX_WEBFETCH_INLINE_BYTES = 32 * 1024`；
  - 三个改动文件里的 `FORK(webfetch-direct-return)` 标记在位。

**为什么缺席规则按文件钉而不是全局**：新增单测里有意写着这些符号名（`assert.doesNotMatch(source, /processFetchedContent/)`），
全局 `absentPatterns` 会命中测试文件自身，只能退化成自欺。按路径钉住产品文件即可覆盖真实风险。

## 5. 验证记录

| 检查 | 结果 |
| --- | --- |
| `pnpm exec tsx --test test/forkWebfetchDirectReturn.test.ts` | 11/11 通过（先红后绿：加测试时 `MAX_WEBFETCH_INLINE_BYTES` 尚不存在） |
| `pnpm test:unit` | 7 组测试全部通过 |
| `pnpm typecheck` | 通过（root exit 0） |
| `pnpm --dir apps/zcode-cli typecheck` | 27/27 successful |
| `pnpm lint` | 0 error（71 warnings 全部为既有、不在本次改动文件内） |
| `pnpm architecture:check --changed` | 0 违规 |
| `pnpm fork:check-removals` | 通过（本条目标记 ✓，扫描 4503 个文件无违规） |

**未验证**：端到端「抓一个页面、确认日志里不再新增 `web_fetch_processing`」需要在改动后的 bundle 里跑一次。
可观测信号仍是 `~/.zcode/cli/debug/model-io-*.jsonl`；本次改动前该文件里已有 14 条历史记录，
复验时要看**新增**而非总量。

**已做的产物级核验**：`pnpm --filter @zcode/cli build` 重建 `packages/cli/dist/zcode.cjs`（20:15）后确认：

- `processFetchedContent` 在 bundle 中出现 **0** 次（加工阶段入口确已消失）；
- `MAX_WEBFETCH_INLINE_BYTES` 出现 5 次（封顶常量已进产物）；
- 新的工具描述（`Very large pages are truncated to a preview…`）在位；
- `web_fetch_processing` 仍出现 2 次，逐处核对后确认**都在遥测枚举里**
  （`ModelApiOperation.WebFetch` 的 querySource 映射与 `agent-execution.ts` 的 vocabulary），
  不是调用点。该枚举保留是有意的：历史遥测数据仍会引用它，删除属于遥测契约变更，不在本次范围。

**仍未覆盖**：本会话自身跑在改动前的进程上，所以「新会话抓一次页面确实不再产生加工调用」这句
只能由新进程验证——产物已就位，起新会话即可复验。

**未覆盖**：`resultBudget` 的落盘/预览行为本身没有新增测试——它是所有工具共用的既有机制，
本次只改了阈值常量；上面的单测断言的是「阈值已配置到会触发」（含 `内联上限 < 输入侧阈值` 这条不变量），
不是执行器的落盘实现。若要覆盖，需为 `serializeOutput` 造一套 `ToolExecutorDeps`。

## 6. 本次改动的一个仓库侧问题（需人工知晓）

退役旧功能时用 `git rm` 暂存了 4 个删除，尚未提交时被另一个并行会话的提交
`19a3c1b ci(release): dev 发布只保留最新一份…` 一并卷入（该会话使用了带 `-a` 的提交方式）。
后果：`19a3c1b` 的树不自洽——它删掉了 `webfetch-processing.ts` 与 fork 文件，却留下了引用它们的
`import`（`webfetch.ts:26`、`turn-model-step.ts:77`），因此该提交单独签出无法通过类型检查。
本功能的提交补回了这些引用，`HEAD` 之后自洽。该提交未推送到远程（`git branch -r --contains 19a3c1b` 为空），
未按「禁止改写他人分支历史」处理，留待人工决定是否整理。
