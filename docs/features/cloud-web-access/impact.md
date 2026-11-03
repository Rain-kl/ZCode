# 本期功能影响与状态边界

模式：fork 独立包加最小上游接线。主方案为官方 V2 兼容 Relay、headless Server connector 和 `zcode server` 命令组。

## UI与命令入口

| 场景           | 入口/显示owner        | 校验与提交                          | 权威/持久化                      | 必须隔离                        |
| -------------- | --------------------- | ----------------------------------- | -------------------------------- | ------------------------------- |
| Server连接配置 | connect TUI或参数     | 自建认证→原子配置保存               | canonical server-root配置端口    | 不自动启动/重启任务             |
| 前台启动       | up终端                | 原Supervisor启动/stop               | 既有锁/控制endpoint/状态         | 不另起daemonowner               |
| 后台启动/停止  | up -d/down            | 原daemon/stop-and-wait              | 同一服务实例                     | 不按裸PID杀进程或删业务数据     |
| 日志查看       | logs/-f               | 读取同一持久日志cursor              | 现有日志设施与最小lifecycle sink | 不启动服务、不退出时停服务      |
| 手机登录       | fork登录入口          | 同账号密码→Relay凭据                | 自建认证边界                     | 不恢复官方模型账号              |
| 手机项目/聊天  | 现有手机首页/会话组件 | bootstrap/bridge→原RPC/CommandInbox | 原Core/CLI/runtime               | 仅当前terminalowner；replayable |
| 手机替换/离线  | 现有transport状态页   | 原V2 KICKED/DEVICE_OFFLINE/恢复     | 当前socket/attachmentowner       | 不新增多对多或离线缓存策略      |

## 共享与差异

共享：V2 wire/schema、心跳、分片CRC/ACK、手机显示与现有Server生命周期。新增：密码登录适配、Worker/DO实现、headless bootstrap/attachment端口、命令分发与日志读取。Source Server普通scope与Electron手机白名单必须逐项比较，不能当作完全等价。

## 关联优先级

| 优先级         | 关系/原因                                | 源码起点                                                                 |
| -------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| must-inspect   | 命令分发→发行包/旧桌面自动部署           | cli.ts、runtime/stableLauncher.ts、scripts/zcode-distribution/runner.mjs |
| must-inspect   | up/down→唯一Supervisor与canonical root   | cli.ts、runtime/paths.ts、shutdownWait.ts                                |
| must-inspect   | logs→真实持久日志与轮转cursor            | 当前logger设施；需验证Core/daemon stdio丢弃边界                          |
| must-inspect   | connector→原Core terminal attachment     | server-core/core.ts/http.ts                                              |
| must-inspect   | Relay→同SID单roleowner                   | shared/web-remote-relay/contract.ts与官方配对规格                        |
| must-inspect   | raw传输→内存/字节/ACK边界                | shared/web-remote-control-rpc-transport.ts                               |
| invariant-only | 新远控→旧SSH、WebDAV、desktop continuous | 原生命周期、配置与移除守卫                                               |

## 状态所有者和不变量

配置归Server配置端口；进程归原Supervisor；登录/设备/票据/配对归RelayRoom；scope归Core；任务/已接纳输入归CLI；草稿归当前浏览器。Relay与Main均不保存task/snapshot/queue。

第二个terminal替换旧terminal；不能把同账号解释为允许广播。wire SID不等于sourceServerId。旧close不删新owner，旧bridge不污染新attachment。down会停止服务，logs Ctrl+C只退出查看，connect不启动服务。

## 证据与图谱

本轮用精确源码读取/rg核对直接调用深度1–2，未运行codegraph。已落地的直接节点是 `fork-remote-relay`、`fork-remote-connector`、`server-cloud-web-access`、Web 自建登录入口及其上行接线；发行包分发、公网 Worker 和真实模型仍未验证。

此前多路外壳、byte-credit、IndexedDB/离线 app shell 和多对多阶段不再属于本期。验证覆盖以 acceptance.md 为准；本地浏览器闭环有证据，但真实公网手机和模型回复仍为未验证。
