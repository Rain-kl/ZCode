# Task3b：同根协作 runtime 接线

用户要求全面替换旧协作工具。本批删除旧 runner、执行端口、模型输入输出 schema 和消息写入 owner，
不增加兼容别名。Task3a 已双审；本批提交后再做独立 spec→quality，尚不宣称 Task4 客户端验收完成。

## 所有者与事件顺序

root session 的 codex_collaboration entry 是 accepted/身份/generation/mailbox 的唯一 durable owner。
prepare child→install sink→admit raw prompt+turn reservation→save accepted→run 标准 reserved command。
模型 IO 不在 prepare/admit。ToolPart metadata、生命周期事件、runtime task registry 都是派生查询，
不反向写 accepted；crash gap 通过公开 canonical relation 查询恢复。

mailbox ACK 后 driver 暂存未消费输入，controller 原先 wait 只读自身邮箱，会丢失 provider in-flight
期间已发生的通知。先补 controlled runtime RED（预期1秒内第二请求、实际仍一请求），再添加有限只读
hasUnreadMessages 到既有 subscribe-before-check；不增加 polling、第二消息队列 owner 或新 wait owner。
权限/显式 message wait 的实际父 steer 验证证明独立 child 不被取消；关闭才 dispose 全树。

新 child profile/AGENTS 和 resolved ModelSelection 分别保存到严格版本化 child settings 与既有模型 entry。
all 从实际 parent closed history 继承，无 active tool batch、无活动授权；none 才允许合法覆盖。
profile/type/model 的错误给出实际 available 集合。卸载 nested parent 不允许 fallback root prepare；
已经接受的后代完成沿真实 parentSessionId 发布。执行期背景策略拒绝启动新异步 child，不影响已运行轮次。

## 保留覆盖与精确文件映射

新增 runtime 源码集中在 `apps/zcode-cli/packages/core/src/fork/codex-collaboration-runtime/`；
其 contract/module/CONTRACT/example/smoke、managed架构登记与 public @zcode/core relation 入口同批提交。
其余宿主接线为 runtime/agent-runtime、runtime/helpers/{runtime-tools,steering,provider-entry-origins,
tool-allowlist,agent-listing}、turn/model/history/session-fork 边界及 bootstrap app/session facade。
删除清单由 commit 的完整 name-status 与 scripts/fork-removal-rules.mjs 直接确定。

| 验收边界 | 测试文件（core 包相对路径，除特别标注） |
| --- | --- |
| 实际6工具/旧调用未知/持久准入/profile&model/普通无storage能力turn/fork/执行期deny | test/fork-codex-collaboration-runtime/runtime.test.ts |
| 持久输入先于IO/父完成child存活/steer/权限与message等待/早到邮件wait/投影重试/关闭 | test/fork-codex-collaboration-runtime/lifecycle.test.ts；runtime.test.ts |
| 冷同会话与saved model/profile/错误历史/私有provenance/nested卸载/瞬态执行材料 | test/fork-codex-collaboration-runtime/recovery.test.ts |
| child fresh grant，不复制活动授权 | test/fork-codex-collaboration-runtime/permissions.test.ts |
| controller状态/容量/幂等/释放重试/关闭 | src/fork/codex-collaboration/{controller,cleanup-races,contract}.test.ts |
| Bash/workflow TaskOutput/Stop、generic backgrounded extensibility | tests/background-task-control.test.ts；tool-executor-trace.test.ts；workflow-tool.test.ts |
| child Bash终态不绕过controller唤醒；普通fork不继承其他root树 | tests/runtime-tool-loop.test.ts 两项定向case |
| 模型切换/执行覆写/Host解析端口/profile prompt/memory/AGENTS/MCP/工具事件 | tests/{runtime-model-selection,subagent-effective-execution,subagent-profile-fields,subagent-prompt-assembly,subagent-runtime-refresh,subagent-tool-events,model-request-admission}.test.ts |
| 权限/hook/目录/实际ToolSearch/独立child discovery/allowlist/workflow灰度 | tests/{guarded-subagent,runtime-hooks,tool-hook-context,tool-search,tool-search-builtins,tool-search-subagent,runtime-tool-allowlist,main-tool-pool,agent-listing,agent-listing-runtime,workflow-routing-hints}.test.ts |
| 私有消息恢复/memory agent不递归派发 | tests/incoming-message-producers.test.ts；memory-agent-loop.test.ts |
| public旧schema移除 | contracts/test/fork-codex-collaboration-tools/removed-boundary.test.ts |
| bootstrap真实文件/Host目录与session存储/Workflow有效模型解析 | bootstrap/tests/subagent-runtime-config.test.ts；workflow-effective-selection.test.ts |

迁移 bootstrap test adapter 时保留 ModelStreamEvent.tool_call。既有 streamResult 桩只发text/finish，
在现有 nonstream wrapper 下会静默删掉工具调用；真实bootstrap回归先失败，再补事件透传。
独立 root 已修 core test stream 桩与生产 Model.requestCapabilities，本批不重复修改或提交其文件。
subagents.enabled旧外部门删除；script workflow使用既有 binding factory明确返回undefined隔离。
相关 typed fixtures 和 prompt trajectory contract 同步删除无效旧开关。

## 实际验证

1. CLI默认Vitest选择30文件：388/388 GREEN。不是全量CLI测试。
2. controller源内测试通过专用Vitest include执行：3文件53/53 GREEN，避免默认include过滤src。
3. runtime-tool-loop两项定向：2/2 GREEN，同文件其余158项未运行。
   prompt-trajectory record.test.ts 用实际tsx+node:test执行5/5 GREEN。
4. CLI typecheck32/32；根typecheck/lint PASS（102 warnings、0errors）；新模块scopedlint、架构0违规、
   移除守卫和diff check PASS。contracts/core实际tsc build通过，root随后复建真实协议进程。
5. 全CLI lint已实际运行但失败：3个max-lines errors（adapters/fs/index1642、bootstrap/product-projection5132、
   core/background-tasks942）与71warnings。前两文件未改，本次删减后的background-tasks仍超既有上限。
6. 独立旧产品断言：tool-contracts/off-peak-tool37通过4失败（已删除WebFetch prompt/旧描述、OffPeak注册）；
   WebSearch9通过4失败（现有渠道合同互斥、测试main stream主动抛错）。不恢复这些无关产品行为。

原始执行记录位于本机 `/tmp/zcode-task3b-{final-green,controller-final,bash-fork-green,types-final,
root-typecheck,root-lint,new-module-lint,cli-lint,architecture-final,removals,retained-boundary,final-acceptance}.log`。
实际OpenAI HTTP空tool_result/assistant来源证据使用root独立已审提交a33b8953；Anthropic原生wire未验证。
root在稳定生产源码build9依赖任务后实际协议4/4 GREEN（13.73s，日志zcode-collaboration-final-protocol-wire.log）；
限定三个恢复场景与send_message，不等于生产包装器或六工具GUI完整验收。
客户端冷身份query、TUI/mobile呈现与最终生产交互留给Task4，不用模型ACK推断child完成。

不推送；仅显式提交本批文件，保留工作区.gitignore、codex/和用户其他工作。
