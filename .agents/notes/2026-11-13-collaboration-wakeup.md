# 子代理完成唤醒与输入记录

旧合同明确让空闲父代理等到下一轮才消费邮箱；这次按用户要求改为完成消息驱动续轮。协作控制器仍拥有树、代际和 durable mailbox，runtime 命令队列负责调度。唤醒项引用已保存的 message ID，运行中消费后撤去引用，避免空续轮与重复注入。

wait_agent 使用现有终态工具能力完成结算后让出轮次。child 以 waiting 保留未完成任务，早到消息直接进入续轮；send 对 waiting 恢复原会话，对普通完成态保持只入箱。等待态不发送 FINAL_ANSWER。

子会话任务记录保留协作 provenance，展示策略允许读取本会话输入、继续隐藏继承的父消息。运行中输入复用 guide 展示事件，冷恢复读取持久来源与 guide 投递语义。provider 投影保持 assistant 协作信封。

原状态面板先计算已结束代理入口，却在整体渲染闸门忽略它；紧凑胶囊也缺少已结束代理分支。两处共同修复，手机开放同一目录入口。真实目录验收还发现公开 RPC 响应泄漏内部 lifecycle 字段，被客户端 strict schema 拒绝；在协议出口移除内部字段后目录能够正常读取。

验证沿用现有 runtime、controller 与 CSC01。请求计数区分 child 和自动续轮的 parent；错误状态回归检查 durable receipt 的所有权转移。结果记录在功能 implementation 文档。
