# 桌面端发布流水线

范围：`.github/workflows/release.yml` 与 `scripts/ci/release-version.mjs`。覆盖 macOS（arm64、x64）与 Windows（x64）两个平台的安装包构建与 GitHub Release 发布。

## 通道与触发

| 通道     | 触发条件                                | 版本                             | Release                    |
| -------- | --------------------------------------- | -------------------------------- | -------------------------- |
| `stable` | 推送 `v*.*.*` tag                       | tag 去掉 `v` 前缀（如 `3.14.3`） | `v3.14.3`，正式 Release    |
| `dev`    | 推送到 `canary` 分支，或手动 dispatch   | `<根 package.json 版本>-dev.<sha8>` | `dev-<sha8>`，预发布       |

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

## 构建环境契约

- `ZCODE_ENV=production`：builtin provider 配置与产品身份都按 production 解析。缺失或为 `test` 时 `desktop-product-identity.mjs` 会回落到 Preview 身份，产物变成 “ZCode Preview” 且文件名带 `_TEST` 后缀。
- Windows job 带 `ZCODE_SKIP_REMOTE_ASSETS=1`：Windows 安装包不依赖 mock-cdn remote 资产（`packages/desktop/scripts/prepare-runtime-assets.mjs:56`）。
- `ZCODE_DESKTOP_DIST_DIR=dist-<os>-<arch>`：按平台隔离 electron-builder 输出目录，避免多架构共享 checkout 时互相覆盖。
- mac x64 必须跑在 Intel runner（`macos-15-intel`）：node-pty 在非 Windows 宿主按宿主架构 `electron-rebuild`，且运行时优先加载 `build/Release/pty.node`，在 arm64 宿主上打 x64 包会混入 arm64 原生模块。
- 首次发布前需在组织/仓库 Secrets 配置（可选）：`MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、`MAC_SIGNING_IDENTITY`。三个变量同时存在时流水线设置 `ZCODE_ENABLE_MAC_SIGN=1` 并注入 electron-builder 证书变量；缺省则产出未签名包。

## 验收场景

1. **tag 版本进入程序**：`verify` 步骤比对 app.asar 内 `package.json#version` 与 `build-meta.json#appVersion` 等于 tag 版本，且 `buildCommitId` 为该 tag 提交的短 SHA。产物文件名同时包含该版本号（`ZCode-<version>-mac-arm64.dmg` 等），上传步骤使用 `if-no-files-found: error`。
2. **dev 通道不污染稳定通道**：`dev-<sha8>` 以 `--prerelease --latest=false` 发布，`releases/latest` 仍指向稳定版本。
3. **半套产物不发布**：`publish` 依赖两个平台构建 job 全部成功（默认 `needs` 语义），任一平台失败则整体不创建 Release。
4. **重复执行幂等**：同一 tag 或同一提交重跑时，先 `gh release edit` 再回退 `create`，资源用 `--clobber` 覆盖。

## 边界与已知缺口

- **公证未实现**：仓库刻意关闭 electron-builder 内置公证（`notarize: false`），公证属于独立阶段，本流水线不做；macOS 产物默认未签名、未公证，用户首次打开需手动放行。
- **嵌套运行时未预签名**：`Contents/Resources/glm`、`tools` 与 CUA Helper 在原流水线中由独立 job 完成 Developer ID 签名与 staple，本流水线不涉及。因此仅打开签名开关只覆盖主 app，不构成可公证的完整签名链。
- **Windows 仅 x64**：未发布 win32-arm64。
- **第三方清单**：`third-party/inventory.json` 记录的 `package.json` 哈希与当前文件不一致（需执行 `node scripts/licenses.mjs notices` 重新生成），因此 `licenses.mjs check --strict` 在流水线中仅作提示（`continue-on-error: true`），不阻塞发布；打包链路本身不校验清单新鲜度。
- **canary 分支需要存在于 origin**：当前远端只有 `main`，分支推送触发在 `canary` 建立后才生效。
