# 移除闲时任务入口 — 实现文档

设计（规则、边界、验收场景）见 `design.md`。

## 1. 落地位置

| 角色                                | 文件                                                                                                                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工具面缺席不变量 + 源码级不变量单测 | `apps/zcode-cli/packages/core/test/forkOffPeakRemoval.test.ts`（5 例）                                                                                                                       |
| 移除守卫规则                        | `scripts/fork-removal-rules.mjs` 的 `offpeak-removal` 条目（新增 `absentPatternsInFile` 规则类型；规则表本次从扫描器 `scripts/check-fork-removals.mjs` 拆出，否则撞上仓库 `max-lines(400)`） |

改动前的工作面（`rg -n "FORK\(offpeak-removal\)"`，3 个文件、7 处）：

| 位置                                                      | 改法                                                  | 为什么必须改上游                                           |
| --------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| `core/src/tool/handlers/index.ts` · import                | 不再 import 两个闲时条目                              | 注册表的唯一入口                                           |
| `core/src/tool/handlers/index.ts` · `builtInTools`        | 两个条目从数组移除                                    | 数组即工具面；留在数组里就会进入 provider 契约             |
| `core/src/tool/handlers/index.ts` · 选项类型              | 删除 `includeOffPeak`                                 | 条目已不在数组，开关只是假门                               |
| `core/src/tool/handlers/index.ts` · 注册过滤              | 删除按开关跳过两工具的分支                            | 同上                                                       |
| `core/src/runtime/helpers/runtime-tools.ts` · 装配        | 删除 `includeOffPeak: Boolean(deps.offPeakPort) …`    | 该行是「端口在场即暴露」的推导，撤掉后协议侧开关不再有下游 |
| `bootstrap/…/server-operations.ts` · import               | 不再引入端口工厂                                      | 端口不再需要                                               |
| `bootstrap/…/server-operations.ts` · session runtime 装配 | 删除按 `offPeakToolEnabled` 注入 `offPeakPort` 的分支 | 创建路径必须整体不可达                                     |

## 2. 上游收敛（同步后如何处理）

本功能是**纯移除**，没有我们自己的实现需要保留，所以恢复也简单：

1. 若上游把闲时任务改成默认关闭、或自己删掉了这套功能：整体退场——把上面 7 处按上游版本接受回去，
   删掉 `forkOffPeakRemoval.test.ts` 与 `fork-removal-rules.mjs` 的 `offpeak-removal` 条目，
   在 FEATURES.md 记录「上游已移除」。
2. 若上游继续演进该功能（新增第三个闲时工具、改开关名）：**保持移除**，同步时按守卫与单测的报错逐处取舍——
   守卫会指出是哪一处接线被合回来了（含具体的工具面/端口注入），不会静默通过。

`absentPatternsInFile` 是本功能新增的规则类型：`absentPatterns` 是全局缺席，用不了「代码保留为死代码」的场景
（被移除符号的名字仍写在死代码文件里）。它按路径断言，并在文件读不到时按违规上报（上游重命名该文件时宁可让人看一眼）。

## 3. 保留为死代码的清单（本次不动）

- `core/src/tool/handlers/off-peak.ts`（handler 与工具条目定义）：无注册路径引用。
- `core/src/tool/types.ts`、`core/src/tool/executor/{types,call-runner,impl}.ts`、`core/src/runtime/types.ts`、
  `core/src/runtime/helpers/runtime-tools.ts` 里的 `offPeakPort` 透传：宿主不再注入，值恒为 `undefined`。
- contracts 里的闲时输入/输出 schema、`offPeakCreateToolEntry` 引用的 provider 原生声明。
- 协议字段 `offPeakTaskId` / `offPeakRunType` / `offPeakToolEnabled` 与 `off-peak-tool-policy.ts`：
  云端派发/开关的入口，本 fork 不接云账号；老宿主下发开关现在是空操作，字段仍能被解析（不报未知字段）。
- 运行时闲时轮身份与 denylist（`turn-loop-state.ts` / `turn-loop.ts` / `turn-tools.ts` / `streaming-tool-coordinator.ts`）：
  判定的对象不会再出现；已核对与 automation 轮身份互斥，保留不影响正常轮与定时任务轮。
- UI、服务层、桌面调度器：见设计文档「保留部分的现状」表（UI 的创建入口本就受云端灰度 + Coding Plan 资格双重门控）。

## 4. 验证记录

| 项                                                                    | 命令/方法                                                     | 结果                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 单测 5 例（默认装配 / 全开关打开 / provider 契约 / 两个源码级不变量） | `pnpm test:unit`                                              | 通过                                                                                                    |
| 守卫规则是否真的会红                                                  | 模拟「上游整段覆盖」把三处入口加回后重跑                      | 守卫报 3 处违规、单测文件红；恢复后三文件字节一致（shasum 校验）                                        |
| 守卫规则初版的漏网                                                    | 首版用 `/OffPeak/`，抓不到小写开头的 `offPeakCreateToolEntry` | 已改为 `/offPeak\|OffPeak\|OFF_PEAK/`（覆盖三种真实拼写，且不误匹配 `offpeak-removal` / `off-peak.js`） |
| 类型检查                                                              | `pnpm --dir apps/zcode-cli typecheck`                         | 通过（27/27）                                                                                           |
| 未做                                                                  | 真机工具列表复验（需新 bundle 起进程）                        | 待补：新会话的模型请求 `tools` 里不应再出现这两个工具                                                   |
