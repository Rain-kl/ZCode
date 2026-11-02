# Task3b review P2：删除无效公开配置开关

六工具已经统一接入 subagents 配置，但旧 features.subagent 仍在公开 ConfigKey、条件值类型、默认值、
文件 schema 和 ConfigStore 中。这使用户可以成功“关闭”一个实际上没有行为的开关。按用户全面替换、
不做兼容的要求，删除这些路径，而不是重新引入 enabled gate。

先更新 runtime-integration 合同，再补实际配置测试：公开键存在、文件 schema 接受旧字段两项 RED。
删除后 ConfigPort 的动态 get/set 使用公开 ConfigKey 有限集合，merge 在任何写入之前检查 feature key。
features 对象 strict 拒绝未知字段，保持其余顶层 passthrough；当前 loader 已把 parse 失败转换为
loaded:false 和具体诊断，不增加另一份错误 owner。没有修改用户文件、隐式删除数据或添加旧值迁移。

依赖契约覆盖 get/set/merge 拒绝旧 key、公开默认无旧字段、混合 patch 不发生部分写入、合法配置保留。
removal guard 对 contracts/adapters 三个实际入口禁止 FeatureSubagent、旧路径和旧字段声明，避免上游
合并后静默复活。guard 不是全局禁止 subagent 领域名，历史文档与拒绝测试仍可说明被删除的键。

GREEN：adapters 配置2文件59/59；contracts build、adapters noEmit、scoped lint、architecture0违规、
fork removal检查36815文件通过。首次GREEN仍读到旧 contracts dist，因此先重建真实公开产物再复跑，
没有把源码导入替换成绕过公共入口的测试。当前源码无 config set/get CLI 子命令，测试真实 ConfigPort。

本提交只修公开配置边界，Task3b整批与客户端迁移仍待独立spec/quality和Task4。
