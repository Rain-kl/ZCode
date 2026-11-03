# /refresh 命名隔离

2026-11-03 用户要求将 fork 设置热重载从 /reload 改为 /refresh，上游 /reload 保留运行实例重启。仅重命名新命令路由与排队意图，不改持久化完成事件、timeline marker 或内部 runtime 维护轮名，避免无意义历史迁移。保留 fork 原有 reload.ts handler 路径（上游没有同路径文件），公开导出改为 refreshHandlers；避免仅为改名新增未受管模块。

回归先断言 /refresh 可识别、参数与附件不误消费、/reload 不走 fork 路径，以及协议/队列刷新路由。

合并核对抓到三处自动合并未报冲突的缺口：App-local reload 未进入保留名列表；inputIntentMetadata 没有 refresh 分支；排队 product projection 降级成 sendText。已在单一现有映射中补齐，用先红后绿的源路由守卫与运行时 native/projection 用例验证。队列沿用既有提升入口，未增加第二条执行路径；禁止编辑 typed refresh 防止正文与命令 kind 分裂。

FRR01 独立 pending E2E 先补 accepted 场景后实现，复用 runtime-restart fixture 并用 grep 隔离，不把旧 SLR09 标题取消窗口当刷新验证。fixture check、desktop typecheck:e2e 通过；真实 replay 在 onPrepare 被未裁决 autoUpdater 冲突阻断，Electron/UI 断言未执行，不能替代桌面验收。独立 review 未发现其余 refresh/reload 路由串线。测试产物与 HOME 隔离，原工作区未改。
