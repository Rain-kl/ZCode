# WebFetch 直返正文（取消摘要）(webfetch-direct-return)

> 取代 `webfetch-direct-passthrough`（WebFetch 短内容直通）。被取代的是「按阈值决定跳过/不跳过摘要」，
> 本功能取消了那个要被跳过的摘要阶段本身，因此阈值、字数口径、剩余预算透传全部随之退场。
> 历史决策记录保留在 `.agents/notes/webfetch-direct-passthrough/decisions.md`。

## 背景

上游 WebFetch 是两段式：抓页面 → 抽成 markdown → **再调一次模型**把正文压成摘要，
用摘要去回答调用方传入的 `prompt`，调用方模型最终只看到那段答案
（`apps/zcode-cli/packages/core/src/tool/handlers/webfetch-processing.ts`）。

在真实抓取上量过这次往返的代价（`~/.zcode/cli/debug/model-io-no-session.jsonl` 中 14 条
`querySource=web_fetch_processing`）：

| 输入字符 | 耗时 |
| -------- | ---- |
| 510      | 3,970 ms |
| 3,380    | 8,277 ms |
| 31,525   | 19,608 ms |
| 64,850   | 14,970 ms |

中位 **16.2 秒**、均值 14.1 秒，14 次合计 **197 秒**。决定性的是第一行：**510 字符的页面也要近 4 秒**——
耗时来自「一次完整的模型往返」（含 reasoning），与正文长度几乎无关。

由此得出两个结论，它们共同构成本功能的产品规则：

1. **速度**：延迟无法靠「调阈值」消除。任何仍走加工分支的页面一律付 4~20 秒，只有取消这次调用才能解决。
2. **上下文**：现在上下文之所以受控，是因为摘要输出被 `maxOutputTokens: Math.min(4096, …)` 封顶——
   那是**用 16 秒换来的**。取消摘要后必须由别的机制接管封顶，否则 64,850 字符的页面会整段进上下文。

## 产品规则

1. **WebFetch 不再调用任何模型。** 工具直接返回抽取出的正文（HTML 页面为 markdown，其余为原文文本）。
   调用方模型自己阅读正文并回答它自己的问题。
2. **`prompt` 参数从工具输入契约中移除。** 它原本只是交给加工模型的提问；没有加工模型就没有接收方。
   从 `WebFetchInputSchema` 移除后，工具声明（JSON schema）里不再出现该属性，模型无从传入。
3. **上下文封顶改由工具结果预算（`resultBudget`）承担**，与其它工具同一条路径：
   正文不超过 **15000 字**时原样内联；超过时全文写入会话级 artifact，模型拿到
   **10000 字预览** + artifact 路径（`strategy: "artifact"` 既有行为）。

### 两个口径：「字」按字符，预览单独放宽

| 角色 | 由谁决定 | 值 |
| --- | --- | --- |
| 是否落盘的判据 | `entry.maxModelChars`（本功能设的 `MAX_WEBFETCH_PERSIST_CHARS`） | 15,000 **字符** |
| 落盘后模型可见的预览 | `entry.formatPersistedModelContent`（本功能覆写） → `formatPersistedOutputEnvelope` 的 `previewChars` | 10,000 **字符** |

三点必须说清，否则很容易搞错：

- **判据是字符，不是字节。** 用户口径的「字」是字符；且按字符判定对 CJK 页面才与直觉一致——
  10000 个汉字在字节口径下是 30000，会让「15000 字以内不落盘」在中文页面上提前失效。
  `resultBudget` 的字节字段保持上游值 100,000：15000 个 UTF-16 单元在 UTF-8 下最多 45000 字节，
  撞不到它，因此字节规则被字符规则完全覆盖，实际判据只有一个。
- **预览不是 `resultBudget.preview.maxBytes`。** 那个字段是 hook 追加内容时的裁剪界。
  共享信封 `PERSISTED_OUTPUT_PREVIEW_CHARS` 默认 2,000 字符且**全工具生效**，
  WebFetch 通过 `formatPersistedModelContent` 覆写为 10,000，其他工具不受影响。
- 因此 15,000 字以内的页面完整内联；超出的页面上下文代价约 10 KB（10,000 字符预览），
  全文在 artifact 里按需读取。

## 所有权与单一路径

- **抽取后正文的所有者不变**：仍是 `webfetch-network.ts` 写出的 `CachedFetchContent.content`，
  含缓存与输入侧 artifact（`> MAX_MODEL_INPUT_CHARS` 时落盘）两处既有行为，本次不动。
- **上下文封顶的所有者是 tool executor 的 `resultBudget`**：它已经是**所有工具**的统一封顶机制。
  本功能**不新增第二条封顶路径**，只是把 WebFetch 之前形同虚设的阈值调到会真正生效的值。
  （此前 `maxModelBytes` 与 `MAX_WEBFETCH_MODEL_BYTES` 同为 100,000，而摘要输出恒 ≤4096 token，
  这道闸门从未触发过。）
- **没有第二套「剩余上下文」事实**：`remainingContextTokens` 的投影与 9 个上游文件的透传随本功能一并删除，
  runtime 不再为工具侧计算剩余预算。工具结果对上下文的影响只由 `resultBudget` 表达。

## 边界与已知后果

- **模型可见输出即正文原文**，不再有「加工模型再表述」这一层。上游摘要分支附带的**版权合规指令**
  （125 字符引用上限、禁止复述歌词等）随之消失。这是本功能的定义使然，已明确接受；
  预批文档站（`webfetch-preapproved.ts`）原本就直接返回 markdown，本功能把它从特例变成通则。
- **`webfetch_processing_failed` 不再可能产生**，该错误码及其 `retryable` 归类一并移除。
- **`truncateContentForModel` 失去消费方**：它只为「保护加工模型的输入」而存在，摘要没了即无用途，随功能删除。
- **正文质量不做改动**：链接仍以 `[文本](URL)` 形式内联、页面导航与页脚仍会保留。
  噪声治理（去 href、正文提取）**明确不在本次范围**，需要时另行评估。
- **`prompt` 的向前兼容**：`WebFetchInputSchema` 不是 `.strict()`，历史会话回放或旧客户端传入的
  `prompt` 会被 zod 静默丢弃而不是报错，因此不产生回归。
- **重定向文案不再回显 prompt**：`formatRedirectOutput` 里 `- prompt: "…"` 一行随之删除。
- **输入侧 artifact 仍按 100,000 字符触发**（`maybePersistRawContent`，上游既有行为）：
  超过 100 KiB 的页面会同时留下输入侧与结果侧两个 artifact。冗余但无害，
  去除输入侧属于额外的上游改动面，本次不做。

## 验收场景

| #   | 输入                                   | 期望                                                        |
| --- | -------------------------------------- | ----------------------------------------------------------- |
| 1   | 任意页面（含长页面）                   | 不产生 `querySource=web_fetch_processing` 请求              |
| 2   | 工具上下文未配置 `model`               | 仍成功返回正文（证明不再依赖模型）                          |
| 3   | 正文 10 KiB                            | 原样内联，不落盘，`truncated` 为假                          |
| 4   | 正文 40 KiB                            | 结果走 artifact 策略：落盘 + 头部预览 + 路径，`truncated` 为真 |
| 5   | 工具声明（JSON schema）                | `properties` 只含 `url`，不含 `prompt`                       |
| 6   | 旧调用仍传入 `prompt`                  | 被 schema 丢弃且不抛错（向前兼容）                          |
| 7   | 命中跨主机重定向                       | 结果文案不含 `prompt` 行                                    |
| 8   | 工具执行上下文                         | 不再有 `remainingContextTokens` 字段                        |

## 验证方式

- 单测（`apps/zcode-cli/packages/core/test/forkWebfetchDirectReturn.test.ts`）：场景 1–4、6–8。
  用「未配置 `model` 的工具上下文」把「是否调了模型」变成可断言事实——旧实现会抛
  `Model is not configured for WebFetch prompt processing`，新实现正常返回正文。
- 契约测试：场景 5 断言 `WebFetchInputJsonSchema.properties` 不含 `prompt`。
- 运行期：抓一个页面，确认 `~/.zcode/cli/debug/model-io-*.jsonl` 里**不再新增**
  `querySource=web_fetch_processing` 记录；对同一页面重复抓取确认无新增。
