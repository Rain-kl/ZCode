# 非流式走流式通道 (nonstream-via-stream) 实现

方案与取舍见 [design.md](./design.md)。

## 1. 落地位置

| 变更 | 文件 |
| --- | --- |
| 适配器与汇总逻辑 | 新增 `apps/zcode-cli/packages/core/src/fork/nonstream-via-stream/model.ts` |
| 单测 | 新增 `apps/zcode-cli/packages/core/test/forkNonstreamViaStream.test.ts`（7 例） |
| 接线（唯一出口） | `apps/zcode-cli/packages/core/src/runtime/methods/runtime-model.ts` |

上游接线只有 1 个文件：`runtime-model.ts` 加 1 个单点标记 + 1 对 `FORK-BEGIN/END`。

## 2. 关键改动

```ts
// runtime-model.ts
return withNonStreamingViaStream(
  withRuntimeInvocationLayer(runtime, runtime.modelFactory({ ...input, selection: input.selection })),
);
```

- `generateText(request)` → `aggregateStreamToResult(model.streamText(request))`
- `streamText` 原样透传；`bind()` 递归包装，避免绑定后掉出适配
- 汇总语义逐条对齐 core 流式分支（`runtime/methods/model.ts` 的 `for await` 循环）：
  复用 `getOrCreateReasoningBlock`（`runtime/methods/reasoning-stream.ts`）与
  `normalizeStreamError`（`runtime/helpers/model-errors.ts`），不复制归并规则

## 3. 上游改动标记

2 处：`apps/zcode-cli/packages/core/src/runtime/methods/runtime-model.ts`
—— 1 个单点 `FORK(nonstream-via-stream)`（import）+ 1 对 `FORK-BEGIN/END`（返回值）。

自查：`rg -n "FORK\(|FORK-BEGIN\(" --glob '!AGENTS.md' --glob '!FEATURES.md'`

## 4. 验证记录

已执行：

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 适配器单测 | `pnpm exec tsx --test apps/zcode-cli/packages/core/test/forkNonstreamViaStream.test.ts` | 7 pass / 0 fail |
| core 类型检查 | `cd apps/zcode-cli/packages/core && pnpm exec tsc --noEmit` | 通过（exit 0） |
| 全量单测 | `pnpm test:unit` | 全部通过 |
| Lint / 架构 / 移除不变量 | `pnpm lint`、`pnpm architecture:check`、`pnpm fork:check-removals` | 见提交信息 |

**未执行（如实说明）**：

1. **没有对真实 provider 做端到端验证**。本次验证止于单测与类型检查；
   要确认"非流式调用确实改走了流式"，需要在真实中转上跑一次会话标题/压缩/WebFetch 并核对
   请求侧是 SSE。判定方法：日志里 `model.request.started` 后应出现流式事件；
   或抓包看 `/chat/completions` 请求体 `stream: true`。
2. 未覆盖结构化输出路径（当前无调用方，见 design.md 已知边界 1）。
3. 未验证"某个 provider 流式有缺陷而非流式正常"的反向场景（已知边界 2）。

## 5. 与设计的偏差

无。实现按设计落地；单测里有两条断言在编写时修正为**实际**语义（reasoning 按 id 分桶、
provider code 被字符串化），属于把契约写准，不是实现偏差。
