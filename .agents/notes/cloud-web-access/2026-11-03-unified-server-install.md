# 统一 Server 安装路径与资源

## 问题与根因

用户要求 curl 一键安装与桌面 SSH 安装共用路径和资源。旧脚本独立存放 `.local/share/zcode-server/releases`，绕过既有 ReleaseInstaller/ReleaseManager，而两种启动又共用 `.zcode/server` 实例；下载的 CLI 与 current 指向的运行版本可能不一致。不能仅修改默认目录并继续在 Python 中维护第二套版本指针/安装事务。

用户终端中无参数启动出现缺少 Built-in Provider Config。源码证据：Agent CLI 相对入口查找 `provider/zcode-builtin.json`；Server staging 只复制了 `zcode.cjs`，没复制 CLI dist/provider；Core 的编译期内嵌配置不会传给用户直接运行的 Agent。之前 --version 验证不需要 provider，因此未覆盖缺件。

## 实施边界

- 先更新 `docs/specs/server-installer.md`，再补安装/资源测试，确认红态后实现。
- Python 脚本只下载、校验、临时解压，执行真实包内 `update --from-archive --server-root`；既有安装端是 releases/current/pending/完整性/生命周期锁的唯一写入者。没有 force 或 allow-downgrade。运行任务/降级拒绝保留原始 stderr，空闲在线更新沿用原协调重启，不强行停任务。
- 统一 `.zcode/server`，尊重 ZCODE_DATA_BASE_DIR。`.local/bin/zcode` 原子写为薄包装器，始终执行该 root/bin/zcode。接管旧脚本带标记的入口，保留旧包、项目、会话、凭据和用户备份；其他来源命令（含二进制）拒绝覆盖。废止独立安装目录变量，明确提示统一数据基目录。
- staging 从 Agent dist 同次构建资源复制 provider 配置，进入 agent-runtime paths、内容哈希与组件归档；缺失即失败。发布校验再独立检查包内配置，防止 build-only canary 仍发布残包。没有改变 canary 跳过测试、stable 必须通过测试的发布政策。
- 实包验收捕获第二个缺陷：包装器追加全局 root 后，`zcode server` 将 `--server-root` 当作子命令。补回归确认失败，再调整 CLI 为先解析全局 root、后归一化子命令；两种 root 参数顺序都通过。没有添加另一套 special-case 分发。
- 上游产品改动限定于已有 `FORK(cloud-web-access)` CLI 接线与 staging provider 区块，其他是独立安装/工程校验/文档。FEATURES 增强项、README、部署和 CLI 说明同步更新。

## 验证与限制

- 资源回归红态：staging 缺失配置测试、布局和组件归档共 3 条失败；修复后通过。发布校验新增缺件断言也先红后绿。
- 安装回归覆盖四平台映射、同一更新命令、busy 失败不切入口、旧脚本迁移保留哨兵、SSH 更新 current 后 PATH 跟随、基目录、完整性/manifest/网络失败、不覆盖外部命令与参数转发。此套件模拟安装端，只证明脚本委派合同，不冒充真实安装事务覆盖。
- `pnpm test:engineering` 定向 packaging、stageRemoteAssetsCli、tsupConfig：3 文件、50/50 通过。
- Server CLI `cloudWebAccessCli.test.ts`：12/12 通过，含新增 root 分发红绿证据。
- 发布与安装 Node 联合回归 47/47 通过；追加旧环境变量拒绝回归单独通过，总计 48 条。根 typecheck 通过，Lint 85 warnings / 0 errors；架构变更检查 0 违规、fork removals 通过、sh -n 与 diff check 通过。
- 真实本机构建：Server tsup build 成功；darwin-arm64 stage 使用现有同次 Agent dist/provider。首次因本地缺失 zcode-site-plugin/dist/server.mjs 被既有检查正确阻断，补构建该插件后完整打包成功，没有绕过资源检查。
- 真实安装验收：临时 curl 边界提供本次真实归档及对应 descriptor，安装命令使用发行包自带 Node/CLI，不模拟 ReleaseInstaller。隔离 ZCODE_DATA_BASE_DIR 中 current.releaseDir 精确匹配统一 releases/version-target-sha12；完整性文件、provider 原文一致、稳定入口、--version、server 帮助和再次同包安装均通过。
- 实包 Agent 启动验收：通过安装后的 PATH 命令启动 app-server，发送无副作用的未知方法请求，得到实际协议 `-32601 Method not found`；证明越过 provider 资源加载并进入真实协议分发。没有发送模型请求、启动 Relay、连接用户主机或操作生产服务。
- 临时实包证据：`/tmp/zcode-unified-install-smoke.log`；本机验证安装位于 `/private/tmp/zcode-unified-live-PZpBEt`。临时 probe 脚本 `/tmp/zcode-unified-install-smoke.mjs`，归档为 `packages/zcode-server-cli/dist-release/zcode-server-darwin-arm64.tar.gz`。这些路径是本次本机证据，不是仓库入口或发布产物。
- 未验证 Linux 实机、其他 CPU 的真实运行、运行中 daemon 更新/回滚和公网 curl 新版本。没有推送或更新已公开的不可变版本包；需要本提交生成新的 canary Server 发行包后，用户才可通过公网脚本安装这次修复。
