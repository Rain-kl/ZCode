# 2026-11-04 Source Server canary 发布收口

## 决策

- Desktop 与 Source Server 共享提交版本计算，但各自拥有独立 workflow、并发组和发布写入者。
- Source Server dev 使用固定 `server-canary-build`；正式版继续使用不可变 `server-v<version>`。
- Desktop `canary-build` 和 Server `server-canary-build` 每次重新公开固定 tag 的 Release。原因是 GitHub 没有 prerelease 置顶能力，单纯 edit 或覆盖资产不会刷新 Release 在列表中的创建/发布时间顺序。
- dev descriptor 仍声明完整 `<version>-dev.<sha8>`，并作为实际安装版本。开发通道只校验双方都是 dev，不比较提交哈希；正式通道继续严格要求版本相等。

## 发布顺序

1. Server workflow 解析版本并优先尝试复用同一版本的当前 Release。
2. 新版本构建四个平台包，校验 descriptor、归档内容和 Linux x64 入口。
3. dev 删除旧固定 Release 但保留 tag，以 draft 重建、上传、公开，再清理历史 `server-v*-dev.*` Release/tag。
4. stable 继续复用或创建不可变版本 Release；已公开同版本内容发生变化时拒绝覆盖。

Desktop workflow 不再包含 Server job 或 Server 发布步骤。两个 workflow 在同一 canary push 上并行启动，互不占用 concurrency group。
dev 安装脚本直接读取 Server descriptor，不再等待 Desktop `canary-build/dev.yml`；否则 Server 先发布时会因为两个独立指针短暂不同步而安装失败。

## 验证

- 发布/依赖图/清理合同：`node --test scripts/test/release-workflow.test.mjs scripts/test/source-server-release.test.mjs`
- 安装脚本：`node --test scripts/test/server-installer.test.mjs`
- Desktop 下载根：`pnpm exec tsx --test packages/desktop/test/forkGithubUpdateFeed.test.ts`
