# 本期验收与覆盖矩阵

状态：2026-11-03，分支内实现。表中 `partial` 只表示已有自动化或本地运行时证据，不等于完整产品验收；`not-run` 不冒充通过。真实 Cloudflare、正式发行包、真实模型和公网手机仍是放行边界。

## 1. 范围确认

| 决策                                                        | 状态                        |
| ----------------------------------------------------------- | --------------------------- |
| 单租户账号密码、Worker Relay、Server 主动出站               | 已实现，本地 workerd 验证   |
| 同 SID 单 terminal owner，新连接替换旧连接                  | 已实现，保持官方            |
| 手机等待/重连/离线行为及现有缓存                            | 保持官方；未做手机网络验收  |
| connect TUI/参数；up 阻塞、-d 后台；down；logs/-f           | 已接线；完整发行包矩阵未跑  |
| 多手机同控、离线只读、IndexedDB、Fork 多路外壳、WebDAV 替换 | pruned，本期不做            |
| 启动等待 30 秒、日志默认 200 行/轮转 7 天/单文件 10 MiB     | 已固定并有定向测试/源码检查 |

## 2. 用例

| ID     | 前置与动作                                                                                                                       | 必须断言                                                                                                             | 当前证据（2026-11-03）                                                                                               |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| CWA01  | 匿名、错误密码、正确账号密码访问自建登录/设备/WS                                                                                 | 无默认口令；权限正确；无密码回显/泄露                                                                                | partial：relay workerd 认证/票据测试；无默认值                                                                       |
| CWA02  | V2 register/list/delete/token 的合法、缺字段、额外字段、归属和状态组合                                                           | 当前 shared schema 与官方业务码/信封契约满足                                                                         | partial：合法、非法 role、缺字段；完整组合仍待补                                                                     |
| CWA03  | token 并发消费、重复/过期 Upgrade、非法角色                                                                                      | 原子单次使用，角色不能自述升级                                                                                       | partial：重复消费/角色测试；并发和过期 Upgrade 未压测                                                                |
| CWA04  | 两个同 SID terminal 先后连接                                                                                                     | 旧端 KICKED；旧 close 不删新 owner；按官方有界重试/冲突停下                                                          | partial：真实 workerd 替换和旧 close fencing；未跑两浏览器                                                           |
| CWA05  | 同账号两个不同 SID 独立配对，其中一个下线                                                                                        | 不串 payload；另一对不受影响；不是多手机同控                                                                         | not-run：未做双 SID 设备故障注入                                                                                     |
| CWA06  | device/terminal 各自断开、手机后台恢复与 waiting                                                                                 | 消息/关闭规则和官方一致，不新增离线只读路径                                                                          | partial：设备断开清空 meta；手机后台/恢复未跑                                                                        |
| CWA07  | DO 休眠、重建、平台掉线/发布                                                                                                     | owner/ticket/设备身份正确；无旧 owner 复活                                                                           | partial：hibernation API + alarm 单测；强制 eviction 未跑                                                            |
| CWA08  | connect TUI：首次、修改、取消、EOF、认证/落盘失败                                                                                | 掩码输入；成功才保存；失败保留原配置；不启动服务                                                                     | partial：prompt 边界和认证失败保留旧配置；EOF/取消未跑                                                               |
| CWA08a | logout 在运行、停止、无配置和删除失败场景                                                                                        | 先停止再清凭证；失败不伪装成功；不删除业务数据                                                                       | pass：配置清理与 CLI 幂等回归                                                                                        |
| CWA09  | connect 参数模式、stdin 密码、无 TTY/缺参数、未知参数                                                                            | 非交互可用；不挂起；不在 argv/日志写密码                                                                             | partial：parser 和 stdin 读取实现；真实进程 stdin 未跑                                                               |
| CWA10  | zcode server 根帮助、发行包/开发入口、旧内部 serve/proxy-stdio                                                                   | 新分发到同一 Server CLI，旧桌面链路不退化，无 legacy 递归                                                            | partial：源码 parser/types 和普通 serve 模式门控；发行包未验                                                         |
| CWA11  | up 首次前台启动，Relay waiting 后手机配对                                                                                        | 只有收到合法 auth_ack 才 ready；waiting 即远控就绪；不等手机                                                         | partial：本地真实 Supervisor/Core + workerd 已闭环                                                                   |
| CWA12  | 前台 Ctrl+C；另一终端 down；Core 错误退出                                                                                        | graceful stop 与锁释放；返回正确状态；任务不自动重放                                                                 | partial：实际 down 成功；信号和崩溃矩阵未跑                                                                          |
| CWA13  | up -d 与重复后台 up；已经运行时前台 up                                                                                           | 后台就绪后返回；不重复 Core；前台不抢生命周期                                                                        | not-run                                                                                                              |
| CWA14  | 未配置、认证失败、网络/启动超时、清理失败                                                                                        | connect/up 非零且有上下文；更新及普通 serve 的 Relay 失败不回滚                                                      | pass：单测与真实 ARM64 更新 handoff                                                                                  |
| CWA15  | connect 在运行中换地址/账号，并发 up/down/update，root 符号链接                                                                  | 要求停机后改配置；共用 canonical root 与生命周期协调                                                                 | not-run                                                                                                              |
| CWA16  | down 运行中/已停止/control 故障/锁未释放                                                                                         | 显式停止整个 Server 并等真实终态；未运行幂等；不删数据                                                               | partial：本地运行中 down 成功；其余分支未跑                                                                          |
| CWA17  | logs 普通历史、全新无日志、停止后日志、无权限                                                                                    | 只读；最近 200 行；具体错误；不加载或启动 Agent                                                                      | partial：跨轮转读取/最近行单测；无权限和真实进程未跑                                                                 |
| CWA18  | logs -f 切换历史到实时，轮转/Core 重启，Ctrl+C                                                                                   | 无漏/重复；跟新日志；退出跟踪不停止服务                                                                              | partial：新文件首行跟读单测；真实轮转/Ctrl+C 未跑                                                                    |
| CWA19  | 真实 Server 主动连接公网 Cloudflare，手机 390px/宽屏登录选项目并聊天                                                             | 无入站端口/Tunnel；Relay 登录不等待官方 OAuth；真实模型回复                                                          | partial：本地 workerd + 真实 Core + 390px 浏览器进入工作区；模型/公网未跑                                            |
| CWA20  | 真实 Agent 权限/提问、断网发生在命令接纳 ACK 前后                                                                                | 原 owner 裁决；恢复对账不重复执行；错误分层                                                                          | not-run                                                                                                              |
| CWA21  | bootstrap/项目 root 列表、Core 在 router 订阅前发送 Initialize、local bridge、新建项目目录浏览、伪造 trusted-host、headless 操作 | 早到 Core 帧按序交付；“此电脑”读取 Server 本机目录；可选 window-controller 不发请求；旧代 frame 拒绝；缺能力明确反馈 | partial：真实 WebSocket 早到 Initialize、setting RPC roundtrip、公网 local bridge 新建项目目录浏览；其余故障注入未跑 |
| CWA22  | 1/6/8/16 MiB 消息、坏片/CRC/丢 ACK、慢接收/配额                                                                                  | 既有尺寸/重放边界成立；无持久正文或无界队列                                                                          | not-run at Relay boundary；仅有 shared transport 既有测试                                                            |
| CWA23  | Server 下线后手机刷新、冷/热页面                                                                                                 | 沿用官方离线/配对流程，不宣称新增离线阅读；原缓存行为不改                                                            | not-run：只做 source/契约审计                                                                                        |
| CWA24  | 注入敏感占位符、JWT/token、密码与 RPC 正文到失败路径                                                                             | 持久日志/前台/logs 都不泄露；保留错误上下文                                                                          | partial：日志脱敏单测；全失败路径注入未跑                                                                            |
| CWA25  | Desktop 本地模式打开项目侧栏远控入口，尚未配置 Relay                                                                             | 入口可见；展示自建地址、账号和密码表单；不跳转官方 OAuth                                                             | pass：隔离 Desktop 实例实际打开侧栏入口和配置表单                                                                    |
| CWA26  | Desktop 提交合法或非法 Relay 配置并重新打开弹层                                                                                  | Main 校验登录；密码不持久化；错误保留具体上下文                                                                      | pass：配置合同与凭据边界回归                                                                                         |
| CWA27  | Desktop 配置成功后启动、扫码、复制链接、停止与重启                                                                               | 复用现有连接与 attachment；链接指向自建 `/remote/v4`                                                                 | partial：生产构建通过；未使用真实账号完成扫码控制                                                                    |
| CWA28  | Desktop 会话被 epoch 撤销或更换 Relay 地址、账号                                                                                 | 回到重新登录；旧设备身份不跨地址或账号复用                                                                           | pass：撤销会话与地址、账号隔离回归                                                                                   |

## 3. 测试组织与剪枝

Relay 使用真实 workerd 测试 HTTP/WS、一次性票据和 owner 替换；Connector 使用真实 Router/生命周期合同测试；Server CLI 使用隔离 server-root 和真实 `ServerCore` 清理测试；Web 使用 Vitest 入口/认证/transport 合同测试；UI Root 增加自建远控启动门控回归。

正式 E2E 尚未把全部 CWA 用例提升到全局矩阵；本地浏览器回放不是正式 CI 准入。Workerd 单元测试不能替代 Cloudflare staging 的 eviction、配额和网络故障。

## 4. 放行条件

本地源码实现完成不等于本期产品完成。至少需要：

1. 已完成：补齐 CLI 构建产物后通过 fork/contracts 定向与全量测试；
2. 已完成：根 typecheck、architecture、removal 通过；根 lint 保留既有 85 warnings、0 errors；
3. 正式发行包验证 `zcode server` 分发；
4. Cloudflare staging 验证认证、DO migration、eviction、日志和静态资产；
5. 真实 Server + 受控模型 + 手机/浏览器完成聊天、权限、KICKED 和下线恢复场景。
