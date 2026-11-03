# Release 单测分片失败修复

日期：2026-11-03（Asia/Singapore）
设计：[桌面端发布流水线](../../../docs/specs/desktop-release.md#独立单测分片的构建前置条件)。

## 已确认的失败与修复

- [run 41560008767](https://github.com/Rain-kl/ZCode/actions/runs/41560008767) 使用提交
  `478f3541f0897655ff7539ce0d0e28241fdab437`。Windows、macOS arm64、Source Server 构建和
  workspace gates 均成功；单测分片 1、2、4 失败，publish 被门禁阻止。
- 三个分片分别在加载 reporting lifecycle、error classification、skipped summary 测试时，
  无法解析 `@zcode/e2e-report`。公开包入口指向 `dist-node/node/index.js`，而独立 runner
  未构建该包。verify 的 typecheck 产物不能跨作业共享。各分片增加 `build:node` 前置步骤，
  不额外构建 Viewer，不跳过测试或改为深层源码导入。
- 分片 4 的 `toolPresentationParity.test.ts` 还在断言旧 `Agent` 的 researcher 摘要；
  六工具迁移已删除该专属展示。更新 fixture 为 `spawn_agent` 的 `task_name/message`，
  保持 App 与分享渲染一致性的原断言，不恢复旧工具兼容，也不修改产品运行逻辑。
- 本次是 CI 和测试合同修复，无新增产品能力，不登记 FEATURES 或产品 FORK 标记。

## RED → GREEN 与验证

- 修改前执行原 parity 用例，复现 Actions 中的 `matches App Agent summary` 失败，5 通过、1 失败。
- 先更新发布 spec，再增加报告包构建前置断言；旧 workflow 精确报出缺少
  `pnpm --filter @zcode/e2e-report build:node`，3 通过、1 失败，然后修改 workflow。
- 空临时包保留真实 package.json、没有输出时，公共包导入报 `ERR_MODULE_NOT_FOUND`。
  使用实际 `build:node` 脚本将产物构建到该空目录后，公共包导入及 viewer URL 参数断言通过。
  临时目录已清理，没有移动或删除工作区已有 dist。
- workflow、分片集合与 Source Server 契约：18/18 通过；分片仅做发现，2047 个 project/files
  在四片中不重复、不遗漏，没有运行全量单测。
- `pnpm --filter @zcode/e2e-report build:node`：通过。
- parity 与三个 Actions 失败的 reporting 测试：4 文件、15/15 用例通过。
- `pnpm typecheck`：通过；`pnpm lint`：通过，102 warning、0 error。
- `pnpm architecture:check --changed`、`pnpm fork:check-removals` 和本次文件格式检查：通过。
- 未推送、未重跑 Actions、未发布 Release。旧 run 的红态不会因本地修复改变；
  需要修复提交进入远程后才可确认真实 CI 结果。

实施文件：`.github/workflows/release.yml`、`scripts/test/release-workflow.test.mjs`、
`packages/ui/test/toolPresentationParity.test.ts`、`docs/specs/desktop-release.md`。
