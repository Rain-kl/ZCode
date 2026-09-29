# offpeak-removal 决策与踩坑记录

日期：2026-09-29
关联：`docs/features/offpeak-removal/design.md`、`docs/features/offpeak-removal/implementation.md`、`FEATURES.md` 的 `offpeak-removal` 条目

## 1. 为什么是「掐入口 + 留死代码」

闲时任务（off-peak）要云端取号服务 + 账号上的 Coding Plan 连接。本 fork 正在去云账号与 Coding Plan
（`local-mode`），用户只用自定义服务提供商，所以这个功能**永远不会成功**，却仍然：

- 出现在**每一次模型请求**里——只要宿主下发的 `offPeakToolEnabled` 灰度开关为真，`OffPeakCreate` /
  `OffPeakList` 就会注册进工具面（实测本机会话的 156 个工具里就有它们），带描述 + 每个 8 条模型指令 + JSON Schema；
- 给模型一个必然失败的入口（调了只会拿到「没有可用连接 / 服务不可达」）。

权衡过的三条路：

1. **全量删除**（6 个包 50+ 文件：UI 自动化页面与闲时编辑/历史视图、服务层 RPC 与仓库、桌面调度器的
   领号/派发/结算、shared 协议 schema 与遥测字段、CLI 运行时）：把协议 schema 与整个 UI 卷进来，回归风险与
   上游冲突面都大，且与 local-mode 的批次边界混在一起。**否**。
2. **只加开关（默认关）**：留下「能被重新打开的门」，且灰度开关本身来自云端——正是要摆脱的东西。**否**。
3. **掐入口、留死代码**（采纳）：工具面 + 创建路径两处撤掉，其余不可达。与本仓库对上游能力一贯的
   「入口屏蔽，不删除代码」一致（local-mode 原文）。

## 2. 三个入口为什么是这三个

判断「模型是否还看得见 / 还能不能用」只需看两件事：工具面有没有它、执行路径还能不能跑通。

- **工具注册表**（`handlers/index.ts` 的 `builtInTools`）是工具面的唯一入口，改这里与云端开关无关。
- **运行时装配**（`runtime-tools.ts` 的 `includeOffPeak`）原先按「端口在场」推导曝光，撤掉后协议侧开关失去下游。
- **协议宿主**（`server-operations.ts`）是唯一的端口注入点——撤掉它，创建路径整体不可达。

其余一切（handler、contracts schema、端口类型与透传、协议字段、UI、服务层、桌面调度器、运行时闲时轮判定）
都在这三点下游，保留即死代码。

## 3. 踩坑

### 3.1 守卫规则首版抓不到真正的回归形态

`absentPatternsInFile` 的第一版对工具注册表写的是 `/OffPeak/`（大写开头）。而真实的回归形态是上游把
`import { offPeakCreateToolEntry, offPeakListToolEntry } from "./off-peak.js";` 与数组条目合回来——**小写开头**，
`/OffPeak/` 一条都抓不到。负面实测（把三处入口加回去）立刻暴露：三条规则只中了两条。

修法：`/offPeak|OffPeak|OFF_PEAK/`，覆盖三种真实拼写（小写开头标识符、大写开头类型与字符串字面量、常量），
并**故意不匹配** `offpeak-removal`（本功能 id）与 `off-peak.js`（保留为死代码的文件名）——否则规则会命中自己的
FORK 标记而永远报错。这正复现了 `check-fork-removals.mjs` 里已记录过的教训：规则与真实形态分叉就是这类守卫
最危险的失效方式，所以每条新规则都要用「把东西加回去」的负面实测验一遍。

因此本次也顺手把 FORK 注释里被禁的标识符改写成中文表述（「闲时工具 / off-peak」），让「扫这个文件能不能
确认移除没被回滚」变成一条 grep 就能回答的问题；单测里的源码级不变量也是同口径。

### 3.2 规则表撑爆 max-lines

新增一个功能条目后 `scripts/check-fork-removals.mjs` 达到 428 行（仓库 `max-lines(400)` 是 error），lint 直接红。
拆成 `scripts/fork-removal-rules.mjs`（数据）+ `scripts/check-fork-removals.mjs`（扫描器），两者职责本来就不同。
拆完必须把规则表加进扫描器的 `IGNORED_FILES`——它以字面量写着被移除的符号名，不排除就会命中自己。

## 4. 与之前那次发现的衔接

上一轮定位到「`offPeakTurn` 到不了 handler」（`batch-runner` 白名单重建漏传），当时判断会影响闲时轮的后台命令
与递归创建防护。本次把整个功能停用后，那个缺陷**已经不可达**（没有任何一轮会被判定为闲时轮），因此不再单独修，
仅作为上游问题记录在 `docs/features/webfetch-direct-passthrough/implementation.md` §5 的同类发现里。

## 5. 验证

- 单测 5 例：默认装配、全开关打开、provider 契约、两个源码级不变量；`pnpm test:unit` 全通过。
- 守卫：三处入口的存在性 + 撤回模拟（把三处加回去 → 守卫报 3 处违规、单测红；恢复后字节一致）。
- `pnpm --dir apps/zcode-cli typecheck` 27/27；`pnpm lint` 0 error；`pnpm architecture:check` 0 违规。
- **未做**：真机复验（需新 bundle 起进程）。信号是模型请求的 `tools` 里不再出现这两个工具。
