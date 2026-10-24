# 上游通信收口

用户规则：仅保留不依赖账号、免登录、有实际用途的上游功能；发布 v3.17.162。

根因是 v3.15.1 同步引入的匿名营销服务未被本地模式入口/请求保护覆盖，原 CI 只证明测试通过。新增按域及路径默认拒绝的单一策略，保护实际网络出口，而非只隐藏广告。额外确认 relay V2 依赖账号 JWT，因此不得保留；自管 SSH 不等同上游 relay。

无破坏式改写历史；新版本基于 main a0ab1dd6。架构对 observeBeforeRequest 的例外只覆盖已存在的单个分发器，目的是在共享 listener 中强制策略，避免第二个 Electron listener 覆盖抓包/诊断或反向移除门禁。营销 Root 移除装配，无第二份 controller 状态。

验证日志 /tmp/zcode-network-*；最终以完整 CI 结果为准，不用本地静态证据冒充实机网络抓包。

本地验证：91 项定向回归通过（8 文件）；typecheck 成功；lint 102 warnings / 0 errors（既有 warning）；架构检查 0 violations；移除守卫扫描 10726 文件通过。Preload/Renderer 独立 ARMS 初始化与重试也已关闭；专用沙箱 listener 不能覆盖通用门禁而放过 HTTP/WS。

出口复查补充：desktopSaveFile 独立 undici 每跳先检查再 DNS；NodeApiClient 提供宿主授权回调并在地址重写前后执行，以覆盖设置中的自定义上游域；共享 fetch 保留显式 dispatcher，避免破坏用户代理/证书。追加 76 项回归通过，typecheck、lint、architecture 与移除守卫均通过。首候选 3c5742b6 的 CI 不作为最终发版证据，等待包含本补充的后继提交。

CI 40071337270：2039 文件/19800 测试通过，4 文件/18 测试失败。真实缺陷是 Node 内置 Request 与独立 npm undici 的品牌不兼容，显式 dispatcher 适配改传 URL+标准字段，保留 body/headers/signal/duplex。另修复无 XHR 运行环境的能力判断；Electron 放行回调保持原 {} 形状、拒绝仍为 cancel:true。相关 52 项通过，包含真实本地服务、CONNECT/noProxy、POST 正文和请求头；静态检查与移除守卫通过。不关闭任何拒绝规则来迁就测试。
