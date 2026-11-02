# 当前使用文档跟随六工具合同

Task3b 独立规范审查发现 CLI 当前 usage 文档仍指导关闭已无消费方的全局开关、移除旧工具，
并提供旧构建参数探测建议。用户已要求全面切换且不做兼容，这些指引会导致评测设置与实际工具面不符。

更新 `apps/zcode-cli/docs/usage/04-tools.md`：列出实际六工具注册过滤示例，区分 explicit 委派策略
与工具移除，给出当前容量默认值，保留实际存在的 workflow disabled 参数。无兼容调用、数据迁移或删除。

按源码核对 contracts 六工具/config 默认值、CLI arguments 与 workflow-mode 参数；这是使用说明更新，
没有生产行为修改，旧公开配置源码清理由运行时实施者的独立修复承担。
