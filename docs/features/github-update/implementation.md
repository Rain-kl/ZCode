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
- `release.yml` publish job：dev 构建在写完 `dev-<sha>` 预发布后，把同一批资产 `--clobber` 到固定 tag `canary-build` 的指针 Release（只覆盖资产、不移动 tag，因此不需要 force push）。

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
