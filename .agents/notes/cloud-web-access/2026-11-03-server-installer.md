# Server 一键安装

## 设计与边界

用户要求 curl 一键安装，无参正式版、dev 参数开发版，并更新 README。先记录 `docs/specs/server-installer.md`，再写隔离回归并确认安装脚本缺失时失败，之后实现。分发层独立在 `scripts/install-server.sh`，不修改 Server 生命周期、Relay、连接凭据或业务数据所有者。复用已有版本固定的 Source Server 发行协议，不建立另一条 Server 打包链路。

正式版读取 GitHub latest；开发版读取实际 canary 指针的 dev.yml；完整版本固定后只访问对应 server-v 标签。先校验 descriptor、大小、SHA256、包内 manifest 与路径，再安装和原子切换用户命令。包装器以绝对路径调用真实 bin/zcode，避免 symlink 导致现有 launcher 的相对目录计算失效。下载/校验失败保留旧入口，拒绝覆盖其他来源的命令。用户升级需自行 down/up；保留旧运行包，不删除配置与会话。

依赖 curl 与 Python 3.8+，运行时使用包内 Node。macOS 测试 tar 夹具设置 COPYFILE_DISABLE=1，以匹配 Ubuntu 发布产物，避免 AppleDouble 额外根条目；不放宽安装器对异常归档根的检查。支持 Python 新版 data_filter，旧版逐条检查真实路径防止链接逃逸。

发布工作流 stable verify 增加安装器回归，canary 仍按已有政策跳过测试，仅构建成功后发布。没有推送；README 公共脚本 URL 需要本地提交进入远程 canary 后才能使用。当前最新稳定 v3.17.162 尚无 Server companion，默认安装会明确失败，不能隐式切到 dev。

## 验证记录

- 首轮安装器回归因脚本缺失变红；CI 合同增加新测试命令后、修改工作流前也先变红。
- 安装器夹具覆盖四个平台映射、实际 tar 解压和参数转发、dev 固定版本、重复安装、升级保留旧版本、校验/网络/manifest/越界链接失败保留旧入口、不覆盖已有命令、错误参数/平台、stable 缺包及管道执行。
- 真实 GitHub 下载：临时目录中安装 darwin-arm64 的 `3.17.162-dev.8e1e2e09`，实际运行安装后的 `zcode --version` 得到相同版本；未 connect/up，不操作生产服务或账号。
- 根 `pnpm typecheck` 通过；`pnpm lint` 通过，85 warnings / 0 errors（既有警告）；架构变更检查 0 违规；`sh -n` 通过。
- `node --test scripts/test/release-workflow.test.mjs scripts/test/release-sharding.test.mjs scripts/test/source-server-release.test.mjs scripts/test/server-installer.test.mjs`：42/42 通过，含管道执行的最后复核；没有 Linux 真实主机安装、其他架构执行、正式版 Server 实包验证，也没有推送或公共脚本 URL 验收。
