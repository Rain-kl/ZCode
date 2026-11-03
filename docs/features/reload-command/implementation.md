# 覆盖设置热重载：/refresh 命令（reload-command）——实现记录

> 设计见 `design.md`；功能索引见 `FEATURES.md` 的 `reload-command` 条目。
> 上游接线一律标注 `FORK(reload-command)`。

## 1. 落地位置

| 文件 | 职责 |
| --- | --- |
| `apps/zcode-cli/packages/core/src/fork/tool-modes/file-port.ts` | 档位**单点解析**：读 `tool-groups.json` → 三档工具名 → 与宿主名单交集。`toolAllowlist` 是**终值**语义（标准档 = 宿主名单本身，可能 undefined），创建期与 `/refresh` 共用；绝不抛出，读不动给诊断 |
| `apps/zcode-cli/packages/core/src/runtime/methods/reload.ts` | `reloadForkOverrides`（实质动作：重读两端口 → 工具差量 → 清缓存 → `rebuildContextPrefix` → 日志）与 `executeForkReload`（kind=`reload` 的维护轮，形状照抄 `executeManualCompact`） |
| `apps/zcode-cli/packages/core/src/runtime/methods/mcp.ts` | 新增 `refreshForkMcpToolRegistrations`（注销上次注册名 → 按启动期描述符快照重新过滤，不重连）；`initializeMcp` 现在留存描述符与注册名单 |
| `apps/zcode-cli/packages/core/src/runtime/helpers/runtime-tools.ts` | 留存 `reregisterBuiltInTools` 闭包（完整选项集 + silent 重注册） |
| `apps/zcode-cli/packages/core/src/runtime/helpers/commands.ts` | `parseRefreshCommand`（只接受整条 `/refresh`） |
| `apps/zcode-cli/packages/core/src/runtime/methods/turn.ts` | 分流：命中 `/refresh` → `executeForkReload`（空闲派发与队列排空同一入口） |
| `apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/commands/handlers/reload.ts` | v4 原生命令：空闲 `submitPrompt("/refresh")`；忙碌与 compact 一致入 FIFO（`commandKind: "refresh"`） |
| `packages/ui/src/v4/slashCommands.ts`、`SessionPane.tsx` | `/` 菜单解析 `kind: "refresh"`、派发信封、排队/失败 toast、队列项不参与 Composer 回填；成功回执由转录标记承担 |
| 事件与投影链 | `contracts` 新增 `ForkReloadCompleted` 事件（payload 带 `sourceCommandId`）→ `product-projection` 落 `timelineMarker`（`reload` 型）→ `rows.ts` schema → `ConversationRowView` 灰字分隔线（「已重载提示词与工具面」，刷新图标）；分享面（公开投影 + 只读时间线）同步透出 |
| `packages/ui/src/v4/pendingCommand{Registry,Replay}.ts` | `refresh` 与 compact 同为可回放输入命令（刷新后仍有重放线索） |
| `packages/shared/src/zcode-protocol-v4/{command,input-intent}.ts` 等 | 命令信封 `refresh`（空 payload）、intent kind、steer kind、`activeTurnKind`、内置帮助目录 |
| 删除 | `apps/zcode-cli/packages/bootstrap/src/fork/tool-modes.ts` 与 `bootstrap/test/forkToolMode.test.ts`（逻辑与用例迁入 core 端口） |

## 2. 关键改动

- **创建期与重载单点化**：原 `bootstrap` 的一次性 `resolveForkToolMode` 迁入 core 的 `createFileForkToolModePort`，`create-app` 创建端口 → 解析 → 注入 runtime deps；`/refresh` 经同一端口重读。端口返回**终值**（标准档 = 宿主名单本身），否则 `/refresh` 从极简切回标准会把宿主约束一并丢掉。
- **执行路径唯一**：空闲时 v4 handler `submitPrompt("/refresh")`，队列排空时 `executeTurnCommand("/refresh")`，两条都落到 `turn.ts` 的 `parseRefreshCommand` 分流 → `executeForkReload`。维护轮 `TurnStarted` 标 `inputVisibility: "model-only"` + `executionKind: "controlOnly"`（不渲染用户气泡、模型也读不到 `/refresh` 文本、0ms 轮不进 Agent 工时），`TurnComplete` 空 response。
- **工具面差量**：内置先按 `resolveBuiltInToolAllowlist(config)` 显式注销被排除项（注册表不会回收旧项），再走**完整选项集的整体重注册**（含 embedded-search 联动与 deps 侧的门；不能复用分支刷新的精简集，它省略了 `includeNodeRepl` 等门）。MCP 注销上次注册名后按启动快照重新过滤（不重连；服务器配置变更仍需新会话）。`cachedTools` 清空后 `rebuildContextPrefix` 重建前缀——顺序有约束：builder 的 `guidanceToolNames` 从当前注册表取。
- **缓存语义**：`/refresh` 是「前缀在会话内不可变」的显式例外，一次性前缀失效是目的；设置无变化时重建结果逐字节相同，缓存不失效。
- **回执**：成功后追加 `ForkReloadCompleted` 事件 → 投影成 `timelineMarker`（`reload` 型，lane `assistantWork`，与 `/compact` 同款分隔线），UI 灰字「已重载提示词与工具面」，带 `sourceCommandId`（pending command 据此结算，不再弹恢复提示）。排队与失败仍走 toast——成功 toast 已移除，避免双份回执。
- **让位与短路**：`subagent_child` 运行时不承接（`reloadForkOverrides` 直接返回 `skipped`）；workflow actor / `customSystemPrompt` 沿用 builder 既有让位规则。
- **kind 扩展**：新命令的 steer/intent 使用 `"refresh"`；内部 activeTurn 与持久化 marker 仍使用 `"reload"`；`steering.ts` 的两处 inline-guide 排除同步加上（控制命令不得被当作 guide 消费）。

## 3. 上游接线点

共 33 个上游文件、54 行 `FORK(reload-command)` 标记（口径见 FEATURES 条目）。分布：
core 运行时 10 文件（`runtime/{types,internal,internal-turn-methods,agent-runtime}.ts`、`methods/{turn,steering,index,mcp}.ts`、`helpers/{commands,runtime-tools}.ts`）、
bootstrap 5 文件（`app/{create-app,types}.ts`、`slash-command-surface.ts`、`v4 handlers/index.ts`、`v4 product-projection.ts`）、
contracts 2（`interfaces/session.port.ts`、`events/session.events.ts`）、
shared 7（`zcode-protocol/{index,legacy-types}.ts`、`zcode-protocol-v4/{command,input-intent,rows}.ts`、`zcode-task-types-core.ts`、`zcode-slash-command-help.ts`）、
services 1（分享公开投影）、
ui 8（`v4/{slashCommands,SessionPane,pendingCommandRegistry,pendingCommandReplay,ConversationRowView,ConversationShareReadonlyTimeline}` + 两个 locale）。

## 4. 验证记录

- `pnpm exec tsx --test apps/zcode-cli/packages/core/test/forkToolModePort.test.ts` → 8/8
- `pnpm exec tsx --test apps/zcode-cli/packages/core/test/forkReload.test.ts` → 7/7（轻量假运行时：端口与注册表用真实实现；覆盖 极简↔标准双向、注入关闭清空、坏文件诊断回退、身份重读+诊断、子代理短路）
- 两条合计 15/15；`forkToolModeTools.test.ts` 分类回归 2/2
- `pnpm typecheck`（根，含 ui/shared/desktop host）→ exit 0；`pnpm --dir apps/zcode-cli typecheck` → exit 0
- `pnpm lint` → 0 errors（71 条 warning 均为存量，与本次改动无关）
- `pnpm architecture:check --changed` → OK，0 violations

## 5. 未验证项与验证方法

| 项 | 原因 | 验证方法 |
| --- | --- | --- |
| `executeForkReload` 的 turn 边界（TurnStarted/Complete、投影） | 需要完整 runtime 装配，超出单测成本；形状照抄 `executeManualCompact` | 运行实例：执行 `/refresh` 后查 `fork.reload.started/completed` 与 `fork.reload.turn.completed` 日志，UI 无用户气泡 |
| 转录回执（marker 落位与分享面渲染） | 需要真实投影消费与 UI | 运行实例：执行 `/refresh` 后对话里出现灰字分隔线「已重载提示词与工具面」；冷恢复后仍在；分享会话里同样可见 |
| MCP 工具面差量的真实重注册 | 单测里 MCP 端口缺席（`mcpRegistered` 为空） | 运行实例：标准→极简→标准 各执行一次 `/refresh`，对比 MCP 工具在注册表/请求里的出现与消失（`mcp.tools.refreshed` 日志） |
| 排队路径（忙碌时 `/refresh` → 回合结束执行） | 需要真实 busy 会话 | 运行实例：任务运行中发送 `/refresh`，观察「已排队」toast 与随后日志 |
| 请求前缀的实际变化（含缓存） | 需要抓包 | 运行实例：改设置 → `/refresh` → 抓下一轮请求对比 system prompt 与 tools 列表 |

## 6. 与设计的偏差

- 无功能偏差。实现补充了两条设计未写的细节：①内置重注册传 `silentDuplicateWarnings`（覆盖式重注册否则每次刷屏）；②`resolveQueuedComposerRestore` 同步排除 `refresh` 队列项（与 compact 一致，否则会回填进 Composer 当文本重发）。

## 2026-11-03 命名隔离验证

- 文档先更新，再新增 `packages/shared/test/forkRefreshCommandContract.test.ts`；实现前 `/refresh` 解析断言失败（返回 null），实现后 3/3 通过。
- 新命令目录、v4 信封与排队 kind 为 `refresh`；排队和空闲文本均为 `/refresh`。内部维护轮及持久化完成回执继续使用 reload 名称，避免历史迁移。
- `architecture:check --changed`：0 violations。根 `pnpm lint`：0 errors，102 条现有 warnings。
- CLI lint 脚本已执行但受其子进程 pnpm/native binary 环境阻塞；core forkReload 测试受 contracts/dist 尚未构建阻塞，未冒称通过。shared/UI 定向 tsc 构建仍在执行；完整根/CLI typecheck 由合并阶段复验。
- 桌面/手机 E2E 未运行；验收场景：菜单仅列出 fork `/refresh`，参数/附件不拦截，忙碌排队后出现原灰字回执；上游 `/reload` 由 App 生命周期入口单独处理。

### 合并后命令隔离回归

`/reload` 是上游 App 本地生命周期操作，不经 v4 输入命令；`/refresh` 是 fork 原生维护命令。两者都必须保留为内置名，禁止用户/插件同名自定义命令接管。原生 handler 的 idle、busy FIFO、恢复失败拒绝共用现有准入，不能走 restart；参数/附件由共享 UI parser 拒绝拦截。

合并核对发现 `inputIntentMetadata` 对维护信封的 kind 投影需显式识别 refresh；否则原生排队文本为 /refresh 而持久化意图错误地成为 sendText。沿用唯一投影函数补分支，并由原生 busy-route 用例断言。

合并后回归：共享路由契约 6/6；Bootstrap 的 protocol-slash-commands、v4-native-goal-compact、v4-native-queue、product-projection 四文件共 319 测试通过，含 refresh 空闲执行、三种 busy routing、恢复失败拒绝、保留 maintenance queue kind、不可编辑以及原有 compact/goal/queue 回归。新增保留名、意图投影与队列投影断言均先红后绿。真实 Electron/手机 E2E 仍未运行。

### FRR01 桌面命令隔离候选场景（先定场景，后写 E2E）

复用上游 runtime-restart pending spec 与其显式 replay fixture，新增独立 `FRR01` 测试，避免增加原 SLR09 标题取消窗口内的动作。普通任务先完成一轮后，记录 taskId、runtime generation、用户历史与非标题模型请求；发送 `/refresh` 必须出现持久化 reload marker，generation 和用户历史不变，不产生模型请求；随后发送 `/reload` 必须保持 taskId 和历史但 generation 递增，新实例 ready 后可续发收到固定回复。该场景只验证桌面空闲路径，不声称覆盖手机、忙碌队列、MCP 真重注册或设置内容变化。候选未实跑前保持 pending/unverified。

FRR01 验证记录：fixture check 通过（3 条原有 marker warnings，无新 warning）；`pnpm --filter @zcode/desktop typecheck:e2e` 通过。显式 replay 已启动，但 `onPrepare` 构建被尚未裁决的 `packages/desktop/src/main/autoUpdater.ts:9` 冲突标记阻断，Electron 未启动，FRR01 UI 断言均未执行，不能记为 covered。失败 artifact：`packages/desktop/.e2e-artifacts/desktop-e2e-20261103025739158-p29873-bcc8b03a98ec4dcd`；测试 HOME 显式隔离为 `/tmp/zcode-refresh-e2e-20261103-refresh-agent`，未操作生产数据。

复验（独立 worktree 根目录）：

```bash
ZCODE_E2E_MANUAL_REVIEW=1 ZCODE_E2E_MOCHA_GREP=FRR01 \
ZCODE_E2E_HOME_DIR=/tmp/zcode-refresh-e2e-20261103-refresh-agent \
E2E_PROVIDER_REPLAY_FIXTURE_PATH=packages/desktop/test/e2e/fixtures/upstream/common.json,packages/desktop/test/e2e/fixtures/upstream/conversation-session/conversation-session-runtime-restart.json \
mise exec -- sh -c 'export PATH=/Users/ryan/.local/bin:$PATH; pnpm --filter @zcode/desktop test:e2e -- --spec ./test/e2e/conversation-session/manual-review/pending/conversation-session-runtime-restart.test.ts'
```

本机嵌套脚本需以上述 PATH 使用已固定的 pnpm 10.33.2；否则 Node 的 Corepack 会调用 pnpm 12.16.1 而在 pretest 阶段拒绝执行。此为执行环境调整，不修改仓库包管理器版本。

### 2026-11-03：上游公告迁移后的维护协调

根因：上游环境/模型/Git/日期/skills 迁入持久化公告历史，`rebuildContextPrefix` 只替换 system
prefix；`/refresh` 若仅重建 prefix，已关闭的动态注入和已移除 Skill 工具的清单仍被模型读取。

修复：`reloadForkOverrides` 在工具面定型与 prefix 重建后复用
`refreshRestoredAnnouncements`，skills/指令按当前 builder 原位替换或移除；身份关闭动态注入时
只移除明确来源的环境/模型/output-style/Git/日期 attachment。请求路径 output-style reminder
也遵守同一 gate，避免撤回后又自动补回。主会话身份开关不影响子 runtime 自己的身份与公告。

边界：只协调模型的内存历史；持久化的原始提醒、真实对话及工具记录不删不改，AGENTS.md 与
memory 索引保留。冷恢复使用既有同一 owner 套用当前设置。无法识别为 attachment 的旧文本不靠
正文猜测删除。恢复注入后由上游正常公告收集再次生成，无变化维护不改写公告字节。

验证（离线真实 runtime，多轮模型 stub）：先红后绿覆盖动态/skills 关闭、缩档移除 Skill、
再启用重发、维护轮零模型调用、持久化原记录不改、AGENTS/真实消息保留及无变化 history 字节不变。
另加父身份开关不影响 child 日期的回归；具体验证结果随本次同步记录。

### FRR01 实跑发现与批准修复

第二次显式回放 artifact `packages/desktop/.e2e-artifacts/desktop-e2e-20261103031823602-p48729-dc7145ddf033a267` 已启动真实 macOS Electron。refresh marker出现、generation不变、taskId/用户历史不变、零模型请求均通过；reload代次递增并保留taskId/历史也通过，但重启后 marker 数0（应1）失败，最终续发断言未执行。日志确认 `fork_reload_completed` seq18 仅写内存；新实例 cold hydrate `sourceEventSeq=0 synthesized=true` 无该事实。用户批准复用独立 transcript timeline message/part 修复，不另建 entry账本；保持 E2E 原断言。

### 独立 transcript 完成回执落地与验收

- contracts 新增 `ForkRefreshCompletedTimelinePart`，沿用既有 `TimelinePart` 公开入口；存储层通用 message/part JSON 往返，不加表、不加 entry 类型。legacy 严格 message schema 与 mapper 显式保留 subtype、completionEventId 和可缺省 sourceCommandId。
- core `events.ts` 在该完成事件进入内存/通知 sinks 之前调用上游 `persistAssistantTimelinePartForSession`：以 event.id 派生稳定 message/part ID，独立 provider-hidden timeline carrier。消息或 part 写失败沿原错误路径抛出，不在内存留成功事实。相同事实重写仅 upsert 同一 carrier/part。
- bootstrap 新受管 `fork/reload-command` 纯读取模块只验证并识别该 subtype；transcript hydration 在物理 message 边界消费，不打开模型轮或 Agent 工时。cold merge 按 completion eventId 压掉 live 重复，并沿 active branch 的独立 carrier 裁剪旧分支事实及其已终态 controlOnly 维护轮壳，不恢复第二份账本。live 同 event 重放按既有行 entityId 去重，不添加副本状态。
- fork 沿现有 message/part prefix clone：child 本地 message/part ID 重映射，completionEventId 保留来源；它仅在同 session 的 live/cold 去重中比较，不当作跨任务写入主键。真实 SQLite fork 回归确认只复制选中前缀内 marker。

验证先红后绿：真实 SQLite 原先0个持久消息，现刷新首命令1个独立timeline；冷恢复原先缺 marker，新增回归覆盖多 marker物理顺序/根 marker/legacy缺sourceCommandId/同事实live+cold去重/完整control三联无空轮/同anchor rewind裁剪（含旧live三联）/严格非法时间及空sourceCommandId。core真实写失败用例确认 eventStore及sinks均无成功事件；orphan timeline空宿主不合成空工作轮。

真实 E2E 修复后 FRR01 **1/1 通过**：`packages/desktop/.e2e-artifacts/desktop-e2e-20261103034836677-p75939-160e432e8a8fcc16`，macOS Electron、真实Host/CLI，显式 replay和隔离HOME，无生产数据操作。包括refresh零模型请求/不换代、reload新实例保留用户历史和完成marker、以及续发新回复。保持原断言，没有放宽；只执行FRR01，其他SLR/手机/忙碌队列不因此宣称通过。该实跑之后按独立review又补了removed-branch完整维护三联裁剪及空sourceCommandId严格拒绝的单测红绿，未重跑相同idle E2E，也不声称该artifact覆盖rewind交互。

离线最终检查：core 新功能+runtime-persistence 2文件73/73；bootstrap timeline/hydration/cold merge/mapper/product projection 5文件358/358；contracts/core构建与bootstrap tsc通过；changed architecture 0 violations；定向lint（11文件）0 warnings / 0 errors。候选保持pending-review，未晋升formal/CI。
