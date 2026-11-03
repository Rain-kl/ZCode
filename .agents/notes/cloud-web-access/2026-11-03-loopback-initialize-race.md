# Headless loopback RPC Initialize 首帧竞态

日期：2026-11-03

## 运行时证据

公网 `/remote/v4` 登录、设备配对、bootstrap 和 `workspace-bridge-ready` 均成功，Server 返回 `/root`；浏览器只有一条上行 `rpc-frame` 及其 ACK，没有收到 Core 下行 RPC 帧。React 已建立 `/root` tab，但 setting service 持续 loading，`OccupationOnboarding` 因 settings 未就绪隐藏 children，页面只剩空 `h-dvh` 根节点。

线上静态 bundle 与当时 canary 的 `packages/web/dist` 哈希一致，排除 Worker 提供旧资源。Server 运行版本为 `3.17.162-dev.2a1cbcd6`，运行状态 ready。

## 根因与所有者

Core 的 `ChannelServer` 会在 loopback WebSocket open 后立即发送携带 channel manifest 的 RPC `Initialize`。旧 `openLoopbackCoreBridge` 在 socket open 回调内才构造 `SocketProtocol`，并在 Promise resolve 后由 router 注册 `bridge.onMessage`。任一空窗收到的首帧都会被无缓存 Emitter 丢弃，浏览器 `ChannelClient` 因未初始化而永久等待 setting RPC。

`openLoopbackCoreBridge` 是 socket 到 router 订阅窗口的唯一交付 owner。修复让 loopback 从连接建立起持续接收，并仅在首个 bridge listener 注册前暂存；注册后同步按序交付并清空，listener 注销后不重新积累。bridge generation、ACK 重放和业务状态仍由 router/Core 原 owner 管理。

## 回归证据

真实 loopback 回归在 router 订阅前由 Core 发出 `Initialize`，浏览器 `ChannelClient` 注册后必须立即进入 initialized，并完成 setting channel roundtrip。该用例在旧实现上收到空消息并失败，修复后与 Connector 其余测试共同 11/11 通过。
