# Relay 会话撤销不应回滚 Server 更新

日期：2026-11-04

## 根因

自建 Relay 会话改为由 `AUTH_EPOCH` 撤销后，Server 配置中没有本地过期时间可供更新前判断。运行中的旧 Supervisor 启动候选 Core 时沿用严格远控模式，候选 Core 在申请 device ticket 时收到 HTTP 401 并退出。Supervisor 将 Relay 认证失败误判为候选版本不健康，恢复旧 `current.json`，随后才拉起旧 Core。结果是账号撤销阻断了正常的 Server 安装和更新。

## 修复

- 普通 connect/up 继续要求有效 Relay 认证，认证失败时明确失败。
- Supervisor 启动更新候选 Core 时传入仅在本次 Supervisor 生命周期内有效的更新启动模式。
- 已运行的旧 Supervisor 不会传入新变量，因此候选 Core 同时识别更新事务文件；该文件在切换 `current.json` 前写入，能作为兼容升级桥接。
- 更新模式中的 Relay connector 启动失败只停止 connector，并在日志保留 endpoint、HTTP 状态与 cause，然后继续发送本地 Core ready。
- 更新成功后候选 Core 保持运行；后续重启仍沿用该更新启动模式，避免同一会话问题造成 Core 重启循环。
- 真实 handoff 会启动新的普通 `serve` Supervisor，因此普通模式遇到“配置存在但认证已撤销”也必须停止 connector 后本地 ready；只有显式 `server up` 保持严格认证失败。
