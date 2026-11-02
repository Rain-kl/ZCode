# 已废弃：RespondToCoordinator

## 二开替换说明：codex-collaboration

2026-11-02 起不再保留 `RespondToCoordinator` 的注册、执行或兼容入口。
旧的 main-only `SendMessage` 与 child-only 回信合同由统一六工具合同取代。
本文件保留为已有设计引用的废弃说明，不再定义可执行工具。

父子协作消息使用 `send_message`；目标空闲时消息只排入持久邮箱。
需要让已有子智能体继续任务时使用 `followup_task`，保留同一身份、会话和历史。
投递成功不表示模型已经读取或完成任务，任务完成依据真实生命周期。

当前[工具与角色合同](features/codex-collaboration/tools-contract.md)、
[运行链合同](features/codex-collaboration/runtime-integration.md)和
[实施记录](features/codex-collaboration/implementation.md)分别说明接口、时序和已验证范围。
协作消息由 provider 边界投影为 assistant 信封，不能恢复旧的 synthetic user 授权语义。
