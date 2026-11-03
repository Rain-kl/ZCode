# Cloud Web Access 自建 Relay 最小实现

日期：2026-11-03

## 背景与边界

用户要求在云主机运行 ZCode Server，浏览器通过用户自建的 Cloudflare Worker/Relay 访问，单租户共享账号密码，不开放 ZCode 入站端口，不使用 Cloudflare Tunnel。本期保持官方 V2 单 terminal owner：新连接替换旧连接，不做多手机同控、离线只读、IndexedDB 或 WebDAV 替换。

实现位于隔离 worktree `ZCode-cloud-web-access` 的 `codex/cloud-web-access` 分支；原工作区未改动，不推送。

## 状态所有者

- Worker 负责同源登录、静态 Web、单租户 HMAC 会话和 `/api/*` 路由。
- `RelayRoom` Durable Object 唯一拥有设备、一次性票据和 `(device_sid, role)` owner；票据在 transaction 单次消费，alarm 清理过期票据。
- Server connector 唯一拥有设备 WS 和当前 App bridge；Core 继续拥有服务、Agent、任务队列和项目事实。
- `zcode server` 命令只配置/调度既有 Supervisor、Core、canonical root 和锁；不建立第二套 daemon。
- 浏览器只保存 Relay 会话令牌，不保存密码；任务正文和 RPC 数据不进入 Relay 持久存储。

## 关键接线

`packages/fork-remote-relay/**` 实现 Worker/DO、PBKDF2-SHA256（210000 次）、12 小时两段 HMAC 会话、V2 HTTP/WS 和静态资源。`packages/fork-remote-connector/**` 通过既有 Core loopback `/ws` 接入 `web-remote-replayable`，bridge ready 之前不发送 queued raw frames，旧 generation 和迟到异步 open 被隔离。

`packages/zcode-server-cli/src/fork/cloud-web-access/**` 提供配置、日志和模式门控。`server up` 强制要求有效配置；普通 `serve` 没有配置时不启动 Relay，以保持既有 SSH/WSL/Docker 路径。OS service descriptor 会把 `--require-remote-config` 带到下一次服务重启。

Web `/remote/v4` 使用同源账号密码登录；官方 OAuth 仍只服务分享页。Root 在自建远控已认证后不等待官方 OAuth 恢复，修复设备选择后空 `h-dvh` 白屏。

## 失败与清理顺序

Relay 启动失败必须按 `connector.stop()` → Core HTTP close → services dispose 清理；每个后续清理都继续执行，但原始启动错误保留为最终错误。Core 关闭时先释放外部 attachment，再关闭 loopback Core。

## 验证与未验证

本地临时 workerd + 隔离 server-root + 真实 Supervisor/Core：登录、设备注册、`auth_ack waiting`、bootstrap、390×844 浏览器进入工作区、`server down` 成功。Relay workerd/DO 测试、Connector 测试、Server CLI 配置/日志测试、Web 认证/transport 测试和根 typecheck 已通过。

未验证真实 Cloudflare 公网、强制 DO eviction、正式发行包、真实模型回复、权限交互、手机后台、网络故障和完整 `up -d` 矩阵。远程登录当前没有 Worker 内置 IP 限速，生产需在 Cloudflare WAF/网关配置；部署安全步骤见 `docs/features/cloud-web-access/deployment.md`。

测试使用临时凭据和 provider 快照，不读取或覆盖生产账号、模型密钥或会话数据。
