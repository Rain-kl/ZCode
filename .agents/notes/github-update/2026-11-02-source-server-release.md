# Source Server 配套发布与版本保留

现场证据：安装版本 3.17.162-dev.084c4811 向上游两个 CDN 请求 descriptor 均为 404/NoSuchKey，
桌面流水线没有发布 Server，错误却只剩笼统下载失败。不是 SSH 凭据故障。

决策：不另造 Server/安装器，复用现有四平台 Source Server staging 和 SHA/size 校验。
桌面仍通过 canary-build 更新，Server 独立按 server-v<完整版本> 保留；不能把远程运行时放进会被
覆盖清理的桌面指针，也不能截掉 dev 后缀借用上游版本。原始 cause 保留 URL，展示层不绕过日志脱敏。

发布 owner 是 resolve；Server 构建/验证成功后，publish 先完成 draft Server 发布，再更新桌面。
已公开 Server 不改写，重跑下载并验证旧包，避免 tar 时间戳导致“同版本不同字节”；鉴权错误不按 404 处理。
cleanup 需一直保留 server-v\*，否则旧客户端会再次无法新增设备。

验证：60 项相关 Vitest、13 项发布脚本测试、14 项更新契约通过；typecheck、lint（0 error）、Server
bundle 构建/真实版本入口、workflow actionlint 与 fork removals 通过。架构门禁被并行 CLI runtime
改动阻塞，不处理或提交其文件。真实托管构建、发布和远端安装尚未验证。

合同与事件图见 docs/specs/desktop-release.md；接线与详细未验证项见
docs/features/github-update/implementation.md 的第 6 节。
