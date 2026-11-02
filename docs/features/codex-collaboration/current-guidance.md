# 当前工具指导的边界

旧协作工具已删除后，所有仍可返回给模型的执行提示必须只推荐当前可执行的能力。
这包括保留 handler 的拒绝错误和私有 memory 提取提示；工具不在默认注册表不能成为保留错误指导的理由。

Workflow 遇到执行策略拒绝时，提示模型在当前会话处理工作或向用户说明限制，不能推荐已移除的
foreground Agent 模式，也不能暗示六工具存在 foreground 参数。拒绝类型、上下文、可恢复性不变。
不恢复已移除的 OffPeak 注册或旧协作行为。

memory 提取的工具允许面不变：仅其已有文件与只读命令能力。拒绝说明使用“协作工具”类别，
不指向旧 Agent 工具。保留冻结的 provider-visible prompt 契约。

先更新冻结 prompt fixture，并增加 Workflow handler 拒绝结果的回归，确认旧指导使测试失败；
再修改提示，重跑 workflow 与 memory 提取/隔离相关定向用例。此文档不声明新增执行能力。
既有 OffPeak 移除会将 executor 的 offPeakTurn 固定关闭，故拒绝回归直接验证保留 handler 的有限
执行上下文，不据此宣称默认工具注册或完整 idle-time 执行链已经验证。
