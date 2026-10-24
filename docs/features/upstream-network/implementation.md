# 实现与审查记录

## 审查结论

| 模块 | 账号依赖/用途 | 处理 |
| --- | --- | --- |
| marketing-touch / cloud-content 营销素材 | 匿名亦有广告和动作追踪，无产品用途 | Root 不挂载；API 与 CDN 非白名单路径拒绝 |
| OAuth、账号 provider、Coding Plan、权益/额度、OffPeak | 依赖上游账号/套餐 | 保留既有本地模式屏蔽，网络出口禁止上游业务 API |
| TelemetryCore / ARMS RUM / CLI OTLP / TTFT / action trace | 产品采集，无匿名业务功能 | 关闭初始化或传输；环境遥测关闭；HTTP 出口保护 |
| client-config / desktopContextPromptRollout / help config | 远端灰度与推荐下发 | 未在白名单，拒绝请求，原有本地默认值继续生效 |
| feedback、conversation-share | 上游工单/发布服务包含账号链路 | 上游 API 拒绝，不发送日志、附件和会话 |
| 手机远控 relay V2 | register/token 都要求 Authorization JWT | 隐藏功能入口；HTTP/WS 出口拒绝 |
| 官方插件市场、插件包及图标 | 匿名获取、实际功能 | 只允许两个官方 CDN 的 /zcode/official-plugin/ 匿名 GET/HEAD |
| Source Server/SSH 运行时下载 | 匿名发行资产，有实际功能 | 允许两个 CDN 的 /zcode/electron/releases/ GET/HEAD；自管 SSH 保留 |
| 场景提示词/自动化模板 client-scenes | 不带任何登录凭据实测 HTTP 200/code 0，返回 9 组场景；实际用于新会话提示词和自动化模板 | 仅允许 zcode.z.ai/api/v1/client/scenes 匿名 GET/HEAD，其余 client API 拒绝 |
| 上游公开文档 | 无账号，用户帮助 | 允许 zcode.z.ai/docs 及其子路径 GET/HEAD |
| GitHub 更新、自定义第三方提供商、WebDAV | 非上游自管服务 | 不受上游域拒绝规则影响 |

## 实现

shared/fork/upstream-network/contract.ts 是单一判定所有者。Node Main/Host/CLI/HTTP Server/stdio Server 及独立 Source Server Core 子进程入口先安装 fetch 与 HTTP/S 请求门禁（包括 WS upgrade），Host 显式 undici dispatcher 另在 nodeApiNetwork 复用相同断言与重定向策略。服务容器在 NodeApiClient 注入授权回调，端点重写前后都审核，配置域名别名不能绕过限制。保存远程文件的独立 undici 出口在每次 DNS/传输前审核。Electron 的观测分发器和沙箱专用监听器均在传输前执行相同策略；session-created 注册覆盖应用 session。Web fetch/XHR/WS 同样采用策略。浏览器对不可读取目标的 opaque 重定向拒绝继续；Node fetch 每跳验证并移除跨域凭据，保留第三方请求标准 301/302/303/307/308 方法语义。

营销服务实现保留用于缩小上游冲突，但根组件不再装配；后端任何残留调用也不能穿透出口。遥测核心通过宿主 enabled:false 禁用；ARMS 初始化不执行；Main 不注入 OTLP exporter 环境，CLI 入口设定遥测禁用标记。

## 验证

先写规格和契约测试，缺实现时失败；加入策略后 23 项判定测试通过。独立 Node 子进程验证 fetch、HTTPS 和 WS upgrade 零发送，市场请求保留、重定向第二跳拒绝且 token 不进入错误信息。完整测试与发版结果在任务完成时报告。

本策略约束本应用管理的请求，不是操作系统网络隔离；外部浏览器、终端命令、第三方 MCP 自有进程的任意网络行为由用户管理。未进行真实已登录上游账户或抓包实机验证；受控子进程与 mock 传输验证发送前拒绝。
