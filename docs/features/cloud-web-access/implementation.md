# 本期实施计划与当前证据

状态：只更新设计文档；Relay、connect/up/down/logs和Server连接器尚未实现/部署。

## 1. 当前基线

原源码基线canary 6b007f78；隔离文档工作区`/Users/ryan/Code/Node/ZCode-cloud-web-access`，分支`codex/cloud-web-access`。原工作区已有并行协作/UI改动，全部保留；本轮只改本分支设计文档。

已核实当前Source Server CLI提供serve/stop/status/restart/update等生命周期接口，内部调用用于桌面SSH/WSL/Docker；公开zcode server命令组不能假定已经完整分发。现有canonical root、Supervisor/control endpoint/锁/stop-and-wait是复用基线。日志查看需要核实并补齐持久sink，不能把stdio=ignore当作持久日志。

上一轮根architecture检查0violations，lint85warnings/0errors；typecheck失败于原Excel预览onOpenLink属性和Electron ClipboardItem/参数类型，不是本次文档引入。本轮无产品源码变化，不重复运行这些全量检查，也不将旧失败写成通过。

## 2. 模块建议

| 模块         | 建议位置                                               | 依赖与职责                                                 |
| ------------ | ------------------------------------------------------ | ---------------------------------------------------------- |
| 自建Relay    | 独立`packages/fork-remote-relay/`                      | Worker/DO、认证、V2兼容HTTP/WS、静态手机页；不依赖任务仓储 |
| Node连接器   | 独立`packages/fork-remote-connector/`                  | 既有shared Relay/transport、出站连接；仅依赖宿主公开端口   |
| CLI扩展      | `packages/zcode-server-cli/src/fork/cloud-web-access/` | connect向导/配置、up/down映射、日志读取；复用原生命周期    |
| 手机登录适配 | `packages/web/src/fork/cloud-web-access/`              | 自建账号密码入口、凭据端口；复用官方远控组件/行为          |

这些路径是拟新增，不是当前已存在模块。新增模块登记managed、publicEntrypoints与单向依赖；上游组合根接线保持最小连续diff及FORK标记。正式实施时更新FEATURES，不把本文档列为已经上线功能。

## 3. 开发顺序

1. 固定自建登录返回和持久配置合同，复用V2 schema；先补Worker/CLI依赖契约红灯再实现。
2. 实现Worker/DO登录、设备、票据原子消费、单owner替换/清理、心跳与透明转发。保持官方wire；验证真实workerd尺寸/慢接收/内存边界。
3. 实现Server连接器与Core窄attachment端口；不复制Electronmanager、不新建服务容器或Agent。先验证bootstrap/项目/能力白名单和替换后的scope回收。
4. 实现zcode server命令分发及connect TUI/参数；up/down复用Supervisor与canonical root。先做发行包真实入口与旧serve/proxy-stdio兼容回归。
5. 补齐持久日志sink与cursor，实施前台输出、logs普通读取与-f轮转/重启跟踪；写入时脱敏。先有进程/日志回归再改实现。
6. 手机只接自建登录与endpoint，保留官方单owner、KICKED、waiting/离线和缓存。先维护浏览器场景再接入口。
7. 真Core/Agent/受控模型→Worker→手机公网闭环；全部acceptance用例planned，实际通过后登记证据与review。

不增加多路Relay协议、byte-credit消息、IndexedDB、离线只读、多手机同控、备份、通知或远程更新入口。

## 4. 部署准备

Cloudflare：Worker名称、测试/生产DO隔离、绑定/migration、静态资源版本、自建固定账号/密码校验/签名Secrets、TLS、日志query脱敏与资源费用监测。密码安全输入，不发在聊天或写Git。

云主机：受支持Linux/架构、Server运行包、运行账号与数据目录、模型配置、出站HTTPS/WSS网络。通过拟实现connect配置、up前台或-d运行，logs查看、down停止。当前这些新增命令尚未可用，完整运行手册要等实际help/发行包验收后填写。

## 5. 验证与提交

依据acceptance.md执行CLI进程、V2依赖契约、workerd、真实Core与浏览器、公网手机测试。根typecheck/lint/architecture/removals报告真实结果；不恢复已退役App UT、不刷新baseline隐藏失败。保留未运行环境与实际失败证据。

功能commit仅提交明确文件及对应Agent Note，Conventional Commits，不推送。原工作区并行修改与文档分支无关，不纳入本次提交。

## 6. 设计交付

文档组：design.md、cli.md、protocol.md、acceptance.md、impact.md、implementation.md。全部是设计/计划，未宣称任何功能测试通过、Worker已部署或手机已经可访问。此前多对多与离线阅读草案已由本稿取代，不再是本期实施要求。
