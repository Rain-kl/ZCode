# zcode server 命令行与生命周期合同

状态：2026-11-03 已接入当前源码入口；统一安装与稳定 launcher 已完成本机 darwin-arm64 实包验证，Linux 实机与公网发行安装仍待验收。以下记录命令行为、错误、资源归属和验收边界。

## 1. 命令组

| 命令                                                                                     | 行为                                        | 是否阻塞                | 是否启动/停止服务         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------- | ------------------------- |
| `zcode server`                                                                           | 输出本命令组帮助与使用方式                  | 否                      | 不启动                    |
| `zcode server connect`                                                                   | TUI 配置向导，校验并保存连接信息            | 仅交互期间              | 不启动、不停止            |
| `zcode server connect --url https://relay.example.com --username owner --password-stdin` | 非交互配置，密码由 stdin 提供               | 至验证/保存完成         | 不启动、不停止            |
| `zcode server up`                                                                        | 前台启动，直接输出日志，行为类似 compose up | 是，持续到服务停止/退出 | 启动本实例；Ctrl+C 停止它 |
| `zcode server up -d`                                                                     | 后台启动并报告结果                          | 等就绪后返回            | 启动或复用已有后台实例    |
| `zcode server down`                                                                      | 停止对应 Server 并等待结束                  | 至停止/超时             | 停止整个 Server           |
| `zcode server logs`                                                                      | 输出持久日志最近 200 行后退出               | 否                      | 不启动                    |
| `zcode server logs -f`                                                                   | 先输出最近 200 行，再持续跟踪新日志         | 是                      | 不启动，Ctrl+C 只退出跟踪 |

`--url` 和 `--username` 是连接信息参数；密码采用 masked TUI 或 `--password-stdin`，不要求命令行明文密码参数。自动化也可从受限文件重定向 stdin；帮助与错误不回显密码。文档中的 example.com 只是占位符。

既有 `--server-root` 选择目标实例，统一解析 canonical realpath；本期不再建立另一套实例目录。已有内部命令及 `--json` 行为保持兼容。普通 `zcode` 的 TUI/Agent 入口不改变，只有完整 server 命令组被分发给 Server CLI。

## 2. connect：交互与非交互

交互顺序：读取现有非敏感配置 → URL → 用户名 → 掩码密码 → 检测服务/协议 → 登录 → 显示安全结果 → 原子保存 endpoint、账号身份、可撤销凭据和非敏感显示配置。

已存在的凭据不能以明文填入密码输入框。可选择保留原有效登录或重新认证；取消/EOF 不写配置。无 TTY 且参数不完整时失败并提示缺失字段，不无限等待输入。

非交互时 URL/用户名必须显式完整；stdin 按文档约定读取一份密码，限制长度，不把后续内容作为其他命令。密码去除单个行结束符，不随意 trim 掉有效空白；多余数据/非法编码给明确错误。

先验证新 endpoint/login，再写入同目录临时文件并原子替换；权限、磁盘或认证失败时保留旧配置。不得使用“写了部分配置也返回成功”或无限重新注册掩盖保存失败。

connect 只配置，不负责首次 Server daemon 启动。运行中改变 endpoint/账号会影响设备身份，本期要求先 down，再 connect，再 up；不能在旧 Core 运行时静默换链路或重启任务。更新请求先检查同一生命周期锁/运行事实，避免与并发 up/down/update 竞争。

## 3. up：前台

启动前检查配置完整、canonical root、安装/组件、锁与凭据有效性；复用现有 Supervisor/Core 启动机制，前台进程持有本次生命周期。Core ready 后连接 Relay，等待合法 auth_ack（waiting 或 matched 都算 Relay 已就绪）。没有手机在线不是启动失败。

前台从开始启动即输出日志：本地初始化、Core ready、认证/登记、Relay waiting、手机匹配与断开，以及具体错误。不打印包含密码/token 的连接 URL。

首次网络/Relay 暂不可达时按现有有界退避尝试，等待 `auth_ack` 的启动期限固定为 30 秒；期限到仍未就绪则本次启动失败，清理本命令新建的服务并返回非零。停止/清理失败必须另行报告并保留诊断，不能声称已经完全退出。不得停止启动前已存在的其他 owner。

成功就绪后，短暂 Relay 断线不退出整个 Server；Core/任务继续，日志提示重连。认证失效停止该远控认证重试并明确要求 down/connect/up，不能伪装成模型失败。

Ctrl+C/SIGTERM：转到既有 Supervisor graceful stop 路径，停止接受新工作、结束 relay/attachment、停止 Core/子进程并等锁释放。已有任务可能中断，日志明确提示；不自动重放输入。重复信号和超时沿用既有停止策略，不另建裸 PID kill owner。

## 4. up -d：后台

复用现有后台 daemon 启动机制及其 OS service/受控 detached fallback；不新增 nohup 服务或第二个后台守护进程。前台调用者等待本地及 Relay 就绪后输出安全的实例标识、运行状态与日志位置，再成功返回。

已运行且是同一配置/实例时幂等成功，不再启动另一份 Core。已运行但配置代次不一致时明确冲突，不抢锁。冷启动失败只回滚本次启动资源；启动失败仍可通过 logs 查看完整上下文。

后台运行后的自动服务注册/开机行为沿用既有 daemon 管理规则，help 中写明；本期 -d 不引入新的自启动策略。

## 5. 重复 up 与退出归属

已有实例运行时，前台 up 不自动接管其生命周期：输出 already-running，并引导 `logs -f` 查看或 `down` 后重启。这样 Ctrl+C 不会误停另一个终端/桌面启动的实例。

新前台 up 成功后，另一个终端 down 停止服务，原 up 结束并输出服务已停止。原进程自身异常/Core 崩溃熔断返回非零；人为正常停止返回正常完成状态。不要让日志跟随的 EOF 被误判为任务成功。

## 6. down

down 停止的是整个 Server，包括远控连接与 Core，不是仅退出 Relay。走既有 control endpoint 和 stop-and-wait，确认 stopped、Core 退出、data-root 锁释放后才返回成功。

未运行则幂等成功；停止失败/超时返回非零，并区分 control 不可达、Core 未退出、锁未释放等原因。不能仅凭发送停止 ACK 就输出“已停止”。保留项目、会话、配置、凭据、历史日志和既有服务注册；down 不是卸载。

并发 update/restart/uninstall/down 使用既有生命周期协调，失败不抢占别人的更新；符号链接 root 与实际路径必须命中同一 owner。

## 7. logs 与 logs -f

建立一个以 canonical server-root 为服务实例边界的持久日志流，包含 Supervisor/Core 生命周期及 relay 连接器事件；Agent 高频 debug 不默认全部刷入 info 日志。具体落盘通过现有日志设施接入，若缺少 sink 先最小补齐，不复用生产账号目录做测试。

默认最近 200 行，按稳定 cursor/顺序读。-f 在同一 cursor 后继续，切换历史到跟踪时不丢行/重复。轮转、文件替换与 Core 重启后继续跟踪该服务，不只持有旧文件描述符；建议每日轮转、保留最近 7 天并有总容量上限，参数实施时固定。

服务未运行但有历史日志仍可查看；全新实例没有日志时明确提示并正常结束。-f 可继续等待同实例日志创建，不启动服务；Ctrl+C 只退出 logs，后台 Server 必须继续运行。

日志读取无权限、损坏或存储不可达给真实错误；读取工具不能吞异常返回空。logs 只读日志/状态，不加载业务服务、模型 provider 或 Agent。

脱敏发生在写入之前：密码、Bearer、WS token/query、cookie、API Key 及完整 RPC payload 均不得落盘；每条错误保留阶段、实例、owner/连接代次、安全错误码和 cause。

## 8. 开发与发行包接线

curl 安装和 SSH 共用 `~/.zcode/server` 的稳定入口、releases、current 指针与安装 owner；PATH 命令仅转发，不绑定另一份 archive。CLI 先移除全局 `--server-root`，再归一化 server 子命令，避免无子命令帮助和显式 root 被误分发。完整 Server 包及 agent-runtime 组件均包含同次构建的 `runtime/provider/zcode-builtin.json`。安装合同见 [server-installer.md](../../specs/server-installer.md)。

当前 Source Server CLI 已在源码入口接入 server 子命令，并复用 serve/stop/status/restart/update 等既有生命周期接口。本机 darwin-arm64 实包已验证统一安装、稳定 launcher、server 帮助及 Agent 协议启动；Linux 实机、在线更新和新版本公网分发仍需独立验收。

实施需明确一个公开 `zcode server <subcommand>` 分发入口，并验证稳定 launcher、发行包入口及开发运行入口都能达到同一个 Server CLI；内部 `serve --daemon --json`、`server proxy-stdio` 等桌面调用继续工作。不得用递归 legacyDelegate 造成 TUI 与 Server CLI 循环。

新 up/down 复用旧 serve/stop 的生命周期用例与实现端口；logs 仅订阅日志；connect 仅访问配置/认证。新增命令 parser 需严格拒绝未知参数和冲突组合。

## 9. 成功、错误与可观测状态

最少区分：unconfigured、configured、starting、core-ready、relay-connecting、waiting-terminal、paired、reconnecting、auth-required、stopping、stopped、failed。Core 状态和 Relay 状态分别记录，不能以 paired 代替 Server 运行事实。

参数/配置/认证/网络/文件 IO/启动锁/停止超时各有上下文错误。命令 exit code 为 0 仅表示该命令的完成合同成立；历史日志含错误不意味着 logs 命令必须失败；而“日志无法读取”必须非零。

具体错误码/JSON 扩展在实现 spec 固定，沿用现有公共错误码时保持原值，不将全部失败压成一个提示。
