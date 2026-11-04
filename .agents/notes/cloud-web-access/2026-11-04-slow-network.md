# 慢链路流控与当前项目草稿

## 状态所有者与接线

可靠帧 adapter 持有未确认字节、水位和重放。Connector 将水位边沿经 loopback WebSocket 的文本控制帧交给该连接的 Core scope；RPC 继续使用二进制帧。控制格式沿用现有 MessagePort 流控语义，接收端绑定 connectionId，scope 串行提交 saturated、drained、closed。CLI 继续拥有输出合并与会话执行。

Root 复用当前项目草稿前调用原项目准备服务，复验目录及稳定身份。相同身份由既有草稿动作提交，Web 入口更新查看状态，手机 Shell 在完成后进入聊天页。不同身份继续走原宿主 attachment 导航。原导航序号拒绝迟到的准备结果。

项目树与设备目录并行读取；远端入口的归属、名称、roots 和删除态相同时跳过缓存更新。内容变化仍使用原 lastSyncedAt 比较与读后成员校验。

## 回归证据

- RED：Core scope 未收到 saturated；GREEN：真实 WebSocket 验证订阅前拥塞、排空、普通查询、关闭、新连接隔离及非法控制消息关闭。
- RED：同项目草稿新建第二条 bridge；GREEN：当前项目草稿的额外 bridge 为零。
- RED：当前 Host 树等待目录 RPC，等价缓存仍发送更新；GREEN：并行读取，等价缓存零更新，变更携带原 CAS 版本。
- Connector/真实 Core 定向 20 场景通过；CLI 发布器 45 场景通过；fork node:test 10 组通过。
- Root、草稿错误、项目目录、远端服务合同 4 文件 8 场景通过；Desktop 既有远控 transport 11 场景通过。

## 弱网浏览器对照

真实 Core、CLI、SQLite 与 Chrome 使用隔离 HOME，模型和 Relay 账号为本地夹具。透明代理只在 Server–Relay 两个方向加入 150 ms 延迟和 64 KiB/s 限速。正文回复按 x-zcode-query-source 计数并在消息行内断言；标题生成独立计数。

| 项目 | 原提交 be759bd0 | 本次实现 |
| --- | --- | --- |
| 当前项目草稿进入聊天 | 2479 ms | 491 ms |
| 全流程 bridge 次数 | 3 | 2 |
| 两次用户发送的正文请求 | 2 | 2 |
| 首次回复 | 11151 ms | 11608 ms |
| 刷新恢复历史 | 8386 ms | 8439 ms |
| 重连后回复 | 1868 ms | 1894 ms |

原提交对照由 Vite 在内存读取指定 Git 提交的 UI 文件，保持同一宿主、模型和限速夹具。导航节省一次 attachment 与页面初始化；冷启动和首次回复仍有秒级等待。

证据目录（系统临时目录下）：

- 对照：`zcode-cwa29-kkwMSv/artifacts`。
- 当前弱网：`zcode-cwa29-WlAgtu/artifacts`。
- 1280px 同目录多项目、草稿刷新：`zcode-cwa29-fItDAC/artifacts`。
- 390px 空主机创建项目：`zcode-cwa29-7C9M8g/artifacts`。

上述回放均完成两次正文回复、同任务刷新、Relay terminal 断线恢复、项目归属与 cwd 校验、文件浏览。完整时延与双向字节/排队峰值在各 result.json。

重放命令：`pnpm exec tsx packages/web/test/e2e/manual-review/pending/self-hosted-server.mjs --slow --reuse-draft`。设置 `ZCODE_SLOW_BASELINE_REF=be759bd0` 执行原提交对照；`--same-root` 与 `--empty` 执行另外两种入口。

## 工程检查

根 typecheck、architecture:check --changed、fork:check-removals 通过；根 lint 0 errors、85 条既有 warnings。Web 生产构建通过。CWA33–34 的真实浏览器候选状态为 covered / pending-review。

## 目录按需读取

继续按真实 Core RPC 记录方法、执行耗时和 JSON 响应大小。原场景 list 返回 142872 字节，子智能体 list 返回 50168 字节；草稿推荐只使用 draft-suggestion，关闭的 slash 面板提前请求子智能体目录。

Client Scenes 服务在原 list 入口接受可选场景选择，在 RPC 返回前投影；草稿 Hook 选择 draft-suggestion。SWR 资源和可见性恢复仍由原 Hook 持有，按 service/cache/scene 隔离。网页 Composer 沿既有编辑器 props 传入按需策略，Slash 插件只在打开面板时进入原 useSubagents 加载路径，缓存继续归原 context store。

服务回归先 RED（筛选仍返回完整目录），后 GREEN；覆盖完整读取、指定场景、空结果、业务错误和 HTTP 错误上下文。浏览器先 RED（打开面板前目录已加载），后 GREEN：推荐响应仅含 draft-suggestion，JSON 2807 字节；子智能体零预加载，打开后 general-purpose 可见，再次打开没有额外 list。

RPC 定位证据：`zcode-cwa29-0pLb8L/artifacts`；按需场景与面板验收：`zcode-cwa29-uJoQH1/artifacts`。运行命令增加 `--catalogs`。新验收在消息行内区分两次正文，标题请求按 x-zcode-query-source 独立统计；虚拟列表使用 `/general` 搜索目标候选。

两批实现后的顺序回放：原提交 `zcode-cwa29-FsfDIa/artifacts`，当前实现 `zcode-cwa29-7Zd232/artifacts`。当前项目草稿 2867→874 ms，首次回复 10964→5761 ms，刷新恢复 7976→6911 ms，重连回复 2470→1922 ms；首屏 7424→7837 ms。原 UI 由内存基线插件读取全部相关改动文件，复用相同宿主和受控模型。当前实现额外验证目录首次打开与再次打开；两次正文各执行一次，模型总请求含标题为三次。类型、Lint、架构、移除守卫、node:test 10 组与 Web 构建再次通过，Lint 保持 85 条既有警告。
