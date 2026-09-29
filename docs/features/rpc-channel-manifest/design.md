# 通道清单驱动的服务可用性 (rpc-channel-manifest) — 设计

## 1. 背景与问题

`pnpm dev:web` 打开「设置 → Agent 能力 → 系统指令」时，面板显示
`Channel name 'fork-identity-preset' timed out after 1000ms`，并且本应为空态的列表被这段错误取代。

链路（已逐层验证，见 `implementation.md` §5）：

1. 网页端 `packages/web/src/main.tsx` → `connectViaWebSocket` → `packages/client/src/websocket.ts` 的
   `connectViaProtocol` → `new RemoteServiceAccess(client)`。
2. `RemoteServiceAccess` 为**每个**通道无条件建代理，包括只在桌面 host 注册的 fork 专有通道
   `fork-webdav` 与 `fork-identity-preset`。
3. `ProxyChannel.toService` 是惰性的：代理本身永远是真值对象，只有在成员被访问时才发调用。
4. 服务端 `ChannelServer` 收到未知通道 → 挂起 → 1s 超时 → 回 `Unknown channel`。

根因不是「web 端不该调这两个服务」，而是**「通道是否存在」这件事在协议里没有表达**：
`RemoteServiceAccess` 只有通道名，没有可用性事实，于是 UI 只能拿惰性代理当真值来判断能力。
`Boolean(service)` 恒为真，缺席被伪装成「一条错误 + 空数据」，同时把「能力缺席」和「调用出错」两种状态压在同一个 `error` 上。

## 2. 方案：在 Initialize 握手里携带通道清单

服务端 `ChannelServer` 在连接建立时已经会发 `ResponseType.Initialize`，客户端 `ChannelClient` 已有
`onDidInitialize`。把已注册通道名数组放进这条既有消息，不新增往返：

```
Server                                          Client
  |  new ChannelServer(protocol, ctx, deferInit)   |
  |  （本 tick 末尾，待通道注册完成）              |
  |------------ Initialize {channels:[...]} ------>|  ChannelClient.channelManifest = channels
  |                                               |  RemoteServiceAccess 按清单解析可选成员
  |                                               |  清单里没有的通道 → 成员为 undefined
```

### 2.1 语义

| 状态                            | `ChannelClient.channelNames()` | 客户端行为                                           |
| ------------------------------- | ------------------------------ | ---------------------------------------------------- |
| Initialize 未到达（握手未完成） | `undefined`                    | 视为全部可用（历史行为），不把真实服务提前判成不可用 |
| 旧服务端（Initialize 不带清单） | `undefined`                    | 同上，保证向前兼容                                   |
| 新服务端，清单非空              | `string[]`                     | 只对清单内的通道建代理；其余可选成员为 `undefined`   |

- **空数组按「未知」处理**：服务端在通道注册完成前发 Initialize 会得到空清单；若当成事实，
  客户端会把本端全部真实服务显示成「当前环境不支持」——静默失效比一次可见的超时报错更难排查。
  非空清单是当前唯一正常形态，不受此兜底影响。
- **清单是活的事实**：`Initialize` 之后新增的通道会补发一次清单（`registerChannel` 检测到首次发送已完成），
  否则「运行期注册」的通道会被永久判为缺失。首次装配注册发生在清单首次发送之前，不会触发补发。

### 2.2 时序硬约束：Initialize 必须在通道注册完成后才发

这是本方案唯一的危险点：**早期发送会把真实服务误判为不可用，比现在的报错更糟。**

`ChannelServer` 的两个发送路径都满足该约束：

- **立即初始化（`deferInit === false`）**：构造时不再同步发送，改为 `queueMicrotask` 推迟到本 tick 末尾。
  所有装配点（`ServiceCollection.exposeOnChannelServer`、IPC 的 `registerChannel` 循环）都在构造之后
  同步注册，微任务正好在所有同步注册之后、下一个宏任务之前执行。
  > 实测事实：本 checkout 中 `deferInit` 的唯一构造点是
  > `packages/desktop/src/host/index.ts:2027` 的 `new ChannelServer(protocol, "host", 1000, deferInit)`，
  > 而该函数的唯一调用点（同文件 `:2140`）传入 `false`。全仓（含 `dist`/`out`/`mjs`）穷举
  > `.ready()` 也未找到生产调用方。因此「立即初始化」是当前唯一的实际路径，微任务推迟是它的正确性依据。
- **延迟初始化（`deferInit === true`）**：保持原样，只在调用方显式调用 `ready()` 时发送。
  调用方必须在注册完成后调用；契约由 `packages/client/test/channelManifestAssembly.test.ts` 的第二条用例锁定。
  该链路一旦被接入且顺序有误，症状是「真实服务被判为不可用」而不是报错，因此必须靠契约测试守。

### 2.3 客户端判定接口

`RemoteServiceAccess` 新增 `channelAvailability: IChannelAvailability`（定义在
`packages/services/src/fork/channel-availability.ts`）：

```ts
interface IChannelAvailability {
  isInitialized(): boolean; // 清单是否已成为事实
  channelNames(): readonly string[] | undefined;
  readonly onDidChange: Event<void>;
}
```

- 可选服务成员改为按清单惰性解析的 getter（`defineManifestGatedService`）：
  清单缺席该通道 → `undefined`；清单未知 → 照旧建代理。
- getter **按清单引用缓存**代理：`ProxyChannel.toService` 每次调用都返回新对象，若不缓存，
  React 里以该成员为依赖的 effect 会每次渲染都重跑并写状态，形成重渲染循环。
- 判定逻辑独立成纯函数 `isChannelAvailable`（`packages/client/src/channelManifest.ts`），便于单测。

### 2.4 UI 的两段时间

UI 需要区分两件事，不能混用一个布尔：

1. **显示可用还是不可用** → 读成员本身（`Boolean(service)`，清单缺席即 `undefined`）。
2. **能不能发调用** → 必须等清单到达（`isInitialized()`）。清单到达前发调用就是今天的超时错误。

`useChannelServiceUsable(service)` 给后者，`useChannelAvailabilityReady` 提供前者的时机。
`available` 保留原语义（清单是否提供该通道），所有调用改由 `usable` 门控。

### 2.5 覆盖的通道

所有在 `IServiceAccessor` 上**可选**的成员一并纳入（同一个缺陷，不只 fork 三个通道）：
`mediaPreviewService`、`onboardingRecordService`、`windowControllerService`、`cuaPermissionService`、
`forkWebdavService`、`forkIdentityPresetService`、`forkSearchProvidersService`。
必填成员（`fileService` 等）不在范围内：它们在所有 host 都注册，缺席属于装配错误，不应被静默降级。

## 3. 边界与不做的事

- **不做能力协商**：清单表达的是「本端注册了这些通道」，不是「支持这些语义」。同一个通道在不同 host
  上行为不同（如 `cuaPermissionService` 在非 macOS 返回 `available:false`）仍由服务自身表达。
- **不改变未知通道的服务端行为**：`collectPendingRequests` 的 1s 超时保留。清单是让客户端**不去发**
  注定超时的请求，而不是把服务端错误改成静默。
- **不做版本协商**：清单缺失即未知，足够覆盖新旧组合；旧客户端忽略 Initialize 的 body，不需要协议版本号。
- **不改 `ProxyChannel`**：惰性代理本身不是问题，问题是没有可用性事实；改它会影响所有调用方。

## 4. 新旧兼容矩阵

| 服务端       | 客户端 | 行为                                            |
| ------------ | ------ | ----------------------------------------------- |
| 旧（无清单） | 旧     | 不变                                            |
| 旧（无清单） | 新     | 清单 `undefined` → 与旧客户端一致（照旧建代理） |
| 新（有清单） | 旧     | 忽略 Initialize 的 body，行为不变               |
| 新（有清单） | 新     | 按清单过滤                                      |

序列化层是向后兼容的：Initialize 的 body 从 `undefined` 变为 `{channels:[...]}`，
`deserialize` 的 `DataType.Object` 分支对旧客户端是**额外一次读取**——旧客户端的 `onBuffer` 本来就会
`deserialize(reader)` 读 body 并丢弃，因此不改变消息边界，无需同步升级两端。

## 5. 上游收敛

**上游若自带服务能力协商（Initialize 携带可用服务/能力声明、或提供等价的 server capabilities 查询），
本功能整体删除并采用上游实现。** 摘除范围见 `implementation.md` §2。
判定标准是上游能回答「对端是否存在该通道」且时机在注册完成之后；若上游只提供异步的探测接口，
则需要评估它是否会把 UI 拖回「先报错、后可用」的两段式，再决定是否替换。

## 6. 验收场景

1. 网页端打开「设置 → Agent 能力 → 系统指令」：无 `timed out after`，显示
   `settings.systemInstructions.unavailable`；「设置 → 基础设置 → 同步」显示 `settings.configSync.unavailable`；
   「搜索」显示对应不可用文案。
2. 桌面端：两个 fork 服务可用，系统指令面板读到既有配置（`Pier`），同步面板读到 WebDAV 状态与备份列表。
3. 旧服务端（Initialize 不带清单）+ 新客户端：行为与改造前一致，不出现「全部不可用」。
4. `window-controller` 等可选通道缺失时不再各贡献一条 1s 超时错误。
