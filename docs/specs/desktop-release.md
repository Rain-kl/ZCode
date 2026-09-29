# 桌面端发布流水线

范围：`.github/workflows/release.yml` 与 `scripts/ci/release-version.mjs`。覆盖 macOS（arm64）与 Windows（x64）两个平台的安装包构建与 GitHub Release 发布。

## 通道与触发

| 通道     | 触发条件                              | 版本                                | Release                 |
| -------- | ------------------------------------- | ----------------------------------- | ----------------------- |
| `stable` | 推送 `v*.*.*` tag                     | tag 去掉 `v` 前缀（如 `3.14.3`）    | `v3.14.3`，正式 Release |
| `dev`    | 推送到 `canary` 分支，或手动 dispatch | `<根 package.json 版本>-dev.<sha8>` | `dev-<sha8>`，预发布    |

手动 dispatch 只能选 `dev`；`stable` 必须由 tag 触发，否则流水线在 `resolve` 阶段直接失败，避免出现「人工填版本 + 无 tag」的稳定版本。

## 版本事实源与所有权

- **唯一事实源**：根 `package.json` 的 `version`。桌面端没有任何版本环境变量覆盖入口。
- **消费链**：`packages/desktop/scripts/build-metadata.mjs` 在构建期把版本写入 `out/metadata/build-meta.json`，再分别喂给
  - tsup / vite 的编译期常量 `__ZCODE_VERSION__`（About 面板、遥测、RUM）；
  - electron-builder 的 `extraMetadata.version`（运行时 `app.getVersion()`、产物文件名 `${productName}-${version}-...`）。
- **写入者**：流水线在打包前调用 `scripts/ci/release-version.mjs apply` 改写根 `package.json`。这是唯一允许改写版本的位置，构建阶段只读不写。

接口契约（`scripts/ci/release-version.mjs`）：

- `apply --tag <vX.Y.Z> | --dev-commit <sha> | --version <x.y.z[-pre]>`：改写根 `package.json`，stdout 输出 `version=<v>` 与 `channel=stable|dev`，人类可读日志走 stderr；非法 semver（含 `+`）或非法 SHA 直接非零退出。
- `verify --expect <v> --asar <app.asar> [--expect-commit <full-sha>]`：校验产物内 `package.json#version`、`out/metadata/build-meta.json#appVersion`，以及短 SHA `buildCommitId` 与期望提交的前缀一致。

## 作业门禁与跳过语义

- `verify`（typecheck / lint / architecture / fork-removals / CLI 构建 / 单测）**只在非 dev 渠道运行**：dev 由推送 `canary` 触发，直接进集成以缩短 CI；tag 发布仍走完整门禁。
- **无 `if` 的作业隐式条件是 `success()`，它要求依赖图上「所有祖先作业」成功——被跳过的祖先会让下游被判成 skip。** 这不是「只要求直接 `needs` 成功」。实测踩到过：`verify` 按预期 skipped、两个平台构建都 success，但 `publish` 因为没有显式条件而被跳过，dev 包没发出来（run 36521516436）。
- 因此凡是 `needs` 链上可能出现 skipped 的作业都必须显式写条件。当前判定如下：

| 渠道               | `verify` | `build-macos` / `build-windows` | `publish`                                |
| ------------------ | -------- | ------------------------------- | ---------------------------------------- |
| dev（推送 canary） | skipped  | 运行（条件容忍 `skipped`）      | 运行（只要求三个直接依赖 `success`）     |
| tag 且门禁通过     | success  | 运行                            | 运行                                     |
| tag 且门禁失败     | failure  | 跳过（条件不满足）              | 跳过（构建非 `success`）→ 不创建 Release |

- 新增作业时照抄这条规则：**只要它 `needs` 的链上可能有 skipped 作业，就必须写显式条件**（用 `!cancelled()` 而非 `always()`，后者在被取消时也会继续跑）。
- `verify` 里在单测前会按依赖链构建 CLI 包（`pnpm -r --filter "@zcode/core..."`）：`apps/zcode-cli/packages/core/test` 的测试 import 上游 tool 入口，而这些包的 `exports` 指向 `dist`，verify 只 install 不 build 会 `ERR_MODULE_NOT_FOUND` 让整组失败。

## 构建环境契约

- `ZCODE_ENV=production`：builtin provider 配置与产品身份都按 production 解析。缺失或为 `test` 时 `desktop-product-identity.mjs` 会回落到 Preview 身份，产物变成 “ZCode Preview” 且文件名带 `_TEST` 后缀。
- Windows job 带 `ZCODE_SKIP_REMOTE_ASSETS=1`：Windows 安装包不依赖 mock-cdn remote 资产（`packages/desktop/scripts/prepare-runtime-assets.mjs:56`）。
- `ZCODE_DESKTOP_DIST_DIR=dist-<os>-<arch>`：按平台隔离 electron-builder 输出目录，避免多架构共享 checkout 时互相覆盖。
- macOS 只发布 arm64 包。若要发布 Intel 包，必须在 Intel runner（`macos-15-intel`）上构建：node-pty 在非 Windows 宿主按宿主架构 `electron-rebuild`，且运行时优先加载 `build/Release/pty.node`，在 arm64 宿主上打 x64 包会混入 arm64 原生模块。
- 首次发布前需在组织/仓库 Secrets 配置（可选）：`MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、`MAC_SIGNING_IDENTITY`。三个变量同时存在时流水线设置 `ZCODE_ENABLE_MAC_SIGN=1` 并注入 electron-builder 证书变量；缺省则产出未签名包。

## 验收场景

1. **tag 版本进入程序**：`verify` 步骤比对 app.asar 内 `package.json#version` 与 `build-meta.json#appVersion` 等于 tag 版本，且 `buildCommitId` 为该 tag 提交的短 SHA。产物文件名同时包含该版本号（`ZCode-<version>-mac-arm64.dmg` 等），上传步骤使用 `if-no-files-found: error`。
2. **dev 通道不污染稳定通道**：`dev-<sha8>` 以 `--prerelease --latest=false` 发布，`releases/latest` 仍指向稳定版本。
3. **半套产物不发布**：`publish` 的显式条件要求两个平台构建都 `success`，任一平台失败则整体不创建 Release；tag 渠道下 `verify` 失败会先让两个构建被跳过，`publish` 随之不成立（注意这里**不能**依赖「默认 `needs` 语义」，见「作业门禁与跳过语义」）。
4. **重复执行幂等**：同一 tag 或同一提交重跑时，先 `gh release edit` 再回退 `create`，资源用 `--clobber` 覆盖。
5. **dev 通道只保留最新一份**：发布 `dev-<sha8>` 成功后，publish 步骤删除其它 `dev-*` 发布并连同 tag 清理（`gh release delete --cleanup-tag`）；清理是 best-effort，失败不影响本次发布，下一轮再试。
   - **指针发布 `canary-build` 只保留本次集成的资产**：资产名带版本号（`ZCode-<version>-<platform>-<arch>`），`gh release upload --clobber` 只覆盖同名文件，所以 publish 在「先上传本次资产、再删掉不属于本次的文件」。不清理时实测堆到 18 个资产 / 3 个版本（`dev.yml` / `dev-mac.yml` / `SHA256SUMS.txt` 名字固定，靠 `--clobber` 覆盖）。
   - **清理范围必须限定在 `dev-*`**：`canary-build` 是 preview 更新通道的固定 tag 入口（客户端读它资产里的 `dev.yml` / `dev-mac.yml`，见「更新通道」），stable tag 发布是正式版本——放宽成「所有 prerelease」会让预览通道的更新检查直接失效。

## 边界与已知缺口

- **公证未实现**：仓库刻意关闭 electron-builder 内置公证（`notarize: false`），公证属于独立阶段，本流水线不做；macOS 产物默认未签名、未公证，用户首次打开需手动放行。
- **嵌套运行时未预签名**：`Contents/Resources/glm`、`tools` 与 CUA Helper 在原流水线中由独立 job 完成 Developer ID 签名与 staple，本流水线不涉及。因此仅打开签名开关只覆盖主 app，不构成可公证的完整签名链。
- **发布架构范围**：macOS 仅 arm64，Windows 仅 x64（未发布 win32-arm64、mac x64）。
- **第三方清单**：`third-party/inventory.json` 记录的 `package.json` 哈希与当前文件不一致（需执行 `node scripts/licenses.mjs notices` 重新生成），因此 `licenses.mjs check --strict` 在流水线中仅作提示（`continue-on-error: true`），不阻塞发布；打包链路本身不校验清单新鲜度。
- **已跳过作业的流水线「成功」具有误导性**：`publish` 被跳过时整个 run 仍显示 success（被跳过的作业不算失败）。发布是否真的发生，要看 run 里 `publish` 的结论，不能只看 run 的总体状态。
