# 远控宿主对齐

## 决策与所有者

沿用现有 Relay V2、`/remote/v4`、Core/Supervisor 和项目/会话服务。Server 的 fork 宿主接入层核实项目、任务与目录；Connector 管理页面、bridge 代际与取消。项目组织态归 Host，正文和已接纳输入归 CLI，R2 保存网页版本资源。

初始工作区仅负责进入宿主界面。项目新任务携带明确项目，历史任务携带 task、owner 与 workspace。普通项目树读取也先登记 stable/canonical 映射，覆盖首屏之后创建的项目。删除旧 Connector 快照投影，唯一列表来源移至实际宿主；无跨包静态调用，已用全仓 dep-refs 和文本检索核实。

当前目录宿主与跨设备成员是不同角色：可信 attachment 提供目录 owner，项目编辑保留远端单目录规则；当前 Server 直接保存和浏览，跨主机沿用原成员、连接与归属校验。Root 继续唯一决定草稿恢复：显式导航优先，其次已保存归属，最后使用宿主的首屏默认项目；默认入口不发项目准备命令。订阅 endpoint 取服务解析后的连接身份，保留现有串线诊断。

版本归档由独立构建脚本与 Relay 文件服务负责。Cloudflare Git 构建使用与发行包相同的提交版本，资源校验成功后最后发布不可变清单。当前 ASSETS 与历史 R2 都按完整版本精确选择，损坏或缺失明确失败。

## 回归证据

- 宿主工厂缺失时的回归为 RED；真实 SQLite、项目服务与身份登记后的 10 个场景通过，另有 Core 清理 2 个场景。
- Connector 原实现丢弃项目导航、迟到结果与请求错误时为 RED；完整导航、代际、取消、错误 cause 分类与 Core 失效通知 17 个场景通过。
- CWA29 空主机创建项目后进入草稿、首次发送与回复、刷新、Relay terminal 断线后再次发送、项目文件列表通过。订阅端点告警曾令验收断言失败；修复后该断言通过。
- 空主机证据：临时目录 `zcode-cwa29-tpyYTJ/artifacts`；已有项目证据：`zcode-cwa29-rjkAlL/artifacts`。实际绝对路径及 task/project ID 保留在本机 result.json；均为真实 Core、CLI、SQLite、390×844 Chrome，模型 HTTP 和 Relay 账号使用受控夹具。
- 同目录多项目补测：先选择与首屏默认值不同的项目、写入草稿，再刷新发送；RED 证据 `zcode-cwa29-iqLqsh/artifacts` 显示新任务落在另一个项目。区分显式导航与首屏默认值后 GREEN，证据 `zcode-cwa29-k5k9NT/artifacts`。覆盖宽屏聊天、恢复、重连与文件浏览。
- CWA30：Relay 15 个场景通过，包括真实本地 workerd、旧版 R2、资源类型、HEAD、缺失与损坏；原生 Node 发布器 4 个场景通过。实际 Web 构建的受控 S3 归档生成 3898 个文件条目，验证版本资源 URL 和清单最后发布；本机证据 `.tmp/cloudflare-web-build-verification.json`。

## 检查与验证范围

根类型检查通过；根 Lint 85 条既有警告、0 错误；fork 依赖合同 58 文件、1181 测试通过；node:test 10 组通过；架构与移除守卫通过。普通 Web 生产构建与 Cloudflare 环境的版本化构建、Wrangler dry-run 通过。同目录多项目修复后重新执行根类型/Lint/架构检查与 Web/启动/草稿定向合同 4 文件、21 场景，均通过。

Desktop 的 continuous/replayable 服务暴露与 RPC 终结对照 MRS04 通过。完整浏览器对照用例 `remote-submit-lifecycle.mjs` 被旧夹具阻塞：其登录依赖官方 OAuth；临时适配外层认证后仍缺少当前 `getSessionLifecycle` 等会话合同。该对照未计为完整通过，临时夹具适配已撤回。真机权限交互、云主机进程重启与公网网络恢复仍按验收矩阵执行。

`tsx --test` 全目录尝试会错误加载 Vitest 文件；最终使用仓库按测试框架分组的正式入口验证。Knip 为全仓既有未使用项报告，只用于导出审计。

## Cloudflare 配置状态

已核实 Worker 的 Git 构建监听 canary，构建和部署命令与部署文档一致。已创建 `zcode-remote-web-assets` 桶，并为现有触发器设置桶名与账号构建变量。创建限桶读写凭据被连接的账号令牌权限阻止，Cloudflare 返回重新授权要求；构建 secrets `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY` 待设置。构建器在配置缺失时明确失败，避免发布缺少归档的版本。R2 凭据配置遵循 Cloudflare 官方认证合同：https://developers.cloudflare.com/r2/api/tokens/ 。

验证在隔离数据目录运行。当前提交留在本地 canary，发布以远端提交及 Cloudflare 构建结果为准。
