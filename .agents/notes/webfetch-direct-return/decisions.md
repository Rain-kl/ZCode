# webfetch-direct-return 设计与决策记录

日期：2026-09-29
关联：`docs/features/webfetch-direct-return/design.md`、`docs/features/webfetch-direct-return/implementation.md`、`FEATURES.md` 的 `webfetch-direct-return` 条目
取代：`.agents/notes/webfetch-direct-passthrough/decisions.md`

## 1. 起因：先量代价，再决定架构

上一版（`webfetch-direct-passthrough`）解决的是「短页面不该被摘要」，做法是加一道阈值判定。
本轮先把这个判断的**前提**量了一遍——从 `~/.zcode/cli/debug/model-io-no-session.jsonl` 取全部
14 条 `querySource=web_fetch_processing` 记录：

| 输入字符 | 耗时 |
| -------- | ---- |
| 510      | 3,970 ms |
| 3,380    | 8,277 ms |
| 31,525   | 19,608 ms |
| 64,850   | 14,970 ms |

中位 16.2 秒、均值 14.1 秒。

**关键事实是最小那一行：510 字符的页面也要近 4 秒。** 说明耗时来自「一次完整的模型往返」
（deepseek-flash 还要出 reasoning），与正文长度几乎无关。由此，「调阈值」这一类方案被排除：
无论阈值定在哪，跨过它的页面照样付 4~20 秒；阈值只决定有多少页面**碰巧**躲开。

## 2. 关键决策

### 2.1 取消加工阶段，而不是继续调参

- **决策**：WebFetch 不再调用任何模型，抽取出的正文直接作为工具结果返回。
- **权衡过的替代方案**：
  1. _提高字数阈值 / 改计数口径（例如不把 URL 计为字数）_——只减少「付钱的页面数」，不改变单次代价，
     与「速度至上」直接冲突。**否**。
  2. _换更快的加工模型 / 降低 maxOutputTokens_——仍是往返；reasoning 与网络时延不随模型变小而消失
     到可忽略。**否**。
  3. _保留加工阶段、只在阈值内直通（即上一版）_——已被量出的数据否掉：多数真实网页超过任何合理阈值。**否**。

### 2.2 上下文封顶交给已有的 `resultBudget`，不新造机制

- **决策**：用工具执行器既有的 `resultBudget`（`strategy: "artifact"` + 头部预览 + 会话级落盘）封顶，
  只新增两个阈值常量：`MAX_WEBFETCH_PERSIST_CHARS = 15_000`（落盘判据）与
  `MAX_WEBFETCH_PERSIST_PREVIEW_CHARS = 10_000`（预览长度）。
- **为什么这是最大的发现**：这套机制（等价于 opencode 的 `MAX_LINES`/`MAX_BYTES` + 落盘 + 预览）
  **ZCode 早就有了**，只是 WebFetch 的阈值与 `MAX_WEBFETCH_MODEL_BYTES` 同为 100,000，
  而摘要输出恒 ≤4096 token —— 这道闸门**从未触发过**，形同死代码。
  取消摘要后它才第一次真正承担职责。**没有创造第二个封顶路径**，所有权仍在 executor。
- **两个数字的分工**：15,000 字符是**落盘判据**（按字符而非字节，CJK 页面才与直觉一致）；
  10,000 字符是**落盘后模型可见的预览长度**。前者决定「多少页面需要多走一次读文件」，
  后者决定一次超限抓取真正占多少上下文。取舍写进设计文档。

### 2.3 `prompt` 参数整体退场

- 它原本只是交给加工模型的提问，没有加工模型就没有接收方。用户明确要求「工具声明时移除这个参数，
  防止模型调用时传入」——留在 schema 里只会让模型传一个被静默忽略的字段，属于「把行为藏起来」。
- 向前兼容成立：`WebFetchInputSchema` 不是 `.strict()`，历史会话回放传入的 `prompt` 被 zod 丢弃而非抛错。
  这条由单测钉住（`旧调用传入的 prompt 被 schema 丢弃且不抛错`）。

### 2.4 被取代功能的移除范围

上一版的价值全在「判定是否跳过摘要」，摘要没了它就没有存在理由。因此一并退役：
`fork/webfetch-direct-passthrough/{policy.ts,remaining-tokens.ts}`、旧单测，
以及穿过 9 个上游文件的剩余预算透传（`turn-model-step → ExecuteToolsOptions →
ToolExecuteOptions → ToolExecutionContext`）。

**对价变化**：上一版是「9 个上游文件、14 处标记」，本版是「5 个上游文件、7 处单点标记」，
且不再有需要「配对断言」防静默丢字段的白名单重建点——二开面缩小是这次重构的附带收益。

`webfetch-preapproved.ts` **保留**：`isWebFetchPreapprovedUrl` 另有消费方
（`core/src/permission/service.ts` 的 WebFetch 预批判定），不属于本次摘除范围。

## 3. 踩坑与经验

- **测「是否调了模型」不必 mock 网络**：`putWebFetchCache` 是导出的，预置内容缓存后 handler 走缓存分支、
  不发请求；再配一个**不带 `model`** 的工具上下文——旧实现走到加工分支必然抛
  `Model is not configured for WebFetch prompt processing`。于是「能正常返回正文」本身就是可断言事实。
  这比断言「某函数被调用过」更贴近产品语义。
- **缺席类守卫不能写全局模式**：新增单测里有意写着 `processFetchedContent`、`web_fetch_processing` 这些
  **被移除的符号名**（`assert.doesNotMatch(source, /…/)`）。若在 `fork-removal-rules.mjs` 里用全局
  `absentPatterns`，扫描器会命中测试文件自身，只能靠忽略清单掩盖——那等于自欺。改用 `absentPatternsInFile`
  按产品文件钉住，风险覆盖不变。
- **被删模块的引用不会自己消失**：删除 `webfetch-processing.ts` 时，`webfetch.ts` 的 `import` 仍在；
  删除 fork 后，`turn-model-step.ts` 的 `import` 仍在。类型检查会报，但**只在两个包都重建后**才报——
  `@zcode/contracts` 的测试消费方读的是 `dist`，源码改了但没 `pnpm build` 时，单测会对着旧产物通过或失败。
  本次先 `pnpm build` 重建 contracts 才拿到可信的红/绿。

## 4. 验证

见 `docs/features/webfetch-direct-return/implementation.md` §5。要点：单测 11 例（先红后绿）、
`pnpm test:unit` 7 组全通过、root `pnpm typecheck` 与 `pnpm --dir apps/zcode-cli typecheck`（27/27）通过、
`pnpm lint` 0 error、`pnpm architecture:check --changed` 0 违规、`pnpm fork:check-removals` 通过。

**未做**：改动后 bundle 的端到端复验（需新进程）。可观测信号是 `model-io-*.jsonl` 里**新增**的
`web_fetch_processing` 记录数应为 0（该文件已有 14 条历史记录，要看增量而非总量）。
