# 上游通信边界

仅保留不依赖账号、无需登录且提供实际功能的上游请求。唯一判定所有者是 shared 的 upstream-network policy；Node 各进程与 Electron Session 只执行同一判定，不维护第二份白名单。

允许匿名 GET/HEAD：官方插件市场/插件资源（cdn-zcode.z.ai、cdn.codegeex.cn 的 /zcode/official-plugin/）、远程运行时下载（两 CDN 的 /zcode/electron/releases/）、公开文档（zcode.z.ai/docs）。路径必须规范化，禁止用户名、非标准端口。其余 z.ai、bigmodel.cn、codegeex.cn、智谱域及 ARMS 采集地址默认拒绝。用户自管第三方模型、WebDAV、SSH、GitHub 更新不属于上游，保持可用。

禁止：营销查询/动作/素材、OAuth/账号恢复、套餐/权益/云额度/OffPeak、反馈上传、云分享、远端灰度配置、上游手机远控、产品遥测与 ARMS/OTLP。营销组件不挂载，遥测不初始化；网络边界负责拦截残留调用及后续上游新增接口。SSH 连接自管 Source Server 和下载匿名 runtime 不受影响。

顺序：进程启动 → 安装 Node 网络门禁（fetch、HTTP/S、WebSocket 握手）→ 服务启动；Electron session 创建 → 安装请求门禁 → 渲染页面。重定向每跳重新检查；拒绝发生在传输前，不吞错、不伪造成功。策略对账号是否已登录不变。

验收：营销/账号/遥测零传输；新未知上游路径拒绝；伪域名、编码路径、非默认端口不越权；匿名市场/资源保留；重定向到禁用 API 在第二跳前拒绝；主/Host/CLI/session 启动接线由移除守卫固化。

边界：应用内网络策略，不是系统防火墙；用户在终端、外部浏览器或第三方 MCP 子进程主动执行的任意程序由用户管理。
