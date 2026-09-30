# 覆盖设置热重载：/reload 命令（reload-command）——实现记录

> 设计见 `design.md`；功能索引见 `FEATURES.md` 的 `reload-command` 条目。
> 上游接线一律标注 `FORK(reload-command)`。

## 1. 落地位置

| 文件 | 职责 |
| --- | --- |
| `apps/zcode-cli/packages/core/src/fork/tool-modes/file-port.ts` | 档位**单点解析**：读 `tool-groups.json` → 三档工具名 → 与宿主名单交集。`toolAllowlist` 是**终值**语义（标准档 = 宿主名单本身，可能 undefined），创建期与 `/reload` 共用；绝不抛出，读不动给诊断 |
| `apps/zcode-cli/packages/core/src/runtime/methods/reload.ts` | `reloadForkOverrides`（实质动作：重读两端口 → 工具差量 → 清缓存 → `rebuildContextPrefix` → 日志）与 `executeForkReload`（kind=`reload` 的维护轮，形状照抄 `executeManualCompact`） |
| `apps/zcode-cli/packages/core/src/runtime/methods/mcp.ts` | 新增 `refreshForkMcpToolRegistrations`（注销上次注册名 → 按启动期描述符快照重新过滤，不重连）；`initializeMcp` 现在留存描述符与注册名单 |
| `apps/zcode-cli/packages/core/src/runtime/helpers/runtime-tools.ts` | 留存 `reregisterBuiltInTools` 闭包（完整选项集 + silent 重注册） |
| `apps/zcode-cli/packages/core/src/runtime/helpers/commands.ts` | `parseReloadCommand`（只接受整条 `/reload`） |
| `apps/zcode-cli/packages/core/src/runtime/methods/turn.ts` | 分流：命中 `/reload` → `executeForkReload`（空闲派发与队列排空同一入口） |
| `apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/commands/handlers/reload.ts` | v4 原生命令：空闲 `submitPrompt("/reload")`；忙碌与 compact 一致入 FIFO（`commandKind: "reload"`） |
| `packages/ui/src/v4/slashCommands.ts`、`SessionPane.tsx` | `/` 菜单解析 `kind: "reload"`、派发信封、成功/排队/失败 toast、队列项不参与 Composer 回填 |
| `packages/ui/src/v4/pendingCommand{Registry,Replay}.ts` | `reload` 与 compact 同为可回放输入命令（刷新后仍有重放线索） |
| `packages/shared/src/zcode-protocol-v4/{command,input-intent}.ts` 等 | 命令信封 `reload`（空 payload）、intent kind、steer kind、`activeTurnKind`、内置帮助目录 |
| 删除 | `apps/zcode-cli/packages/bootstrap/src/fork/tool-modes.ts` 与 `bootstrap/test/forkToolMode.test.ts`（逻辑与用例迁入 core 端口） |

## 2. 关键改动

- **创建期与重载单点化**：原 `bootstrap` 的一次性 `resolveForkToolMode` 迁入 core 的 `createFileForkToolModePort`，`create-app` 创建端口 → 解析 → 注入 runtime deps；`/reload` 经同一端口重读。端口返回**终值**（标准档 = 宿主名单本身），否则 `/reload` 从极简切回标准会把宿主约束一并丢掉。
- **执行路径唯一**：空闲时 v4 handler `submitPrompt("/reload")`，队列排空时 `executeTurnCommand("/reload")`，两条都落到 `turn.ts` 的 `parseReloadCommand` 分流 → `executeForkReload`。维护轮 `TurnStarted` 标 `inputVisibility: "model-only"`（不渲染用户气泡、模型也读不到 `/reload` 文本），`TurnComplete` 空 response。
- **工具面差量**：内置先按 `resolveBuiltInToolAllowlist(config)` 显式注销被排除项（注册表不会回收旧项），再走**完整选项集的整体重注册**（含 embedded-search 联动与 deps 侧的门；不能复用分支刷新的精简集，它省略了 `includeNodeRepl` 等门）。MCP 注销上次注册名后按启动快照重新过滤（不重连；服务器配置变更仍需新会话）。`cachedTools` 清空后 `rebuildContextPrefix` 重建前缀——顺序有约束：builder 的 `guidanceToolNames` 从当前注册表取。
- **缓存语义**：`/reload` 是「前缀在会话内不可变」的显式例外，一次性前缀失效是目的；设置无变化时重建结果逐字节相同，缓存不失效。
- **回执（v1 边界）**：toast 三种（已重载 / 已排队 / 失败），复用 compact 通道；不做转录内持久标记（新增 row 类型要动 rows/投影/hydration/渲染四处，见 design 第 2 节）。
- **让位与短路**：`subagent_child` 运行时不承接（`reloadForkOverrides` 直接返回 `skipped`）；workflow actor / `customSystemPrompt` 沿用 builder 既有让位规则。
- **kind 扩展**：`"reload"` 进入 steer/intent/activeTurn 四个联合类型与两处 zod schema；`steering.ts` 的两处 inline-guide 排除同步加上（控制命令不得被当作 guide 消费）。

## 3. 上游接线点

共 27 个上游文件、43 行 `FORK(reload-command)` 标记（口径见 FEATURES 条目）。分布：
core 运行时 10 文件（`runtime/{types,internal,internal-turn-methods,agent-runtime}.ts`、`methods/{turn,steering,index,mcp}.ts`、`helpers/{commands,runtime-tools}.ts`）、
bootstrap 4 文件（`app/{create-app,types}.ts`、`slash-command-surface.ts`、`v4 handlers/index.ts`）、
contracts 1、shared 6、ui 6（`v4/{slashCommands,SessionPane,pendingCommandRegistry,pendingCommandReplay}.ts` + 两个 locale）。

## 4. 验证记录

- `pnpm exec tsx --test apps/zcode-cli/packages/core/test/forkToolModePort.test.ts` → 8/8
- `pnpm exec tsx --test apps/zcode-cli/packages/core/test/forkReload.test.ts` → 7/7（轻量假运行时：端口与注册表用真实实现；覆盖 极简↔标准双向、注入关闭清空、坏文件诊断回退、身份重读+诊断、子代理短路）
- `pnpm exec tsx --test ...forkToolModeTools.test.ts`（回归）→ 2/2；三条合计 17/17
- `pnpm typecheck`（根，含 ui/shared/desktop host）→ exit 0；`pnpm --dir apps/zcode-cli typecheck` → 27/27
- `pnpm lint` → 0 errors（71 条 warning 均为存量，与本次改动无关）
- `pnpm architecture:check --changed` → OK，0 violations

## 5. 未验证项与验证方法

| 项 | 原因 | 验证方法 |
| --- | --- | --- |
| `executeForkReload` 的 turn 边界（TurnStarted/Complete、投影） | 需要完整 runtime 装配，超出单测成本；形状照抄 `executeManualCompact` | 运行实例：执行 `/reload` 后查 `fork.reload.started/completed` 与 `fork.reload.turn.completed` 日志，UI 无用户气泡 |
| MCP 工具面差量的真实重注册 | 单测里 MCP 端口缺席（`mcpRegistered` 为空） | 运行实例：标准→极简→标准 各执行一次 `/reload`，对比 MCP 工具在注册表/请求里的出现与消失（`mcp.tools.refreshed` 日志） |
| 排队路径（忙碌时 `/reload` → 回合结束执行） | 需要真实 busy 会话 | 运行实例：任务运行中发送 `/reload`，观察「已排队」toast 与随后日志 |
| 请求前缀的实际变化（含缓存） | 需要抓包 | 运行实例：改设置 → `/reload` → 抓下一轮请求对比 system prompt 与 tools 列表 |

## 6. 与设计的偏差

- 无功能偏差。实现补充了两条设计未写的细节：①内置重注册传 `silentDuplicateWarnings`（覆盖式重注册否则每次刷屏）；②`resolveQueuedComposerRestore` 同步排除 `reload` 队列项（与 compact 一致，否则会回填进 Composer 当文本重发）。
