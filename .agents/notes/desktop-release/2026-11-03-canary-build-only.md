# Canary build-only release policy

日期：2026-11-03

## 背景

run `41617480162` 的 Unit tests (3/4) 在 `pnpm install` 的 hoisted linker 阶段失败：

- `ERR_PNPM_ENOENT`
- rename `node_modules/react-scan/node_modules/_tmp_*` 到 `esbuild`

原重试保留半成品 `node_modules`，三次重试重复同一链接错误，最终阻断发布。

## 决策

- canary/dev 集成只要求 `resolve` 与 macOS、Windows、Source Server 三类构建成功，更新 `canary-build` 指针。
- canary 跳过 `verify` 与 `unit-tests`，不把静态检查或测试作为集成发布前置。
- 正式 `v*.*.*` tag 必须同时通过 `verify` 与 `unit-tests`；任一门禁失败、跳过或取消都不得发布。
- `publish` 使用显式条件：dev 看三类构建，stable 额外看两类测试门禁。
- 所有 pnpm 安装重试在第二次及以后追加 `--force`，避免复用损坏的 hoisted link 状态。

## 验证

- `node --test scripts/test/release-workflow.test.mjs scripts/test/release-sharding.test.mjs scripts/test/source-server-release.test.mjs`
- 24/24 通过，覆盖 canary 跳过测试、stable 失败关闭、`--force` 重试和四片测试完整性。
