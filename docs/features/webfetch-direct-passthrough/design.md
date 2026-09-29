# WebFetch 短内容直通 (webfetch-direct-passthrough)

## 背景

上游 WebFetch 是两段式：先抓页面抽成 markdown，再把正文塞进一条 user 消息交给模型，
用「加工模型」的产出去回答调用方传入的 `prompt`，模型最终只能看到那段答案
（`apps/zcode-cli/packages/core/src/tool/handlers/webfetch-processing.ts`）。

带来的问题：

- 短文（几段文档、一个 API 章节）本来就不需要压缩，却仍要付出一次额外的模型往返：
  延迟增加、可能超时、失败时整页内容丢失（调用方只看到 `webfetch_processing_failed`）。
- 加工本身是有损的：模型只看到摘要，原始表格、代码片段、字段名可能在总结时被丢掉，
  而抓取方（主模型）无法察觉丢了什么。

在本文档写作时的模型上验证过该路径的代价：一次 `WebFetch` 会产生一条独立的
`querySource=web_fetch_processing` 请求（`tools: []`、`max_completion_tokens: 4096`），
其输入是「Web page content + 调用方 prompt + 引用合规指令」拼成的单条 user 消息。

## 产品规则

WebFetch 命中下面的**全部**条件时，跳过加工模型，直接把抽取出的正文交给调用方模型：

1. **正文够短**：去掉标点后的字数 `< 15000`；
2. **上下文有余量**：发起本次工具调用的那次模型请求，在请求发出时的**剩余上下文预算** `>= 30000`（token，runtime 自己的估算口径）；
3. **正文仍在模型输入上限内**：原始字符数 `<= 100000`（沿用 `MAX_MODEL_INPUT_CHARS`，防止「几乎全是标点」的页面绕过第 1 条把巨量内容灌进上下文）。

任一条件不满足、或剩余预算不可得，都回落到上游行为（调加工模型总结）。

### 「字数」的确切口径

- 单位是 **Unicode 码点**（不是 UTF-16 code unit）：一个 emoji / 增补平面字符算 1。
- 排除 **Unicode `P*` 类标点**：中英文标点（`,.()[]{}"'`、`，。、；：！？（）《》`…）都不计入。
- 空白、换行、以及 `+` `=` `$` `|` 这类 `S*`（符号）**仍计入**。
  这是保守取法：符号在代码/表格里是实义内容，宽算会让判定更早回落到总结，不会放大上下文。

### 「剩余预算」的含义与所有权

- 口径由 runtime 唯一决定：`模型 contextWindow − 本次请求的估算输入`，与 `resolveModelStepMaxOutputTokens`
  用的 `estimatedCurrentUsage` 同源同值（`runtime/methods/turn-model-step.ts`），不引入第二套估算。
- 数值在**发起模型请求前**算一次，随工具执行参数逐级透传到工具上下文，工具侧只读快照，不自行重算。
- 缺席（宿主未接线、模型未声明 `contextWindow`）时视为「不可得」→ 回落上游行为。
  这是 fail-safe 方向：宁可多花一次加工调用，也不在预算未知时放大上下文。

## 边界与已知后果

- **不新增模型可见字段**：`WebFetchOutput` / `WebFetchInputJsonSchema` / tool 声明都不动，
  provider 侧契约零变化。
- **直通时 `truncated: false`**，且不追加任何标记文本（上游只在截断时追加提示）。
- **直通时不再执行「引用合规指令」**（125 字符引用上限、禁止复述歌词等）。
  这是直通的定义使然：正文原文进上下文，加工模型的合规约束被绕过。已明确接受。
- **只覆盖端到端执行的工具调用**：WebFetch 声明 `needsApproval: true` 且 `sideEffectScope: "network"`，
  不满足 `shouldExecuteToolDuringStream` 的条件，因此永远走「流结束后批量执行」这条路径，直通判定必然生效。
  流失败恢复路径（`streaming-tool-coordinator` 的 `recoverFromModelFailure`）不带预算，回落总结。
- **不改 WebFetch 的模型可见描述**：描述里 "answers `prompt` against it using a small fast model"
  对大多数调用仍然成立；改描述属于额外的二开面，收益不足，故不做。

## 验收场景

| #   | 输入                                | 期望                                                |
| --- | ----------------------------------- | --------------------------------------------------- |
| 1   | 正文 14999 字（去标点）+ 剩余 30000 | 直通，不产生 `web_fetch_processing` 请求            |
| 2   | 正文 15000 字（去标点）+ 剩余充足   | 走加工模型（边界取严格小于）                        |
| 3   | 正文 14999 字 + 剩余 29999          | 走加工模型（边界为至少 30000）                      |
| 4   | 正文 14999 字 + 剩余不可得          | 走加工模型                                          |
| 5   | 正文 20000 字（去标点）             | 走加工模型                                          |
| 6   | 正文 10 万字标点 + 极少正文         | 走加工模型（原始长度守卫）                          |
| 7   | 直通命中且 `context.model` 缺席     | 仍然成功返回正文（证明不依赖模型）                  |
| 8   | 预批文档站的 markdown               | 仍走上游原文直通（行为不变）                        |
| 9   | 直通命中                            | 输出 `truncated: false`，且结果等于抽取出的正文原文 |

## 验证方式

- 单测（`apps/zcode-cli/packages/core/test/forkWebfetchDirectPassthrough.test.ts`）：
  决策函数覆盖上表 1–6、9；处理器级用例用「不带 `model` 的工具上下文」证明场景 7
  （直通路径不需要模型），并用「带 `model` 的假上下文」断言未命中时确实发生了一次加工模型调用。
- 运行期：对一个短页面执行一次 WebFetch，确认 `~/.zcode/cli/debug/model-io-*.jsonl` 中
  **不出现** `querySource=web_fetch_processing` 记录——这是「没有走加工模型」的可观测信号。
