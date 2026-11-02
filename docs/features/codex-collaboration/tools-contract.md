# 六工具与角色装配合同

Task3a 提供可注册合同，Task3b 才切换默认 runtime。控制器仍是身份树、邮箱、generation、运行名额的唯一所有者。

## 工具边界

`@zcode/contracts` 公开六个 strict Zod 输入/输出 schema 与 caller-scoped `CollaborationToolPort`。
调用关联由工具执行上下文传入 `toolCallId`，不能从模型输入取得 callerId。
spawn 仅返回 `{task_name}`，真实 agentId、childSessionId、parentId、path、generation 和 toolCallId
由实际 adapter 持久化到内部生命周期/ToolPart metadata；不得从模型结果反推冷恢复身份。
send/followup 成功模型文本为空；interrupt 返回 `{previous_status}`；list 返回 `{agents}`；
wait 返回 `{message,timed_out}`，消息正文通过唯一邮箱路径消费，不在 wait 重复输出。

六工具为常驻直接调用工具，ToolSearch 目录保留发现能力，不要求 DeferredToolCall 包装。
工具沿现有 registry → 权限 → hook → executor → schema/结果预算 → ToolSearch 链路执行。
2026-11-02 用户明确要求全面切换，不做旧工具兼容。Agent/Task/SendMessage/
RespondToCoordinator 的注册、直接执行、ToolSearch、别名和旧提示词均移除，
旧工具调用明确报不存在；不能以隐藏工具或注入旧 SubagentPort 保留旧工具面。
TaskOutput/TaskStop 只保留 Bash/workflow 等非子代理用途。旧历史不新增专用适配，
不删除用户会话或日志。Task3a 提供六工具，Task3b 完成唯一新运行链并清理旧路径；
阶段性提交不是允许产品长期双轨运行的开关。

## 状态映射

工具端口返回 Codex wire status：pending_init/running/interrupted/shutdown/not_found、
`{completed:string|null}`、`{errored:string}`。控制器 child idle 表示已装配而未开始新轮，映射
`{completed:null}`；只有实际初始化尚未完成才是 pending_init。root 不从控制器的 idle 推断，
由 root runtime 现有执行/终态投影提供 wire status；工具层不得保存第二份可写状态。
list 包含已加载 root，按规范路径排序。模型结果不携带私有身份。

## 配置与提示词

唯一归一化来源 `subagents`：delegationMode 默认 explicit，可显式选 proactive；
maxTotalAgents=4（包含根）、maxDepth=1、maxLoadedChildren=3。不新增环境变量。
Task3b 从持久化根配置恢复这些设置，并先恢复已保存 root agentId/traceId 再构造控制器。
fork_turns 默认 all，all 禁止 model/reasoning_effort 覆盖；none 允许经实际模型目录验证的覆盖。
agent_type 必须命中宿主传入的可用 profile 集，未知项携带名称和可用集合报错。

角色文字移植自 Codex 3026a8e54e0f，保留 Apache-2.0 许可证与 NOTICE。
角色为宿主 system section，协作消息在 provider 唯一投影边界成为 assistant envelope；
持久化保存 raw payload 与私有来源，不扩大公共角色协议。子代理处于默认深度上限时不宣称自己
能够 spawn，但仍可按已注册权限消息/续跑/等待。主代理同样只描述实际可用工具。
不复制 Codex functions.exec/recipient、analysis/final channel 等 ZCode 未提供的宿主语法。

EnterPlanMode 的探索提示同样依据本次 registry 注册条件：仅当 includeCollaboration 启用、
allowedTools 允许 spawn_agent 且 disallowedTools 未禁止时才推荐该工具；否则指导直接使用
当前搜索/读取工具探索。不得因 embedded search 开关推断协作能力。`/workflow` 内置命令
明确要求 CreateWorkflow，不得以 spawn_agent 替代，也不再引用已删除的旧代理工具。
ToolEntry factory 仅负责 schema 校验；可用 profile 与模型目录的语义校验由 Task3b
宿主 adapter 负责，并须覆盖未知 profile/模型携带可用集合上下文的真实运行用例。

## 验收

- strict schema 拒绝未知字段、非法路径名、all+override；wait 默认 30 秒、10 秒下限、3600 秒上限。
- executor 实际通过权限与 hook 执行六工具；初始工具与 ToolSearch 均不暴露旧名称，直接调用旧名称也失败。
- 注入执行端口不能恢复旧工具；TaskOutput/TaskStop 不能查询或停止子代理，但后台命令原功能通过回归。
- 当前提示词、技能和示例只指导六工具；fork 移除守卫在重新注册旧入口时必须失败。
- 输出只包含约定字段；fork 模型规则、可用 profile 校验、根状态来源及条件角色有契约测试。
- Task3a 不声称已完成 child runtime、邮箱 ACK、冷恢复、权限等待或 UI 下钻；这些由 Task3b/4 实证。
