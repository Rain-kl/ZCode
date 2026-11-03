# 本期验收与覆盖矩阵

全部用例 planned，未实现、未运行、未进入 CI；用户的新范围取代上一稿的多对多/离线阅读阶段。

## 1. 范围确认

| 决策                                                        | 状态                       |
| ----------------------------------------------------------- | -------------------------- |
| 单租户账号密码、Worker Relay、Server 主动出站               | accepted                   |
| 同 SID 单 terminal owner，新连接替换旧连接                  | accepted，保持官方         |
| 手机等待/重连/离线失败行为及现有缓存                        | accepted，保持官方         |
| connect TUI/参数；up 阻塞、-d 后台；down；logs/-f           | accepted                   |
| 多手机同控、离线只读、IndexedDB、Fork 多路外壳、WebDAV 替换 | pruned，本期不做           |
| 启动等待 30 秒、日志默认 200 行/轮转 7 天等具体默认值       | 设计建议，实施前固定并测试 |

## 2. 用例

| ID    | 前置与动作                                                             | 必须断言                                                    | 证据                      |
| ----- | ---------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------- |
| CWA01 | 匿名、错误密码、正确账号密码访问自建登录/设备/WS                       | 无默认口令；权限正确；无密码回显/泄露                       | Worker runtime/HTTP       |
| CWA02 | V2 register/list/delete/token 的合法、缺字段、额外字段、归属和状态组合 | 当前 shared schema 与官方业务码/信封契约满足                | 依赖契约/workerd          |
| CWA03 | token 并发消费、重复/过期 Upgrade、非法角色                            | 原子单次使用，角色不能自述升级                              | DO 存储/真实 WS           |
| CWA04 | 两个同 SID terminal 先后连接                                           | 旧端 KICKED；旧 close 不删新 owner；按官方有界重试/冲突停下 | 两浏览器/V2状态           |
| CWA05 | 同账号两个不同 SID 独立配对，其中一个下线                              | 不串 payload；另一对不受影响；不是多手机同控                | 真实 socket               |
| CWA06 | device/terminal 各自断开、手机后台恢复与 waiting                       | 消息/关闭规则和官方一致，不新增离线只读路径                 | 故障注入/browser          |
| CWA07 | DO 休眠、重建、平台掉线/发布                                           | owner/ticket/设备身份正确；无旧 owner 复活                  | workerd/staging           |
| CWA08 | connect TUI：首次、修改、取消、EOF、认证/落盘失败                      | 掩码输入；成功才保存；失败保留原配置；不启动服务            | CLI进程/隔离文件          |
| CWA09 | connect 参数模式、stdin密码、无TTY/缺参数、未知参数                    | 非交互可用；不挂起；不在argv/日志写密码                     | CLI进程                   |
| CWA10 | zcode server 根帮助、发行包/开发入口、旧内部serve/proxy-stdio          | 新分发到同一Server CLI，旧桌面链路不退化，无legacy递归      | 真发行包/进程             |
| CWA11 | up 首次前台启动，Relay waiting 后手机配对                              | 阻塞并持续输出日志；waiting即远控就绪；不等手机才启动成功   | 真实Supervisor/Core/Relay |
| CWA12 | 前台Ctrl+C；另一终端down；Core错误退出                                 | graceful stop与锁释放；返回正确状态；任务不自动重放         | 进程/锁/状态              |
| CWA13 | up -d与重复后台up；已经运行时前台up                                    | 后台就绪后返回；不重复Core；前台不抢生命周期                | 进程/owner                |
| CWA14 | 未配置、认证失败、网络/启动超时、清理失败                              | 非零且有上下文；失败不留假成功/幽灵新owner，不停止已有实例  | 故障/日志                 |
| CWA15 | connect在运行中换地址/账号，并发up/down/update，root符号链接           | 要求停机后改配置；共用canonical root与生命周期协调          | 并发进程                  |
| CWA16 | down运行中/已停止/control故障/锁未释放                                 | 显式停止整个Server并等真实终态；未运行幂等；不删数据        | 真实进程/文件             |
| CWA17 | logs普通历史、全新无日志、停止后日志、无权限                           | 只读；最近200行；具体错误；不加载或启动Agent                | 日志夹具/进程             |
| CWA18 | logs -f切换历史到实时，轮转/Core重启，Ctrl+C                           | 无漏/重复；跟新日志；退出跟踪不停止服务                     | cursor/轮转/进程          |
| CWA19 | 真实Server主动连接公网Cloudflare，手机390px/宽屏登录选项目并聊天       | 无ZCode入站端口/Tunnel依赖；真实模型请求一次且回复可见      | Core+模型回放+公网browser |
| CWA20 | 真实Agent权限/提问、断网发生在命令接纳ACK前后                          | 原owner裁决；恢复对账不重复执行；错误分层                   | runtime/network/browser   |
| CWA21 | bootstrap/工作区/手机白名单、伪造trusted-host、headless平台操作        | 不开放完整服务或升权；缺能力明确反馈                        | 接口契约/真实Core         |
| CWA22 | 1/6/8/16MiB消息、坏片/CRC/丢ACK、慢接收/配额                           | 既有尺寸/重放边界成立；无持久正文或无界队列                 | shared adapter/workerd    |
| CWA23 | Server下线后手机刷新、冷/热页面                                        | 沿用官方离线/配对流程，不宣称新增离线阅读；原缓存行为不改   | browser/源码回归          |
| CWA24 | 注入敏感占位符、JWT/token、密码与RPC正文到失败路径                     | 持久日志/前台/logs都不泄露；保留错误上下文                  | log scan                  |

## 3. 测试组织与剪枝

先写规格和CLI/Worker契约回归，确认红灯后实现。交互改动先登记浏览器场景与回放夹具，再改界面。使用两独立浏览器测试“替换”，不得将旧端保持在线作为期望。

两个 Core/不同 SID 只做设备配对隔离回归，不展开新的多对多产品矩阵。缓存/IndexedDB/离线app shell均剪枝；Server停止后的界面按官方当前实现验收。原WebDAV、SSH桌面continuous与模型调用的提交路径保持不变，做代表性回归，不全量恢复退役App UT。

Worker测试使用真实workerd/DO/WS，不用Node mock冒充平台；CLI以隔离server-root和真实进程验证生命周期；会话用真实Core/Agent和受控模型回放，不用echo或UI自造结果冒充。

全部用例登记planned；实施写E2E前按仓库工作流加入全局pending矩阵，真实执行与review后才计covered。当前formal-proof不覆盖Relay/生命周期全状态，不替代上述测试。

## 4. 放行条件

对应Relay、CLI/Server连接层与手机公网闭环全部通过，才能称本期远控完成。记录实际命令、版本、环境与证据路径；未运行的真机、公网、平台组合如实保留未验证。生产数据目录、密码和API Key不用于测试。
