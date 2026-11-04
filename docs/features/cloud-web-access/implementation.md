# 自建云端网页远控实现记录

状态：2026-11-04，Server 通过现有 Relay V2 提供项目导航、会话与文件访问；网页使用 Worker 当前部署。

## 1. 交付结构

| 能力             | 实现位置                                                 | 状态                                                        |
| ---------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| Worker/DO Relay  | `packages/fork-remote-relay/**`                          | 已完成认证、设备/票据、V2 转发、静态页面和 workerd 测试     |
| Server connector | `packages/fork-remote-connector/**`                      | 已完成 Core loopback、AppPayload bridge、代际和启动失败清理 |
| Server 命令/配置 | `packages/zcode-server-cli/src/fork/cloud-web-access/**` | 已完成 connect、配置保存、持久日志、up/down/logs 接线       |
| Web 登录入口     | `packages/web/src/web-remote-control/**` + `packages/ui` | 已完成 `/remote/v4` 同源账号密码登录和 Root 启动门控        |
| Desktop 远控入口 | Desktop Main、平台边界与远控弹层                         | 已完成自建 Relay 登录、会话保存和既有远控连接接入           |
| 根工作流         | `package.json`、`architecture-policy.yaml`、测试清单     | 已接入 typecheck、架构边界和 fork 合同测试                  |

Relay 和 connector 是独立 managed 包；Core、CLI、Web 的上游文件只保留组合根和入口适配，并用 `FORK(cloud-web-access)` 标出产品接线。配置和日志路径属于 Server 实例的 canonical root，不建立第二套 daemon 或数据目录。

## 2. Relay

`packages/fork-remote-relay/src/worker.ts` 提供：

- `POST /api/fork-remote/auth/login`：单租户用户名/密码校验；当前密码 KDF 为 PBKDF2-SHA256 100000 次（生产 Workers CPU 安全预算），HMAC 会话为两段 `payload.signature`，不设时间过期，响应字段是 `token`、`userInfo`。会话声明只保留账号与 `AUTH_EPOCH` 版本，轮换 epoch 即撤销全部旧会话。
- 复用 shared 的 V2 register/list/delete/token 和 `/api/v1/remote/ws2`；浏览器和 Server 不进入官方 OAuth。
- `/remote/v4` 提供当前构建的页面及哈希资源，未知 `/api/*` 返回 JSON 404。
- 有 `Origin` 时要求同源；Node/CLI 请求可以省略 Origin，WS 仍必须使用一次性票据。

`packages/fork-remote-relay/src/relayRoom.ts` 是单租户设备、一次性票据和 `(device_sid, role)` owner 的唯一协调者：

- 角色在消费票据时确定，`auth_init` 不能自述升级；
- 新 terminal 替换旧 terminal，旧连接收到 `KICKED`；旧 close 不能释放新 owner；
- 设备上线时保存 `auth_init.meta`，设备断开后清空 `meta`，离线列表仍保留设备记录；
- 票据单次消费在 DO transaction 中完成；过期票据由 DO alarm 清理，签发下一张票不承担唯一清理职责；
- 转发 `data.payload` 原样透明，不解析或持久化任务、快照和业务正文。

## 3. Headless connector

`packages/fork-remote-connector/src/connector.ts` 只拥有 Relay socket 和当前 App router：

1. Core 先创建普通 loopback HTTP/WS 和既有 services；
2. connector 使用持久 `device_sid` 申请 device ticket，主动连接 Relay；
3. 收到合法 `auth_ack` 后，Supervisor 才看到 Core ready；`waiting` 不等手机在线；
4. 手机发送 bootstrap/workspace-list 时，connector 从注入的现有 `IProjectService` 快照回答；
5. `workspace-bridge-open` 才打开同一 Core `/ws` 的 `web-remote-replayable` attachment；loopback bridge 从 socket 建立起按序保留 Core 帧，router 订阅后先交付早到的 RPC `Initialize`，ready 前排队 raw frame 不发送；
6. 旧 bridge、旧 ACK、迟到的异步 open 和旧 RPC 代次不能推进新代；被替换 terminal 只释放自己的 bridge，不停止已接纳的任务；
7. 启动失败按 connector stop → HTTP close → services dispose 顺序清理，每个清理步骤不掩盖原启动错误。

平台层只返回 headless 可用的安全结果；需要 Electron handler 的操作明确返回 unsupported，不挂起手机页面。

项目创建沿用现有项目服务：浏览器的“此电脑”由 Server 解释为自身 owner。宿主适配层复用项目、会话目录与工作区身份服务，提供项目列表和导航。当前主机提供 remote attachment，并声明实际窗口能力；网页依据可信目录宿主身份显示、保存项目和读取文件。

打开项目准备该项目的执行目录；打开历史任务核实主机、任务与工作区，并使用原目录。普通项目树读取也完成新建项目和历史任务的身份登记。Connector 负责页面与 bridge 代际、取消和失效通知，宿主服务继续保存项目和会话事实。

## 4. Server CLI 和日志

公开命令组映射到既有 Server 生命周期：

```text
zcode server connect
zcode server logout
zcode server up
zcode server up -d
zcode server down
zcode server logs
zcode server logs -f
```

- `connect` 支持 TUI 或 `--url`、`--username`、`--password-stdin`；密码只从 masked TTY 或 stdin 读取，不进入 argv。先登录并注册设备，再以临时文件 + rename 原子写入 `config/remote-connection.json`，POSIX 权限为 `0600`。
- `logout` 复用停止并等待的生命周期 owner；Server 收口后持有 data-root 锁删除 `config/remote-connection.json` 及其写入临时文件，避免运行中凭证继续有效或并发启动重新读回。无配置时幂等成功，不删除业务数据和其他配置。
- 配置保存 endpoint、会话令牌、`deviceMid`、`deviceSid` 和用户显示信息；不保存密码。运行中的 Server 会被生命周期锁阻止换配置。
- `up` 复用现有 Supervisor/Core；前台展示真实 Core 日志，`-d` 复用已有后台 daemon，并把 `--require-remote-config` 写入 OS service 参数。配置缺失、认证失败会让正常启动失败并保留具体原因。更新候选 Core 使用独立的更新启动模式：Relay connector 启动失败时停止 connector、记录原因并继续完成版本切换，外部 Relay 状态不参与版本健康判定。
- 普通 `serve` 或更新 handoff 后的 Supervisor 遇到已有配置但 Relay connector 启动失败时，只停止 connector、记录原因并继续本地运行；显式 `server up` 仍严格失败。这样会话撤销不会造成 Core 重启循环，用户可随后重新 connect。
- `down` 调用既有 stop-and-wait 生命周期，不停留成只关 Relay 的伪停止。
- `logs`/`-f` 读取 canonical root 的 `logs/server-YYYY-MM-DD.log`，默认最近 200 行；日志写入前脱敏，按日文件轮转，保留 7 天，单文件日上限 10 MiB；`-f` 只跟踪日志，不启动或停止 Server，并会从快照之后新出现的文件开头跟踪。

## 5. Web

`/remote/v4` 的登录表单使用同源 `/api/fork-remote/auth/login`。浏览器只在 `localStorage` 保存临时 Relay 会话，不保存密码；会话校验失败、Relay 返回 401 或 logout 会清理本地会话。登录后继续使用现有设备列表、V2 transport、KICKED 和已知设备行为，不新增离线只读或多手机同控。

Root 增加了自建远控启动门控：Relay 已经完成认证时，官方 OAuth 恢复不能阻塞 initial workspace 注入；普通非远控 Root 仍保持官方 OAuth 行为。此修复解决选择设备后出现空 `h-dvh` 白屏的真实浏览器问题。

## 6. 本地闭环证据

2026-11-03 在临时隔离 `HOME`、临时 server-root 和本地 workerd 上完成：

- Web 构建成功；`/remote/v4` 返回 SPA，真实静态资源可读，未知 `/api` 返回 JSON 404；
- `zcode server connect` 登录并注册设备，配置不含密码，`zcode server up` 启动真实 Supervisor/Core；
- 设备从离线变为在线，bootstrap 返回真实项目快照；浏览器在 390×844 登录、选择设备并进入工作区；
- `zcode server down` 停止同一实例。

部署步骤见 [deployment.md](deployment.md)，当前项目会话验收见第 10 节。

## 7. 已执行验证

- Relay：6/6（真实 workerd、认证/V2、票据单次消费、owner 替换、离线 meta、alarm 清理、Workers-safe KDF 预算）；
- Connector：11/11，包含真实 WebSocket 在 router 订阅前发送 RPC `Initialize` 并完成 setting channel roundtrip；Server CLI 定向 13/13；tsup 工程测试 4/4；
- Web 认证/transport 定向 19/19；self-hosted auth 错误语义回归 7/7；UI Root startup 回归纳入 fork 合同清单；
- Desktop 自建 Relay 配置、撤销后重新登录与现有远控回归 19/19；隔离 Desktop 实例已确认侧栏入口和地址、账号、密码表单；Desktop 生产构建通过；
- `pnpm test:unit:fork` 10 组通过；补齐 CLI 构建产物后 `pnpm test:unit:contracts` 53 文件/1165 测试通过；
- 根 `pnpm typecheck` 通过；根 `pnpm lint` 为 85 warnings/0 errors（既有警告）；架构变更检查 0 违规；`pnpm fork:check-removals` 通过；CLI build、Web lint/build、Relay/Connector lint 通过。

提交前已重新执行根 typecheck/lint/architecture/removal；root lint 的 85 warnings 保留为既有结果，不把 0 errors 写成全量无告警。

## 9. Server 安装路径与资源统一（2026-11-03）

旧一键安装脚本在 `.local/share/zcode-server` 自行维护第二套运行包，而 SSH 用 `.zcode/server/current.json`；同一 CLI 可能与实际运行版本不同。脚本现只下载、校验和临时解压，再调用包内 `update --from-archive --server-root`，由既有 ReleaseInstaller/ReleaseManager 持有生命周期锁并维护不可变目录、完整性、pending/current 和稳定入口。PATH 包装器始终执行统一入口，绑定相同 root，SSH 切换版本后自动跟随。旧脚本入口迁移后保留原始文件，不复制或删除会话与凭据。

用户反馈的 `无法定位 CLI ZCode Built-in Provider Config` 根因为 staging 只复制 `zcode.cjs` 而没有复制它旁边的 `provider/zcode-builtin.json`；`--version` 无需 provider，之前的版本检查未覆盖这一缺件。`packaging/stage.ts` 现在把 Agent dist 同次构建的配置复制到 `runtime/provider` 并纳入 agent-runtime 的 paths、哈希与组件归档。缺件在 staging、发布校验和安装前置检查时都明确失败；不靠用户下载零散配置修补。

规格和验收边界见 [server-installer.md](../../specs/server-installer.md)，本次验证记录见 [Agent Note](../../../.agents/notes/cloud-web-access/2026-11-03-unified-server-install.md)。远控使用 `zcode server connect/logout/up` 与 Relay 网页。

## 10. 宿主对齐验收（2026-11-04）

规格见[宿主合同](host-contract.md)，版本部署配置见[部署说明](deployment.md)。

- **CWA29**：在隔离数据目录运行真实 Core、CLI、SQLite 和 390×844 浏览器，以受控模型验证空主机创建项目、项目内首次发送、收到回复、刷新恢复、Relay 断线后继续发送、项目文件浏览；任务 ID、归属与执行目录保持一致。已有项目入口执行同样闭环；宽屏同目录多项目验证草稿刷新后仍归属用户选择的项目。
- **宿主与连接合同**：真实项目与身份映射服务的 10 个场景、Core 清理的 2 个场景通过；Connector 的导航、代际、取消、错误上下文和 Core 断连通知 17 个场景通过。
- **CWA30**：本地 workerd 验证不同连接版本参数均进入当前页面，资源类型、HEAD 与缺失资源反馈正确。
- **应用检查**：fork 依赖合同 58 文件、1181 测试通过；根类型检查、Lint、架构与移除守卫通过，Lint 保留 85 条既有警告。

可重放入口：`packages/web/test/e2e/manual-review/pending/self-hosted-server.mjs`，空主机场景传入 `--empty`，同目录多项目场景传入 `--same-root`。证据及环境范围见 [Agent Note](../../../.agents/notes/cloud-web-access/2026-11-04-host-alignment.md)。

## 11. 慢链路体验（2026-11-04）

功能规则见[慢链路体验](slow-network.md)。当前项目的新草稿保留页面和连接；目录复检失败展示原业务原因，目录身份变化按宿主导航处理。项目树与入口目录并行读取，远端缓存内容变化时更新其版本。

可靠帧拥塞进入当前 Core 连接的既有流控 scope，CLI 沿原发布器暂停、合并与恢复投递。非法控制格式与伪造连接身份由传输边界拒绝。

弱网浏览器对照：每方向 150 ms、64 KiB/s，当前项目草稿入口约 2.87 秒降至 0.87 秒，额外 bridge 从 1 次降至 0 次；首次回复约 10.96 秒降至 5.76 秒。当前回放的首屏约 7.8 秒，刷新恢复约 6.9 秒，重连后回复约 1.9 秒。两次用户发送分别收到正文回复，保留同一任务、项目与目录；标题生成单独计数。

回放入口为 `packages/web/test/e2e/manual-review/pending/self-hosted-server.mjs --slow --reuse-draft`；同目录多项目和空主机分别使用 `--same-root`、`--empty`。证据和检查结果见 [Agent Note](../../../.agents/notes/cloud-web-access/2026-11-04-slow-network.md)。

草稿推荐的场景响应 JSON 从 142872 字节降至 2807 字节，约减少 98%。网页首次进入会话的子智能体目录请求为零；打开 `/` 后正常显示候选，重复打开复用缓存。场景筛选保持完整目录读取、业务错误与网络错误的原有结果。弱网回放增加 `--catalogs` 验证这组行为，并记录各阶段 RPC 名称、执行耗时及响应体积。
