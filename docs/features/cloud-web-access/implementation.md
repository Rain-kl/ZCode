# 云端浏览器访问实现计划与证据

当前仅完成设计调查，未实现登录网关、未部署 Worker/Tunnel/ZCode，未执行功能验收。

## 已验证基线

- 原工作区 `/Users/ryan/Code/Node/ZCode` 为干净 canary `6b007f78`，包含已完成的上游合并 `0e649142`。
- freshness 检查通过；`pnpm architecture:check --changed` 为 0 violations。
- 新工作区 `/Users/ryan/Code/Node/ZCode-cloud-web-access`，分支 `codex/cloud-web-access`。
- 读取 `server` 受控上下文，确认是 legacy；新增模块必须独立登记，不能借其 legacy 状态绕过检查。
- 已核实统一发行包 `zcode --web`、Server loopback/token/普通 WS scope，以及 Web 同源 bootstrap 路径。
- 根 `pnpm lint` 通过：85 warnings / 0 errors。
- 根 `pnpm typecheck` 实际失败（exit 2）：`packages/ui/src/previewPaneOfficeXlsxContent.tsx:176` 的 `onOpenLink` 不在已安装 `XlsxViewerProps` 中；`packages/desktop/src/main/pluginSandbox/host.ts:7` 的 Electron `ClipboardItem` 导出及 `:342` 参数类型不匹配。此次仅新增文档，产品源码与依赖均未修改，记录为开工基线失败；尚未调查这些错误的成因，不扩大本任务修复范围。
- 新文档 `git diff --cached --check` 通过。功能回归与浏览器验收均未执行。

## 方案确认后的执行顺序

1. 根据设计选择确定接口，更新 design、FEATURES 与架构模块合同；新增 fork 网关优先独立包，不修改 Agent 或 Electron Relay。
2. 先写 CWA01/02/07 的认证与依赖契约回归，确认红灯；再写 Worker 认证与转发适配。
3. 先登记 CWA03–06 的浏览器场景与隔离夹具；用真实 Web/Server 和受控模型回放验证 HTTP 与二进制 WS，不能用回显服务器冒充 ZCode 会话成功。
4. 为运行包、云主机服务与选定传输编写部署配置；账号密码与 Origin token 通过 Secrets/受限文件配置，不在聊天中采集。
5. 执行定向测试、浏览器验收、根 typecheck/lint/architecture/removals，记录真实结果；无法执行的验收保留未验证。
6. 提交本地功能 commit，不推送。目标主机和域名明确后进行真实部署与公网 URL 验收。

## 当前未验证

所有 CWA 功能用例尚未实现或执行；源码表明每个 WebSocket 有独立 scope，但不作为多浏览器交互通过的证据。手机普通 Web 的布局与权限交互必须实际检查。没有远程部署或公网可访问结果。
