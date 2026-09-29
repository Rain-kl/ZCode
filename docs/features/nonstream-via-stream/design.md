# 非流式走流式通道 (nonstream-via-stream) 设计

## 背景

应用对 provider 的请求分两条独立通道：

- **流式**（`Model.streamText`）：主对话、子代理等交互路径；adapter 侧带重试、空闲超时、断流恢复、
  状态事件（`apps/zcode-cli/packages/adapters/src/model/runner-stream.ts`）。
- **非流式**（`Model.generateText`）：一次性拿完整结果的路径——会话标题、上下文压缩、
  WebFetch 的内容处理、子代理的汇总调用等（`runner-generate.ts`）。

第三方中转/自建网关存在**只把流式做对**的情况：非流式（`stream: false`）返回的响应体不符合
OpenAI 兼容协议，或在某些上游通道上直接不可用。实测（`xapi.arctel.net`）：

| 请求 | 结果 |
| --- | --- |
| 非流式，同模型 | 200 + `{"data":{"choices":[...]}}`（`choices` 未在顶层）→ AI SDK Zod 校验失败 |
| 非流式 | 500 `empty response content` |
| 流式，同模型 | 正常 SSE |

后果不是"报错很难懂"这么简单：**所有非流式调用方一起失效**——标题不生成、压缩失败、
WebFetch 的"抓取+处理"两段式在第二段必挂。

## 目标

让非流式调用不再依赖 provider 的非流式实现：**用流式请求拿结果，在本地汇总成一次性结果**。

## 非目标

- 不改流式行为（`streamText` 原样透传）。
- 不改 AI SDK runner 的装配（重试/超时/恢复/状态事件全部沿用流式那条链路）。
- 不处理结构化输出。当前全产品**没有任何调用方传 `responseJsonSchema`**
  （仅 adapters 内部引用），所以本次不引入该分支；将来若出现调用方，需要在适配器里
  排除这类请求或补齐语义，见「已知边界」。

## 方案

在 **`Model` 端口层**加一个装饰器，而不是在 adapter 内部另起一条非流式路径：

```
createRuntimeModel
  └─ withNonStreamingViaStream(          ← 新增（fork）
       withRuntimeInvocationLayer(       ← 既有：调用上下文/重试预算/准入
         runtime.modelFactory(...)       ← 既有：真实 adapter
       )
     )
```

- `generateText(request)` → `aggregateStreamToResult(base.streamText(request))`
- `streamText(request)` → 原样透传
- `bind(options)` → 递归包一层，避免绑定后掉出适配

**为什么在端口层**：适配器里非流式与流式是两条独立装配路径，流式那条已经带了重试、空闲超时、
断流恢复与状态上报。在端口层适配可以原样复用这条链路，本地只做「把流式事件汇总成一次性结果」
这件纯计算的事——于是它可以被单测完整覆盖，也不需要碰 AI SDK。

**为什么放在 invocation layer 外层**：适配器要调用**带调用上下文**的 `streamText`，
让重试预算与准入闸门作用在真正发出的那次请求上，而不是依赖环境继承。

**唯一出口**：全仓库只有 `createRuntimeModel` 调用 `runtime.modelFactory`，
因此在这一处接线即可覆盖主对话、子代理、压缩、标题与 WebFetch 处理等全部调用方。

### 汇总语义

`aggregateStreamToResult` 与 core 流式分支的汇总保持一致，**不引入第二套事实**：

| 事件 | 处理 |
| --- | --- |
| `text_delta` | 累加到 `text` |
| `reasoning_start` / `reasoning_delta` | 复用 `getOrCreateReasoningBlock`，按 id 分桶（无 id 落默认桶） |
| `reasoning_end` | 回填 `providerMetadata`，移出分桶表 |
| `tool_call` | 按 `toolCall.id` 去重后收集（与流式路径同一防御语义） |
| `finish` | 提供 `finishReason` / `usage` / `providerMetadata` |
| `error` | `normalizeStreamError` 后抛出（保留 provider 业务码） |
| `start` / `text_*` / `tool_input_*` / `compact_stream_boundary` | 不参与结果（流式切分与 compact 专用边界） |

空集合不产出字段：无 reasoning 时不写 `reasoning`，无工具调用时不写 `toolCalls`，
避免调用方拿到「有值但为空」的第二套事实。

## 验收场景

1. 非流式调用的结果与同一请求走流式的**最终态**一致（text / finishReason / usage / reasoning / toolCalls）。
2. 工具调用、reasoning 分桶、去重语义与流式路径一致。
3. `error` 事件抛出时 provider 业务码不丢。
4. `streamText` 行为不变；`bind()` 之后仍走适配。
5. 请求对象原样转发给底层 `streamText`，不丢字段。

## 已知边界

1. **结构化输出未覆盖**：现无调用方，故未在适配器里处理 `responseJsonSchema`；
   将来若有调用方，需要按 provider 语义补齐或让这类请求走原生非流式。
2. **按 provider 类型是"全量切换"**：一旦生效，所有 provider 的非流式调用都改走流式。
   若某个 provider 恰好在流式上有缺陷而非流式正常，会从"能用"变成"不能用"。
   因此保留关闭开关的余地：接线是单点的，回退只需去掉那一层包装。
3. **依赖流式链路的既有缺陷**：空闲超时、断流恢复等语义现在也作用于原本非流式的调用，
   超时窗口按流式配置。属于预期内的行为变化。
4. 本变更**不修复** provider 侧通道不可用（如 `No available channel`）——那类错误与请求方式无关，
   流式同样会失败。
