# 六工具桌面客户端验收

本验收在 Task3b 双审后实施，验证已定义的客户端行为，不新增调度或消息规则。
用例保持 manual-review/pending，未经人工确认不提升为正式准入。

CSC01 通过真实 Electron、Agent bundle、SQLite、回放 HTTP provider 检查：

1. 父模型调用 spawn_agent、list_agents、send_message 后结束；child 仍在受控流中运行。
   spawn 工具完成只表示 accepted，界面必须保留一个 running child。
2. 从摘要读取实际 childSessionId 并下钻，不能从 task_name 或工具 ID 构造 session。
3. 释放 child 的响应（带成功 TodoRead 结果边界）后，下一真实 provider 请求包含完整响应尾部及
   assistant MESSAGE。child 回复父代理并结束；idle 父代理不隐式另起 turn。
4. 新的用户输入由父模型调用 followup_task，原 childSessionId、原 spawn anchor 重新 running。
   新轮保持受控流；原生 Stop 只中断这个 child，父会话仍可接收输入。
5. 后续父模型调用 interrupt_agent、list_agents、wait_agent 并完成。六工具有正常展示，
   空消息成功结果不显示失败；list/wait 不能被渲染成 Stop 操作或创建额外 child。

受控 gate 为事件顺序屏障，不修改产品超时或注入假终态。每轮使用唯一 tool call ID，保证实际执行，
避免幂等冲突使测试没有进入目标路径。replacement/followup 必须看到实际 provider 请求，不能以 ACK
作为模型开始执行的证据。finally 释放 gate 和停止所选主会话，沿用现有清理 helper。
清理采用顺序 attempt-all：gate 列表读取或某个 gate 释放失败，仍尝试其他 gate、主会话 Stop、
mock 恢复和隔离数据清理；最后聚合保留全部原始错误，不吞掉 provider 或本地清理失败。

证据分别记录完整 provider 请求、唯一 child 身份、终态与 native Stop。此用例不证明手机 GUI、
所有模型协议、全部旧 BG/SAT 测试或完整冷启动恢复。手机可重放、代际与冷身份合同由 Task4 定向测试验证。
旧 BG25/XML/Agent/Task 历史验收不适用于六工具，不恢复旧输出或兼容 handler 让其通过。

本用例通过既有 `ZCODE_E2E_UPSTREAM_CONTEXT_WINDOW=128000` 与
`ZCODE_E2E_UPSTREAM_MAX_OUTPUT_TOKENS=8192` 环境合同保留普通模型窗口。manual-review
默认的 240/80 小窗口专供自动压缩验收，会在本用例的 tool_result 边界插入无关 compact，
改写原始父子消息证据；不能据此削弱六工具或邮箱断言。
