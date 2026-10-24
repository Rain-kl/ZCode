# 上游通信收口

用户规则：仅保留不依赖账号、免登录、有实际用途的上游功能；发布 v3.17.162。

根因是 v3.15.1 同步引入的匿名营销服务未被本地模式入口/请求保护覆盖，原 CI 只证明测试通过。新增按域及路径默认拒绝的单一策略，保护实际网络出口，而非只隐藏广告。额外确认 relay V2 依赖账号 JWT，因此不得保留；自管 SSH 不等同上游 relay。

无破坏式改写历史；新版本基于 main a0ab1dd6。架构对 observeBeforeRequest 的例外只覆盖已存在的单个分发器，目的是在共享 listener 中强制策略，避免第二个 Electron listener 覆盖抓包/诊断或反向移除门禁。营销 Root 移除装配，无第二份 controller 状态。

验证日志 /tmp/zcode-network-*；最终以完整 CI 结果为准，不用本地静态证据冒充实机网络抓包。

本地验证：91 项定向回归通过（8 文件）；typecheck 成功；lint 102 warnings / 0 errors（既有 warning）；架构检查 0 violations；移除守卫扫描 10726 文件通过。Preload/Renderer 独立 ARMS 初始化与重试也已关闭；专用沙箱 listener 不能覆盖通用门禁而放过 HTTP/WS。
