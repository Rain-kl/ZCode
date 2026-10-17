# ci-release-gate 决策记录

日期：2026-10-17
关联：`.github/workflows/release.yml`、`FEATURES.md` 的「其他更新」条目、
`packages/services/test/subagentRuntimeConfig.test.ts`。

## 1. 起因

`v3.16.151` tag 发布的 `Verify workspace gates` 在 Unit tests 步骤失败（run 39035210870，
作业 117403569760）。本地 `gh` token 失效，改用公开的 check-run annotations 取到 4 个失败用例：

- `packages/desktop/test/storagePreparationProtocol.test.ts`：`@zcode/adapters/storage` 找不到。
- `packages/desktop/test/desktopAgentBytecode.test.ts`：Electron 未安装。
- `packages/desktop/test/browserDataManager.test.ts`：Linux runner 上 Chrome 被误探测到。
- `packages/services/test/subagentRuntimeConfig.test.ts`：目录替换后旧 watcher 未关闭。

## 2. 根因与处理

### 2.1 verify 的安装/构建与单测依赖不匹配

verify 用 `pnpm install --ignore-scripts` 加速，且只构建 `@zcode/core...`。上游 v3.15.1 后：

- `storagePreparationProtocol.test.ts` 直接 import bootstrap 源码，bootstrap 依赖
  `@zcode/adapters/storage` 的 dist；删掉本地 adapters dist 可稳定复现 `ERR_MODULE_NOT_FOUND`。
  → 构建 filter 补 `--filter "@zcode/adapters"`。
- `desktopAgentBytecode.test.ts` 要执行真实 Electron 二进制；`--ignore-scripts` 跳过了下载。
  → 增加只重建 electron 的步骤 `pnpm --filter @zcode/desktop rebuild electron`，保留其余脚本跳过。

### 2.2 browserDataManager 的宿主依赖

`buildStandardChromeInstallations` 对非 darwin/win32 平台回落到 Linux 标准路径；用例用
`platform: "aix"` 模拟「找不到 Chrome」，但 ubuntu runner 自带 `/usr/bin/google-chrome`，
于是走成功分支（`originsFailed: 0`）。测试改为显式 `chromeExecutablePath: ""`，锁定缺失分支；
不改产品语义（显式外部路径在未知平台仍应可用）。

### 2.3 subagent 目录替换漏检（产品修复）

父目录 `fs.watch` 事件原先丢弃事件内容，只触发一次 `checkWatch()`，后者以 dev/ino 判等。
Linux ext4 在 `rm -rf` 后立即重建目录时会复用刚释放的 inode，`dev/ino` 不变 → 不重建 watcher，
旧目录 watcher 永远收不到事件，后续配置修改静默失效。

处理：父目录事件为 `rename` 且 filename 指向被监听目录时强制 `checkWatch(true)`。filename 缺失
（部分平台）仍回落到 dev/ino 比较。新增回归用例把 `stat(userRoot)` 固定为替换前的 stats，
证明即使 inode 相同也会关闭旧 watcher。

上游标记：`FORK-BEGIN(其他更新)` / `FORK-END(其他更新)`，见 FEATURES.md「其他更新」。

### 2.4 打包阶段暴露的同步合并残留

verify 通过后，macOS/Windows 的 `Bundle desktop app` 同时失败（重复标识符注解指向
`bootstrap/src/app/types.ts`）。`pnpm verify` 的根 typecheck 不包含 `apps/zcode-cli`，
所以这类问题只会在打包时暴露：

- `bootstrap/src/app/types.ts` 在同步合并后保留了两份 import 前导块（fork 版与 upstream 版各一份），
  同名类型被导入两次，tsc 报 TS2300。合并为 upstream 结构，并把 fork 的
  `IdentityPresetPort` / `ForkToolModePort` 及其 FORK 注释并回 core import。
- `bootstrap/src/zcode-protocol-v4/commands/handlers/reload.ts` 仍从 `./session-flow.js`
  导入 `enqueueDeferredInputForBusyWork` / `V4InputAdmissionRejectedError`；上游已把这两个
  原语移到 `commands/input-admission.ts`，改为 `../input-admission.js`。
- `bootstrap/src/zcode-protocol-v4/product-projection.ts` 的 `CompactLifecyclePayload` 在同一
  import 列表出现两次，删除重复项。

验证：`pnpm --filter @zcode/bootstrap build` 通过；`pnpm --filter @zcode/desktop run prepare:agent-bundle`
从失败变为完整成功（CLI bundle + 官方插件 runtime 全部 staging 完成）。

### 2.5 Windows Gen UI vendor 的 CRLF hash 失配

Windows build 在 tsup 阶段失败：`Gen UI vendor hash mismatch: floating-ui-core-1.7.3.min.js`。
`copyGenUiRuntimeAssets` 按 manifest 的 SHA-256 校验 vendor 快照；这些 `.min.js` 未在
`.gitattributes` 标记为二进制，Windows 检出在 `core.autocrlf=true` 下把 LF 转成 CRLF，
字节改变导致 hash 失配（macOS/Linux 不转换，所以只有 Windows 失败）。
修复：`apps/zcode-cli/packages/visualize-plugin/skills/visualize/assets/vendor/**` 标记
`-text -whitespace`，保证按字节检出。

### 2.6 Install dependencies 的瞬时拉包失败

重试 tag 后 verify 在 `Install dependencies` 秒级失败，两次重试均失败；本地全新 store 安装
（约 3GB）成功，锁文件无问题。给安装步骤加 `--fetch-retries` 等参数后同一提交通过，判定为
runner 侧瞬时网络/拉包失败。安装步骤同时把失败尾部写成 `::error::` annotation，便于在无
管理员权限时排查（本仓库 Actions 日志需要 admin token）。

## 3. 验证

Node 24（mise 24.18.0，仓库 .nvmrc=24）下：

- `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check`、`pnpm fork:check-removals` 通过。
- 4 个原失败文件定向运行通过；新增 inode 复用回归用例先红后绿。
- 全量 `pnpm test:unit`：1917 个文件、17986 个用例通过，10 skipped，exit 0。
- 删除 adapters dist 后按新 filter 构建，storage 用例恢复通过；删除 electron dist 后
  `pnpm rebuild electron` 恢复二进制，bytecode 用例通过。
- Release Desktop run 39047581345：Resolve 与 Verify workspace gates 全绿（含此前失败的
  Unit tests）；随后 macOS/Windows 两个 Build 作业在 `Bundle desktop app` 暴露 §2.4 的合并残留。
- 修复 §2.4 后本地 `pnpm --filter @zcode/bootstrap build` 与 `prepare:agent-bundle` 通过。
- §2.5 在本地用 `git -c core.autocrlf=true checkout` 模拟 Windows 检出：vendor 文件仍为 LF，
  SHA-256 与 manifest 一致。
- 最终 Release Desktop run 39056659512（tag `v3.16.151` → `a4f9617b`）全绿：
  Resolve、Verify workspace gates、Build macOS (arm64)、Build Windows (x64)、Publish GitHub Release
  全部 success。Release 资产：macOS dmg/zip/blockmap、Windows exe/blockmap、latest.yml、
  latest-mac.yml、SHA256SUMS.txt。
- Ubuntu runner 上 Electron-as-Node 的系统库可用性已由 verify 的 `Unit tests` 实测通过。

## 4. 本地环境注意

- 从 ZCode 桌面端启动的终端会带 `ZCODE_CUA_BUNDLED_HELPER_APP_PATH` 等变量，
  `desktopRuntimeEnv.test.ts` 的 3 条 dev CUA 用例会因此失败；清掉这些变量后 36/36 通过。
  这是既有测试的环境隔离缺口，与本次 CI 失败无关，未在本次改动。
- Node 26 的实验性 `localStorage` 全局会遮蔽 vitest jsdom 环境，导致部分 UI 测试失败；
  仓库固定 Node 24，验证统一用 Node 24。
