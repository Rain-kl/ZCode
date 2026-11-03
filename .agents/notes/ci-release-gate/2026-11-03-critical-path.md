# 发布关键路径优化

日期：2026-11-03（Asia/Singapore）
设计：[桌面端发布流水线](../../../docs/specs/desktop-release.md#2026-11-03-发布关键路径优化二开基础设施)。

## 证据与决策

- run 41413444449 共 30m13s：verify 14m42s、Windows 14m32s；另一个 44m02s 的
  run 40059109475 包含约 13m46s 并发组等待，不能把等待都算成编译耗时。
- 原图 `resolve -> verify -> builds -> publish` 让完整单测与跨平台打包串行相加。
  改为 resolve 后并行 verify、四个单测分片、macOS、Windows、Source Server；publish 直接汇合全部门禁。
  门禁失败时可以浪费构建 runner 时间，但不能创建 Server 或 Desktop Release。
- 复用 Vitest 官方 shard，不新增文件分配器、第二份测试清单或配置。每片保留原隔离池与并发数，
  依赖进程树/cwd/umask 的串行用例不在同一个 runner 上并发运行。
- 本地 Vitest 4.1.4 的 `list --filesOnly --shard=...` **不应用分片**，四次返回完整集合。
  最初的集合契约因此准确报出重复，未把它误当作分片成功。最终契约使用公开 `createVitest` API
  发现真实项目配置，并调用执行池使用的配置 sequencer；校验并集相等、无交集、保留三个项目与串行限制。
  升级若改变公开 API、分片选择或项目隔离默认值，该契约会失败，而非跳过或回退。
- bundle 先 prepare 再调用 build，而 build 又 prepare。日志显示 Windows 第二次 Agent 构建约 125s，
  macOS 约 70s。由 bundle 调度一次 prepare 后调用已有 `build:no-runtime-assets`；直接 build 的契约不变。
  `--skip-prepare` 现在不会被嵌套 build 抵消，两个 skip 标志四种组合都有回归断言。
- 暂不合并 ASAR 两轮重写，也不取消同 ref 的在途发布，不改变签名、安装包/更新元数据、归档校验或发布顺序。
  这两项需要更大范围的产物验证，不能和依赖图优化一起冒险。

本次属于 CI / 构建工具链改动，不登记产品 FEATURES，也不添加产品 FORK 标记。

## 验证

- 先更新 spec，再写回归：旧 workflow 对并行图/完整发布依赖断言失败；旧 bundle 的四个调度断言失败。
- 发布依赖、分片覆盖、Source Server 契约：18/18 通过。
- 四片真实执行定向回归（bundle prepare、mirror、production build、ASAR repack、串行 CDN preload）：
  5 文件共 17 用例全部通过，四片均实际执行，不是空分片或 passWithNoTests。
- 根 Vitest 的完整选择只做发现与分片集合校验，不执行全量测试；没有擅自运行全量 test:unit。
- `pnpm typecheck`：通过。`pnpm lint`：通过，102 个既有 warning、0 error。
- `pnpm architecture:check --changed`：最终通过、0 violation。开工检查曾在既有施工文件
  `apps/zcode-cli/packages/bootstrap/src/app/subagent-observation.ts` 报 unmanaged-new-file；
  本次未修改该文件或 architecture-policy，最终工作区检查已通过。
- `pnpm fork:check-removals`：通过。
- 尚未推送、触发 Actions、生成真实 Windows/macOS 安装包或发布 Release。
  12–16 分钟仅为无排队且 runner 额度充足时的目标，需要后续 2–3 轮 Actions 实测，不能声称已达成。

实施文件：`.github/workflows/release.yml`、`packages/desktop/scripts/bundle.mjs`、
`packages/desktop/test/bundlePreparation.test.ts`、`scripts/test/release-workflow.test.mjs`、
`scripts/test/release-sharding.test.mjs`、`scripts/test/source-server-release.test.mjs`。
