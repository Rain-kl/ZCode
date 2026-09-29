# GitHub 更新通道 (github-update) 设计

## 背景

上游桌面端的自动更新走服务端 manifest：

- 自定义 `ManifestUpdateProvider` 请求 `https://zcode.z.ai/api/v1/releases/electron/manifest?platform=…&channel=1|3`
  （`packages/desktop/src/main/manifestUpdateProvider.ts`），origin 由 app settings 的
  `zcodeEndpointOrigin` / `ZCODE_BASE_URL` / `ZCODE_ENDPOINT_ORIGIN` 覆盖。
- 启动前还有一道**强更 gate**：请求 `https://zcode.z.ai/api/v1/client/configs?app_version=…&platform=…`，
  远端 `forceUpdate.minimalVersion` 高于本机版本时，弹出原生对话框并**阻止创建主窗口**
  （`packages/desktop/src/main/forceUpdateGuard.ts`）。

本 fork 的产物只发布到自己的 GitHub Release（`.github/workflows/release.yml`），
不部署 `zcode.z.ai` 的服务端 manifest。因此线上包：

1. 自动更新查的是上游地址，永远不会拿到本 fork 的版本；
2. 启动前会向上游 `/client/configs` 发一次请求，并可能被上游的 `minimalVersion` 判定为「必须升级」
   而拦在启动页——对一个离线可用的二开版本属于不可接受的外部依赖。

## 目标

- 桌面端自动更新改为查询本 fork 的 GitHub Release，不再请求 `zcode.z.ai`。
- 移除启动强更 gate：不再请求 `/client/configs`，不再因远端配置阻止主窗口创建、退出应用。
- 发布流水线产出并上传 electron-updater 需要的更新元数据，否则换源后必然报「找不到 channel 文件」。

## 非目标

- 不改变更新器自身的下载/安装时序（暂停、取消、跳过版本、差分下载、`quitAndInstall` 前置退出准备全部保留）。
- 不改变 `zcodeEndpointOrigin` / `ZCODE_BASE_URL` 的其余用途（模型网关转发、OAuth、计费、builtin provider 缓存路径）。
- 不引入更新包签名校验（见「已知风险」）。
- 不做应用内「检查 provider 配置更新」等其它链路。

## 方案

### 为什么不用 electron-updater 内置的 `provider: "github"`

内置 GitHub provider 从仓库的 `releases.atom` feed 取**第一条 entry** 当最新版本，再据此拼
`releases/download/<tag>/<channel>.yml`。实测本 fork：

```
$ curl -sSL https://github.com/Rain-kl/ZCode/releases.atom | grep -o '/releases/tag/[^"]*'
/releases/tag/v3.14.3          <-- 第一条，却是最旧的
/releases/tag/dev-323af505
/releases/tag/dev-0baa473a
```

两个问题：

1. **feed 包含 prerelease**，且本仓库 feed 的顺序是「旧 → 新」（对照 `electron/electron` 的 feed 是「新 → 旧」），
   provider 不做排序，第一条 entry 会被当成最新版本 → 解析到错误的 tag；
2. 即使顺序正常，`allowPrerelease=false` 也只是「不优先 prerelease」，不会**过滤**它们，
   稳定通道会被解析到 dev tag。

结论：内置 provider 依赖一个我们无法控制的隐式顺序，不可靠。

### 采用：generic provider + GitHub 的 `releases/latest/download` 别名

GitHub 的 `releases/latest` 由 GitHub 自己定义为「最新的**非** prerelease、非 draft 发布」，语义确定：

```
$ curl -sSI https://github.com/Rain-kl/ZCode/releases/latest/download/latest.yml
HTTP/2 302
location: https://github.com/Rain-kl/ZCode/releases/download/v3.14.3/latest.yml
```

因此用 electron-updater 的 generic provider，把基址指向该别名即可，不解析 feed、不做版本排序：

| 通道 | 触发条件 | 基址 | channel 文件（win / mac） |
| --- | --- | --- | --- |
| stable | `receivePreviewUpdates !== true`（默认） | `https://github.com/Rain-kl/ZCode/releases/latest/download/` | `latest.yml` / `latest-mac.yml` |
| preview | `receivePreviewUpdates === true` | `https://github.com/Rain-kl/ZCode/releases/download/canary-build/` | `dev.yml` / `dev-mac.yml` |

**基址必须以 `/` 结尾**：electron-updater 用 `new URL(相对路径, base)` 解析 metadata 与资产 URL，
基址不带尾斜杠时最后一个路径段会被当成文件名丢掉，`.../latest/download` 会被解析成 `.../latest/<asset>`（404）。
这条不在类型签名里，只靠契约测试兜住，见 `packages/desktop/test/electronUpdaterFeedContract.test.ts`。

- `channel` 由 `autoUpdater.channel` 决定（`GenericProvider.channel` = `updater.channel || configuration.channel`，
  文件名 = `` `${channel}.yml` ``，mac 追加 `-mac` 前缀），stable 设为 `null`，preview 设为 `"dev"`。
- 同时设置 `allowPrerelease`，与 channel 语义保持一致。
- dev 专属覆盖保留：`ZCODE_UPDATE_FEED_URL` / `--zcode-update-feed-url` 直接替换**基址**，
  且仅未打包时生效（打包版 warn 并忽略），用于本地对联调更新闭环。
- preview 的 `canary-build` 是**固定 tag 的指针 Release**，由发布流水线每次 `--clobber` 覆盖其资产；
  不移动 tag（只换资产），因此不需要 force push。

### 状态与所有者

| 事实 | 所有者 |
| --- | --- |
| 当前通道（stable / preview） | main 进程 `availableUpdateChannel`，来源是 `settingService.receivePreviewUpdates` |
| 更新器 feed 配置 | `packages/desktop/src/main/fork/github-update/feed.ts`（本 fork 唯一写入点） |
| 更新状态机（checking / available / downloading / downloaded） | `packages/desktop/src/main/autoUpdater.ts`（不变） |
| 更新元数据文件与资产 | 发布流水线（`.github/workflows/release.yml`） |

通道切换时（用户在设置里翻转「接收 preview 版本」）必须**重新应用 feed 再发起 check**，
否则会用新 channel 去请求旧基址，或反之。这一步合进既有的 `refreshAutoUpdaterReleaseChannel`。

### 发布流水线需要的改动

`electron-builder` 只在配置了 `publish` 时生成更新元数据（`PublishManager.artifactCreatedWithoutExplicitPublishConfig`
→ `writeUpdateInfoFiles`，与是否真的上传无关），文件名由 `detectUpdateChannel` + 版本号决定：

- `detectUpdateChannel: false`（上游现值）→ 永远只产出 `latest*.yml`，dev 包会覆盖稳定通道的元数据；
- 改成 `true` 后：`3.14.3` → `latest*.yml`，`3.14.3-dev.<sha>` → `dev*.yml`，两条通道互不污染。

流水线还需要把元数据与 blockmap 一起上传（当前只上传安装包本体）：

- stable（tag 构建）→ tag Release 额外包含 `latest.yml` / `latest-mac.yml` + `*.blockmap`；
- dev（canary 构建）→ 只把同一批资产 `--clobber` 到固定 tag `canary-build` 的指针 Release；自 2026-09-29 起不再建 dev-<sha8> 发布（见 `docs/specs/desktop-release.md`）。

## 验收场景

1. **稳定通道**：`receivePreviewUpdates=false`，基址为 `releases/latest/download`，
   请求 `latest.yml`（win）/`latest-mac.yml`（mac），解析出的版本高于当前版本时进入「发现更新」。
2. **通道切换**：勾选「接收 preview 版本」后，重新应用 feed（基址与 channel 同时切换）并重新 check；
   check 进行中则只记 pending，结束后再应用。
3. **不访问官方地址**：打包版启动、手动检查更新、通道切换三个路径都不再产生对 `zcode.z.ai` 的请求。
4. **dev 元数据不污染稳定通道**：dev 版本构建产出的元数据文件名是 `dev*.yml`，稳定包不会读到它。
5. **强更 gate 已移除**：启动过程不再请求 `/api/v1/client/configs`；即使把机器完全断网，
   主窗口与所有窗口创建入口（Dock / 托盘 / activate / deep link / second-instance）都不被阻止。
6. **更新状态机不回归**：暂停/取消下载、跳过版本（按 channel 分别持久化）、
   已下载后忽略更低版本、`quitAndInstall` 前仍等待 host/agent 退出准备。

## 已知风险与边界

1. **macOS 自更新要求签名**。Squirrel.Mac 会校验下载包的代码签名，未签名包安装阶段直接失败。
   本仓库签名由 `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` / `MAC_SIGNING_IDENTITY` 三个 secret 打开，
   未配置时 **macOS 自动更新不可用**（Windows NSIS 不受影响，但未签名安装包会触发 SmartScreen）。
2. **元数据无签名**。`latest*.yml` 里的 sha512 是唯一的完整性校验，而该文件本身没有签名；
   GitHub 账号或组织成员可以推送任意更新。相比服务端 manifest，信任根从上游服务转移到 GitHub 仓库的写权限。
3. **更新说明会退化**。原服务端 manifest 提供 `releaseNotesByLocale`（中英双语正文）；
   generic provider 的 `releaseNotes` 来自 yml 里的 `releaseNotes` 字段（electron-builder 默认不写），
   因此更新弹窗基本不再展示说明文案。若要保留，需要在流水线里把说明写进 yml 或改用自定义 provider。
4. **dev 通道按 sha 字典序比较**。`3.14.3-dev.<sha>` 的升级判定是 semver prerelease 的字典序，
   与提交时间无关；极端情况下新构建的 sha 字典序更小，dev 客户端不会把它识别为更新。
   仅影响 preview 通道，稳定通道不受影响。
5. **GitHub 直连可达性**。Release 资产最终 302 到 `release-assets.githubusercontent.com` 并附带签名 URL，
   国内网络可能不稳定；electron-updater 没有多源回退。需要时依赖系统代理或镜像。
6. **移除强更 gate 后没有 kill switch**。旧版本出严重问题时只能靠用户主动检查更新，
   不能再强制下线。若将来需要，建议改成「只提示不阻断」或在读取 Release 正文时解析最低版本要求。
