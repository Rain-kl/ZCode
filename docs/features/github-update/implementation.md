# GitHub 更新通道 (github-update) 实现

方案与取舍见 [design.md](./design.md)。

## 1. 落地位置

| 变更 | 文件 |
| --- | --- |
| 更新 feed 解析（纯函数） | 新增 `packages/desktop/src/main/fork/github-update/feed.ts` |
| 单测 | 新增 `packages/desktop/test/forkGithubUpdateFeed.test.ts`（7 例） |
| 更新器接线、强更 gate 移除 | `packages/desktop/src/main/autoUpdater.ts` |
| 启动强更 gate 调用点移除 | `packages/desktop/src/main/index.ts` |
| second-instance 强更依赖移除 | `packages/desktop/src/main/desktopSecondInstanceDeepLink.ts` |
| 更新元数据文件名 | `packages/desktop/electron-builder.config.js` |
| 更新元数据发布 | `.github/workflows/release.yml` |
| 强更死代码清理 | `packages/shared/src/{forceUpdate.ts,index.ts,remoteAppConfig.ts,coding-plan-subscription.ts}`、`packages/services/src/coding-plan-subscription/*`、两个语言文件 |

删除的上游文件：`packages/desktop/src/main/manifestUpdateProvider.ts`、`forceUpdateGuard.ts`、`forceUpdatePrompt.ts`、`packages/shared/src/forceUpdate.ts`。

> **目录位置的偏差**：`AGENTS.md` 写的是 `packages/<pkg>/src/fork/<feature-id>/`。这里放
> `src/main/fork/github-update/`，因为它只被 main 进程消费，而 `packages/desktop/tsconfig.main.json`
> 的 `include` 是 `src/main` —— 放在 `src/fork/` 下不会被任何 tsconfig 覆盖，新代码等于不受类型检查。
> 该做法与既有 `packages/desktop/src/host/fork/webdav/` 一致。

## 2. 关键改动

### 2.1 feed 由通道决定，且必须与 channel 同步切换

`feed.ts` 只做纯函数：

```ts
resolveForkGithubUpdateBaseUrl({ channel })  // stable → releases/latest/download；preview → releases/download/canary-build
resolveForkGithubUpdateChannel("preview")    // → "dev"（决定 dev.yml / dev-mac.yml）
createForkGithubUpdateFeed({ channel })      // → { provider: "generic", url, useMultipleRangeRequest: false, channel? }
applyForkGithubUpdateFeed(updater, { channel })  // 同时写 allowPrerelease / channel / setFeedURL
```

`autoUpdater.ts` 有三处必须重新应用 feed，缺一处就会出现「新 channel + 旧基址」的 404：

1. `initAutoUpdater` 初始化：通道改为**从 settings 解析**（原来是硬编码 `"stable"`，真实通道在 check 时才解析），因为 feed 基址此时就要定下来；
2. `syncAutoUpdateCheckChannelFromSettings`：检查开始前发现通道与上次不同；
3. `refreshAutoUpdaterReleaseChannel`：用户在设置里翻转「接收 preview 版本」。

`updateFeedSource`（`--zcode-update-feed-url` / `ZCODE_UPDATE_FEED_URL`）的语义从「替换 manifest URL」变成「替换 feed 基址」，`app.isPackaged` 时忽略这一约束不变。

### 2.2 强更 gate 移除

删掉整条链路：`maybeBlockStartupForForceUpdate` 调用、`forceUpdateMainWindowCreationBlocked`、`focusForceUpdateGateWindow`、`primaryWindowCoordinator.canCreateWindow` 的拦截分支、open-url 的拦截分支、second-instance 的 `forceUpdateBlocked` 依赖，以及 `requestForceAutoUpdate` / `ForceAutoUpdateState` / `notifyForceAutoUpdate` 与全部调用点。

保留不变：更新状态机（检查/下载/跳过版本/取消/`quitAndInstall` 前的 host-agent 退出准备）、`autoDownload = false` 的手动下载策略、`autoInstallOnAppQuit` 的平台差异、`skipAvailableUpdateVersion` 与 `isSkippedUpdateVersion` 的持久化语义（原本为强更让路的两个例外分支已去掉）。

同时清掉强更专属的死代码：`ForceUpdateConfig` 类型、`getForceUpdateConfig()` 服务方法（含 `unwrapClientConfigForceUpdate` 与 envelope 字段）、`getForceUpdateMinimalVersionFromConfig`、`packages/shared/src/forceUpdate.ts`、两个语言文件里的 7 个 `forceUpdate.*` 文案键（在移除前已无 UI 引用）。

### 2.3 更新元数据

- `electron-builder.config.js`：`detectUpdateChannel: false → true`。稳定版产出 `latest.yml` / `latest-mac.yml`，`3.14.3-dev.<sha>` 产出 `dev.yml` / `dev-mac.yml`。不打开时两种版本都写 `latest*.yml`，dev 包会顶掉稳定通道的元数据。
- `release.yml`：macOS / Windows 的 artifact 上传列表补上 `*.blockmap` 与两个候选 yml 文件名（stable 与 dev 只会命中一个，`if-no-files-found: error` 只在全都没命中时触发）。
- `release.yml` publish job：dev 构建把本次资产 `--clobber` 到固定 tag `canary-build` 的指针 Release（只覆盖资产、不移动 tag，因此不需要 force push）；不再创建 dev-<sha8> 发布。

### 2.4 防回归守卫：`pnpm fork:check-removals`

本轮删掉的 4 个文件、1 条服务方法与若干符号，在同步上游时可能**静默回来**。实测四类情况
（证据见 `.agents/notes/github-update/decisions.md`）：上游没碰被删文件时删除会保留；
上游改了被删文件时报 `CONFLICT (modify/delete)`，但**把冲突按「保留上游版本」解决就等于撤销删除**；
上游用新文件重新实现、或在别的文件新增调用时，**0 冲突、完全静默**。

因此新增 `scripts/check-fork-removals.mjs`，断言的是行为不变量而非路径墓碑：

| 规则类型 | 作用 |
| --- | --- |
| `absentFiles` | 被删文件不许复活（覆盖 modify/delete 冲突误解决） |
| `absentPatterns` | 被移除的符号/端点不许在任何代码与配置中出现（覆盖新文件重新实现、异地新增调用） |
| `requiredFiles` | 我们的实现文件必须存在 |
| `requiredPatterns` | 我们那版接线必须在位（覆盖上游文件整体胜出，例如上游版 `autoUpdater.ts`） |

脚本内置 `selfTest`：为每条 `absentPatterns` 规则推导字面量探针，验证扫描器真的能命中它。
这条自检是必需的——初版手写了一个 `forceUpdate|ForceUpdate|manifest` 的文件级预筛，
它不匹配 `requestForceAutoUpdate`（含 `ForceAutoUpdate` 而非 `ForceUpdate`），
导致整整一条规则被静默跳过；现在预筛只从规则表派生，并由自检兜住同类退化。

接入点：`pnpm verify:pre-push`、发布流水线的 `verify` job、`AGENTS.md` 的同步收尾清单。

### 2.5 依赖契约测试与它抓到的问题

`packages/desktop/test/electronUpdaterFeedContract.test.ts` 断言我们依赖的 electron-updater 行为
（`useMultipleRangeRequest` 是否被沿用、channel + 平台后缀 → 元数据文件名、`updater.channel` 优先级、
资产相对路径的 URL 解析语义、缺 checksum 必须抛错）。这些都不在类型签名里，上游改掉不会产生类型错误。

**它落地当天就抓到一处真实缺陷**：`resolveForkGithubUpdateBaseUrl` 最初把基址的尾斜杠去掉了
（`.../releases/latest/download`）。electron-updater 用 `new URL(relative, base)` 解析，
不带尾斜杠时最后一个路径段会被当成文件名丢弃，于是 channel 文件请求打到
`.../releases/latest/latest.yml`（404），资产 URL 也整体错位——**换源后更新链路会完全不工作**。
修复是 `normalizeForkGithubUpdateBaseUrl`：把 `/` 补进 **pathname**（不是拼在字符串末尾，
否则 `http://host/feed?v=2` 会变成 `http://host/feed?v=2/`），并在 `forkGithubUpdateFeed.test.ts`
里把"基址必须以 / 结尾"钉成断言。

这条也是 `AGENTS.md` 新增「依赖契约测试」约束的范例来源。

## 3. 上游改动标记
10 处：7 个单点 `FORK(github-update)` + 3 对 `FORK-BEGIN/END`。

- `packages/desktop/src/main/autoUpdater.ts`：2 个单点（通道同步点、通道切换）+ 2 对（feed 应用函数、初始化）
- `packages/desktop/electron-builder.config.js`：2 个单点（`detectUpdateChannel`、`publish` 说明）
- `.github/workflows/release.yml`：3 个单点（头部通道说明、两处 artifact 列表）+ 1 对（指针 Release 段）

自查：`rg -n "FORK\(|FORK-BEGIN\(" --glob '!AGENTS.md' --glob '!FEATURES.md'`

## 4. 验证记录（2026-09-28）

已执行：

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm typecheck` | 通过（0 error） |
| Lint | `pnpm lint` | 0 error / 71 warning，全部为改动前既有告警，我改动的文件无告警 |
| 架构检查 | `pnpm architecture:check --changed` | OK，0 违规 |
| feed 单测 | `pnpm exec tsx --test packages/desktop/test/forkGithubUpdateFeed.test.ts` | 7 pass / 0 fail |
| 死代码清理核对 | `grep -rn "forceUpdate\|ForceUpdate" packages apps --include=*.ts` | 无残留引用（i18n 文案键已删） |
| 强更请求确认消失 | `grep -rn "maybeBlockStartupForForceUpdate\|ForceUpdate" packages/desktop/src --include=*.ts` | 无残留 |

**发现的相关依赖（未处理）**：`/api/v1/client/configs` 并没有从代码里消失。仍有两处访问它，
与本功能无关，属于既有的服务端灰度开关机制：

- `packages/desktop/src/main/desktopContextPromptRollout.ts` —— 控制 `desktop_context` 系统提示段是否注入；
- `packages/desktop/src/main/rendererActionTraceRollout.ts` —— 控制 renderer 动作追踪。

两者共用 `singleFeatureRollout.ts` 的旁路请求（3s 超时、60min TTL），默认快照都是
`{ enabled: false }`（fail-close），请求失败时沿用上次快照。也就是说断网或被墙时只是功能保持关闭，
不会阻塞启动；但只要可达，打包版仍会在启动时向 `zcode.z.ai` 发请求。
若目标是「打包版完全不访问官方地址」，这两处需要单独处理。

**未执行（如实说明）**：

1. **没有跑打包验收**。本轮改动涉及 `electron-builder.config.js` 与 `release.yml`，
   只有真正跑一次 `pnpm bundle:desktop` 并检查 `dist-*/` 里出现 `latest*.yml` / `dev*.yml`
   才能证明元数据生成与上传列表匹配。**建议在合并前跑一次 canary 构建**，然后确认：
   `releases/download/canary-build/dev.yml`、`dev-mac.yml` 可访问，且其中的资产 URL 能下载。
2. **没有端到端验证更新闭环**。需要两个不同版本的签名产物（macOS 必须签名，见 design.md 的风险 1）
   才能验证「发现更新 → 下载 → 重启安装」。
3. `packages/desktop/src/main` **不在 `pnpm typecheck` 的覆盖范围内**
   （根命令只构建 `packages/desktop/tsconfig.host.json`），且该工程本身带着改动前就存在的类型错误
   （`taskRealtimeBus.ts`、`windowsChromeAppBoundKey.ts`、`index.ts` 等 20 个文件）。
   因此本轮对 `autoUpdater.ts` / `index.ts` 的类型校验是单独执行的：
   `npx tsc -b packages/desktop/tsconfig.main.json`，本次新增/修改的文件无新增错误。
   这是个既有缺口，未在本轮修复。
4. 更新弹窗的 release notes 会退化（design.md 风险 3），属预期行为，未做补偿。

## 5. 与设计的偏差

- feed 模块目录从 `src/fork/` 改为 `src/main/fork/`（原因见 §1）。
- 设计里写「stable 与 preview 用两个基址」，实现上额外把 `allowPrerelease` 与通道绑定，
  避免 electron-updater 内部对 prerelease 的判断与 channel 分叉。
- 强更相关的 shared/services 死代码（`getForceUpdateConfig` 等）在设计中列为「非目标」，
  实现时一并删除：它们的唯一消费方就是被删掉的强更 gate，留着会变成无引用的 RPC 面。

## 6. 配套 Source Server GitHub 发布（2026-11-02）

### 落地位置与接线

- `main/fork/github-update/feed.ts` 复用本项目仓库身份，提供完整版本的 `server-v<VERSION>` 下载根。
- `main/remoteCdn.ts` 仅替换生产默认源；显式覆盖、构建期源覆盖、test 内网源和开发态 mock-cdn 仍保留。
- `packages/server/src/remote/remoteAssetCdn.ts` 识别 GitHub Release 的平铺资产路径，不追加版本子目录。
- `host/sourceServerReleaseResolver.ts` 沿用原解析/下载/缓存/校验，清单错误保留各源上下文与 cause；
  展示层仍遵守 URL 脱敏合同，HTTP 状态和解析/网络错误可见。上游接线标记均为 `github-update`。
- `.github/workflows/release.yml` 的 `build-source-server` 消费 resolve 的同一版本，复用四平台 staging，
  校验完整 descriptor/归档，并在 Ubuntu 执行 Linux x64 归档的 `bin/zcode --version` 冒烟。
- `scripts/ci/source-server-release.mjs` 负责验证、已发布包复用和 draft 发布。独立 Server 发布完成后
  才更新桌面 Release；不移动 tag，不覆盖已公开归档。重跑优先复用原包，避免 tar 时间戳漂移。
- `cleanup-prerelease-tags.yml` 保留 `server-v*`，桌面 canary 指针清理不接触 Server 资产。

### 回归与依赖契约

测试先于实现：原 GitHub 路径拼接、默认源与错误上下文共 6 项失败；发布脚本测试因模块缺失失败。
随后实现并验证：

- 6 文件 60 项 Vitest 通过：默认下载源、时区无关/完整版本隔离、Desktop 环境策略、Host 接线、
  resolver、CDN URL 合同与既有 Server 归档收集。
- 13 项 Node 发布测试通过：四平台集合、descriptor/归档版本、尺寸、SHA、缺包与包内 manifest，
  draft 顺序、只读重跑、内容冲突、鉴权失败不伪装 404、CI 依赖与清理守卫。
- 14 项既有 GitHub 更新源和 electron-updater 依赖契约通过。
- `pnpm typecheck` 通过；`pnpm lint` 通过（102 个现有 warning，0 error）。
- `pnpm --filter @zcode/server-cli build` 通过，实际执行 `dist/server-cli.js --version` 输出 `3.17.162`。
- 两个 workflow 的 actionlint 检查通过；桌面 artifact pattern 实测只选择 mac-arm64/win-x64，排除 Server。
- `pnpm fork:check-removals` 通过。当前工作区架构检查失败于并行协作 runtime 的循环依赖与
  `runtime/off-peak/runtime.ts`、`subagent/listing.ts` 的受管登记；未改这些文件或降低门禁。

上游若改变发布 descriptor 文件名、归档名/目标集合、相对 URL 形状、包内 manifest 的版本/目标字段，
这些断言应失败，要求显式调整适配；不能以可选兜底或宽松版本回退隐藏契约变更。

### 未验证与交付边界

- 尚未运行托管 GitHub Actions、上传真实 Server Release 或发布新的桌面 canary。
- 本地只验证 Server bundle 构建/版本入口与测试归档；未在本地跑四平台完整生产 staging，
  未执行 Linux/macOS ARM/Intel 的全部原生运行验收。CI 包校验不是所有平台运行验证的替代。
- 未连接、安装或重启用户远程设备；需在新发布下载完成后，以真实 SSH 新设备安装验收闭环。
- 旧桌面安装包仍含旧下载源，不会因本次源码修改自动修复；需要安装包含本次接线的新桌面包。

## 7. Windows 未签名更新兼容（2026-11-03）

- 同步上游 a60ba6a7 时保留 GitHub generic feed；按用户确认不引入强制 Authenticode hook，
  不执行安装前缓存包签名复查。未签名包继续走 electron-updater 原生安装入口。
- `electron-builder.config.js` 显式关闭 `win.verifyUpdateCodeSignature`，避免签名构建自动写入
  publisherName 后把未来未签名更新拒绝；发布签名 hook 本身保留。
- 保留启动参数 `--` 边界与正式包忽略调试 feed 的上游安全加固，保留下载 SHA512 完整性校验。
- 先补回归：配置/接线的无强制签名契约、Windows 原生安装、参数边界与正式包 feed 不可覆盖。
  新策略契约先失败于签名校验仍在位；未解冲突的 updater 运行测试先失败于编译。
- 验证：updater scoped Vitest 72/72、GitHub feed/第三方依赖/未签名策略 node 契约 15/15 通过；
  `pnpm typecheck` 全部通过（含 desktop main/host/E2E、remote-main、CUA）；4 个修改文件 lint
  0 warning / 0 error，移除守卫全部通过。真实 Windows 未签名下载、安装和 SmartScreen 未验证。

## 8. 开发渠道 Source Server 版本门（2026-11-03）

- dev Desktop 连接 Source Server 时跳过最低兼容版本比较；正式版仍按 compatibility manifest 执行完整门禁。
- 连接前安装检查与握手后的双端比较共享同一渠道判定，避免只修一处后另一处继续拦截。
- 开发渠道不再因两个提交哈希的字典序显示升级要求；缺少 compatibility manifest 的旧 Server 仍 fail closed。
- 回归覆盖 `3.17.162-dev.c1ea55a4` 连接更旧/更高哈希 dev Server 均放行，以及正式版旧 Server 仍被拒绝。
