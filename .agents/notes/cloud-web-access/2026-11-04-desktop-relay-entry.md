# Desktop 自建 Relay 入口验收

日期：2026-11-04

## 决策

- Desktop Main 继续拥有远控连接、设备身份和 attachment 生命周期，不新增第二套 connector、Host 或 Agent。
- Renderer 只保留未提交的表单状态；密码只用于登录，不进入设置；可撤销会话交给现有安全凭据存储。
- 自建 Relay 配置存在时，远控的网页、HTTP 和 WebSocket 地址统一使用同一个 origin；会话失效后回到原弹层重新登录。
- 本地模式由 Desktop 明确启用入口，不再依赖官方云账号界面开关。

## 验收证据

- 配置与现有远控定向回归通过，共 17 个用例。
- 根 typecheck、architecture check 和 fork removal guard 通过；根 lint 为 85 个既有 warning、0 error。
- Desktop 生产构建通过。
- 使用隔离 HOME、用户数据和会话目录启动 Desktop，侧栏显示“移动端远程控制”；打开后展示 Relay 地址、账号、密码及“连接并开启远控”。
- 未使用真实账号提交登录，因此公网扫码控制仍需部署账号做最终验收。
