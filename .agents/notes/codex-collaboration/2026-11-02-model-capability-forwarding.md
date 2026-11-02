# 模型能力不能被流式适配层丢弃

Task3b 的 ToolSearch 回归定位到既有 `withNonStreamingViaStream`：手列 `Model` 字段遗漏可选
`requestCapabilities`，导致 runtime 能力准入误判。调用方式装饰器不能成为另一个模型能力所有者。

先更新 nonstream-via-stream 验收合同，再添加端口契约测试。实际 RED 为原始 true/true 声明被变成
undefined；实现只增加原声明透传。GREEN 8/8，同时锁住绑定后新声明和缺省语义。

这是现有能力修复，不恢复旧子代理工具，不触及模型治理、持久化或工具曝光策略。
