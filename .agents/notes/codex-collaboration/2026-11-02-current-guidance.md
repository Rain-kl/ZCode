# 删除旧工具后同步模型指导

独立规范审查在保留 Workflow handler 和私有 memory prompt 里找到旧 Agent 名称。
先明确 current-guidance spec，再更新冻结 memory fixture、新增 handler 拒绝指导回归，实际两项 RED：
memory 原 prompt 与新合同不同；Workflow 仍建议不存在的 foreground Agent 替代路径。

只修改指导：被拒绝 Workflow 提示在当前会话处理或向用户解释执行限制，memory 用协作工具类别说明
拒绝面。没有恢复 OffPeak/Workflow 注册或旧协作参数。两处上游接线均标记 codex-collaboration。

验证边界：既有 OffPeak 移除将 executor 的 offPeakTurn 固定关闭，故 Workflow 回归直接调用保留
handler 的类型化有限 context；不能据此声称默认注册或完整 idle-time 执行链已测。memory 仍用
冻结 provider-visible fixture，不改变允许工具或文件边界。

实际 GREEN：workflow-tool、memory-extraction、memory-agent-loop 三文件 **69/69**；core noEmit 与
两修改源码 scoped lint 通过。扩大到 runtime-memory-extraction 时总计 **89/90**，唯一失败是其
既有工具面断言显式过滤 WebSearch，与当前 SearchChannel 暴露合同不符。保留该失败，不改无关搜索行为。
