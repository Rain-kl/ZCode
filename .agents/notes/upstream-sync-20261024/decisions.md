# 2026-10-24 上游同步

- fork 先快进到 origin/main a8f8e619，保留 7 条最新 CI/构建修复。
- 合并 upstream/main 3c5b2276（aac47556 后的两条源码同步提交），在独立分支处理 35 个冲突路径。
- 产品决策沿用 FEATURES.md：GitHub feed/无强更、本地模式、WebFetch 直返、reload、工具档位、动态提示词及服务通道清单；采用上游远程目录、恢复状态、设置 archives 与布局结构。
- 非产品冲突：保留 fork 版本 3.16.151；合并上游 db schema/架构测试命令并保留 fork 守卫和契约测试；vendor 快照维持字节保真；Vitest 合并上游默认排除与 fork node:test 隔离。
- 新工具 ToolSearch/DeferredToolCall 放标准档，防止突破极简/基础白名单；现有分类完整性测试先红，新增两档缺席断言。
- 测试 ID 的导入跟随上游迁到 @zcode/shared/test-ids。
- 更新器保留上游下载 Promise 提交屏障和安装锁，强更缓存测试改为普通下载/显式安装路径；不恢复 manifest provider。
- canary CI 开启完整 verify 与 fork 契约测试；仅检查、双平台构建及发布全部 success 才将同一提交快进到 main。

## 本地验证

- typecheck、lint（100 warnings/0 errors）、architecture:check、fork:check-removals、db:schema:check、test:architecture（36 项）通过。
- CLI bootstrap 全依赖链构建通过。
- fork 契约 7 组通过；autoUpdaterReadyState、remoteServiceAccess、settingsPageConfig、providerRegistry 定向回归通过。
- 全量 test:unit 已执行，本环境只读 home 导致迁移备份、日志和临时工作区用例失败；保留失败并由 canary 标准 runner 的完整门禁验证。
- 发布 tag 不移动、不创建新版本；本任务是上游同步。

## CI 首轮反馈与修复

- run 40058606218 在安装依赖时因 hoisted linker 重命名 tsup 的 esbuild 临时目录 ENOENT 失败。安装步骤仅对明确的临时错误做最多三次完整重试，仍保留最终失败退出与注解。
- rootOAuthReauthentication 新增用例显式打开云账号测试夹具，并增加本地模式不订阅失效通知的用例；5 项通过，产品默认禁用云账号不变。

- 新 Host 启动 VM 夹具注入 fork 服务边界；providerBuiltinRefreshFailure 改用原始 Registry 验证底层刷新（选择视图仍断言/保持隐藏账号）。
- Desktop/Web 退避测试在 fetch 发起边界注入网络/503 错误以测精确时钟，成功握手恢复真实时钟并等待状态；不调整产品退避策略与截止时间。定向 33 项通过。
- 本地全量首轮：2043 文件，2010 passed/31 failed/2 skipped；19344 用例通过、142 失败，其中包括只读 home、沙箱进程回收及本次已定向修复的测试适配。最终成功以 canary 完整 CI 为准。
- 相同 pnpm hoisted linker 临时错误重试策略扩展到两个平台构建安装步骤；三次后仍非零退出。
