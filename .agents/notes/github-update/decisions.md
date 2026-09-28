# github-update 调研与决策记录

日期：2026-09-28
关联：`docs/features/github-update/design.md`、`docs/features/github-update/implementation.md`、`FEATURES.md` 的 `github-update` 条目

## 1. 关键调研结论（含证据）

- **更新地址是服务端 manifest，不是 GitHub**：`packages/desktop/src/main/manifestUpdateProvider.ts:22` +
  `packages/shared/src/zcodeEndpoint.ts:3`，最终 URL 为
  `https://zcode.z.ai/api/v1/releases/electron/manifest?platform=<os-arch>&channel=1|3`，
  header 带 `X-Platform` / `X-Release-Channel` / 可选 `X-Device-Mid`。
- **origin 有三层覆盖，且 `autoUpdater.ts` 里那行常量不是硬编码**：
  `resolveCurrentZCodeEndpointOrigin`（`index.ts:675`）按 app settings 的 `zcodeEndpointOrigin`
  → `ZCODE_BASE_URL`/`ZCODE_ENDPOINT_ORIGIN`（进程 env > 本地 env 文件 > 构建期内嵌 `__ZCODE_ENDPOINT_ENV__`）
  → 默认值。`setFeedURL({endpointOrigin: DEFAULT_...})` 看着像写死，但 provider 的
  `resolveEndpointOrigin()` 优先于 `options.endpointOrigin`，实际生效的是上面三层。
- **第二个请求是强更 gate**：`forceUpdateGuard.ts` 请求 `/api/v1/client/configs?app_version=&platform=`，
  读 `forceUpdate.minimalVersion`，命中后弹原生对话框并在 `primaryWindowCoordinator.canCreateWindow`
  拦掉所有建窗入口。
- **electron-updater 内置的 `provider: "github"` 在本仓库不可用**（实测，见 §3）。
- **更新元数据文件名规则**：`app-builder-lib/out/publish/updateInfoBuilder.js:36-46`
  —— `${channel}${平台后缀}.yml`（mac 为 `-mac`），channel 取 `publishConfig.channel || "latest"`；
  `PublishManager.js:382-393` 在 `detectUpdateChannel` 为真时用 `appInfo.channel`
  （= 版本号 prerelease 的第一段，`appInfo.js:59-65`）当 channel。
- **元数据写出与是否真发布无关**：`PublishManager.js:158-163` 只要 `publishConfigs != null`
  且 `event.isWriteUpdateInfo` 就 `createUpdateInfoTasks`，`updateInfoBuilder.js:183` 直接写盘。
  所以现有 generic 占位 publish 配置已经在产出 `latest*.yml`，只是流水线从没上传过。
- **generic provider 的 channel 文件名**：`electron-updater/out/providers/GenericProvider.js:19-22`
  （`updater.channel || configuration.channel`）+ `util.js:30-32`（`` `${channel}.yml` ``），
  默认 channel 名由 `Provider.getCustomChannelName` 加平台前缀。
- **`packages/desktop/src/main` 不在 `pnpm typecheck` 覆盖内**：根命令只构建
  `packages/desktop/tsconfig.host.json`（include 仅 `src/host`），而 `tsconfig.main.json` 单独跑会有
  20 个文件的既有类型错误（`taskRealtimeBus.ts`、`windowsChromeAppBoundKey.ts`、`index.ts` 等）。
- **`/api/v1/client/configs` 还有两个消费者**：`desktopContextPromptRollout.ts` 与
  `rendererActionTraceRollout.ts`（共用 `singleFeatureRollout.ts`，3s 超时 / 60min TTL /
  默认 `{enabled:false}` fail-close）。移除强更 gate 不会让打包版停止访问该地址。

## 2. 决策与理由

| 决策 | 选择 | 拒绝的替代方案与理由 |
| --- | --- | --- |
| 更新源实现 | 保留 electron-updater，换成 `provider: "generic"` + GitHub 的 `releases/latest/download` 别名 | ① 内置 `provider: "github"`：feed 顺序不可控 + 不过滤 prerelease（见 §3）；② 自建 manifest 服务：要额外部署与运维；③ 改回自定义 provider 读 GitHub 上的 yml：解析层要自己维护版本排序，收益为负 |
| preview 通道 | 固定 tag `canary-build` 的指针 Release，流水线只覆盖资产、不移动 tag | 客户端无法预知下一个集成构建的 `dev-<sha>` tag，必须有固定地址；移动 tag 需要 force push，违反仓库约定 |
| 通道语义 | `receivePreviewUpdates` → (基址, channel 文件名) 同时切换，`allowPrerelease` 与之绑定 | 只切 channel 不切基址（或反之）必然 404：stable 基址下不存在 `dev.yml` |
| 元数据文件名 | `electron-builder.config.js` 的 `detectUpdateChannel` 由 `false` 改 `true` | 不改则 dev 版本也写 `latest*.yml`，会顶掉稳定通道的元数据，把稳定用户推到集成构建 |
| 强更 gate | 整条链路删除（含 shared/services 里的死代码） | 保留但改成「只提示不阻断」需要引入新的 UI 状态机；本轮用户明确要求移除 |
| fork 目录位置 | `packages/desktop/src/main/fork/github-update/` | `AGENTS.md` 字面写的是 `src/fork/`，但那里不被任何 tsconfig include，等于新代码不受类型检查；`src/main/fork/` 与既有 `src/host/fork/webdav/` 一致 |

## 3. 踩坑（实现时复用）

- **GitHub 的 `releases.atom` 会包含 prerelease，而且顺序不能假设**。实测本仓库 feed 是「旧 → 新」：

  ```
  $ curl -sSL https://github.com/Rain-kl/ZCode/releases.atom | grep -o '/releases/tag/[^"]*'
  /releases/tag/v3.14.3      # 第一条，但它是这三个里最旧的
  /releases/tag/dev-323af505
  /releases/tag/dev-0baa473a
  ```

  对照 `electron/electron` 的 feed 是「新 → 旧」。electron-updater 的
  `GitHubProvider.getLatestVersion()` 直接取 `feed.element("entry")` 当最新版本、不做排序，
  因此在本仓库会解析到错误的 tag；即使顺序正常，稳定通道也会被解析到 dev tag
  （`allowPrerelease=false` 只是不优先、不过滤）。**结论：不要依赖 atom feed 的顺序。**
- **`releases/latest/download` 才是可靠别名**。GitHub 把 `latest` 定义为「最新的非 prerelease、非 draft」：

  ```
  $ curl -sSI https://github.com/Rain-kl/ZCode/releases/latest/download/latest.yml
  HTTP/2 302
  location: https://github.com/Rain-kl/ZCode/releases/download/v3.14.3/latest.yml
  ```

  资产最终 302 到 `release-assets.githubusercontent.com` 的签名 URL（国内可达性风险见 design.md 风险 5）。
- **`setFeedURL` 传对象时 `channel` / `useMultipleRangeRequest` 都会被 provider 读取**
  （`providerFactory.createClient` 的 `generic` 分支直接把整个对象当 configuration）。
- **generic provider 的基址必须带尾斜杠**。`Provider.resolveFiles` 与 `GenericProvider.getLatestVersion`
  都用 `newUrlFromBase(相对路径, baseUrl)`，底层是 `new URL(relative, base)`：基址不带 `/` 结尾时
  最后一个路径段会被当成文件名丢掉。实测（`packages/desktop/test/electronUpdaterFeedContract.test.ts`）：

  ```
  base = .../releases/latest/download   -> .../releases/latest/ZCode-….zip      （404）
  base = .../releases/latest/download/  -> .../releases/latest/download/ZCode-….zip
  ```

  本项目最初就是去掉了尾斜杠（以为避免 `//latest.yml`），换源后 metadata 与资产 URL 会整体错位、
  更新链路完全不工作。这个缺陷是契约测试写出来的当天抓到的，不是靠人工 review。
  另注意尾斜杠要补进 **pathname**：`http://host/feed?v=2` 直接拼串会得到 `http://host/feed?v=2/`。
- **linux 的 channel 文件名带架构后缀**（`getChannelFilePrefix` 读 `runtimeOptions.platform` 与
  `TEST_UPDATER_ARCH || process.arch`：`dev-linux` / `dev-linux-arm64`）。本 fork 不发布 linux 包，
  但这条会改变"同一份 yml 名称"的假设，已用 `TEST_UPDATER_ARCH` 钉成断言。
- **`tsc -b packages/desktop/tsconfig.main.json` 会顺带重写 `packages/desktop/src/shared/armsRumShared.{js,d.ts}`**
  等已被提交的生成物（只有缩进/尾逗号差异），并生成 `src/scheduler/schedulerProtocol.{js,d.ts,map}`。
  `pnpm typecheck` 不会（已实测确认）。校验 main 工程类型时注意别把这些生成物一起提交。
- **macOS 自更新要求签名**，Squirrel.Mac 会校验下载包的代码签名；未配签名 secret 时
  macOS 端自动更新直接失败。这是本轮无法在本地验证闭环的根本原因。
