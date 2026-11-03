# 覆盖设置热重载：/refresh 命令（reload-command）

> 二开功能条目 id：`reload-command`。上游接线一律标注 `FORK(reload-command)`，检索见 `AGENTS.md`。
> 关联条目：`tool-modes`（工具档位与注入总开关）与 `identity-preset`（系统指令）——本命令让两者的设置在
> **已有会话**里原地生效，不需要新开对话或重启应用。

## 2026-11-03 命令命名隔离

用户确认：原 fork `/reload` 改名为 `/refresh`，原有设置热重载行为不变；`/reload` 让给上游单任务运行实例重启，不保留别名，避免误中断执行。新请求的命令信封、排队 kind 与 slash 目录均使用 `refresh`。已持久化的 `fork_reload_completed` 事件、`reload` timeline marker 和内部维护轮标识继续兼容读取，不迁移历史。

验收：`/refresh` 只刷新提示词与工具面；带参数/附件不拦截；`/reload` 不进入 fork 维护轮；忙碌时排队文本与意图均为 `refresh`；旧完成回执仍能清理对应 pending command。桌面与手机共享同一解析与投影。

## 1. 背景与目标

工具档位（`~/.zcode/tool-groups.json`）与系统指令（`~/.zcode/presets/active.json`）目前在**会话创建 /
冷恢复**时读取一次（`create-app.ts` 的档位解析、`ensureContextInitialized` 的身份读取），运行中的会话
冻结——这是「前缀在会话内不可变」的缓存不变量（identity-preset design 6.3）。用户改完设置后，要么新开
对话、要么重启应用才能生效；`/fork` 之类借「新会话」达成等效，但会多出一条对话。

目标：新增 `/refresh` 命令，在**现有会话**里重读这两个设置，就地重建提示词前缀与工具面，**下一轮起生效**；
对话历史不动。

## 2. 非目标

- 不重读工作区内容：skills 发现、AGENTS.md/用户指令、memory 索引都不在范围内（它们是内容不是设置，
  各自有刷新路径）。
- 不做 MCP 服务器配置本身的改动（`runtimeConfig.mcp` 仍是会话创建期配置；增删/修改服务器仍需新会话）。
  `/refresh` 只按新档位重新过滤**已发现**的 MCP 工具。
- 不穿透子代理（沿用 tool-modes 的既有边界）。
- 不做 TUI 专属命令面（核心文本路径天然支持 `/refresh`，菜单不另做）。

## 3. 语义（含已确认决策）

| 决策点 | 结论 |
| --- | --- |
| 执行回执 | **转录内灰字分隔线**（`timelineMarker` 的 `reload` 型，与 `/compact` 同款样式，文案「已重载提示词与工具面」）；排队与失败仍用 toast（与 compact 的排队/被拒提示同通道） |
| 忙碌时 | 排队到回合边界（与 compact 一致）：deferred input「`/refresh`」入队，回合结束后由排空路径执行 |
| 菜单位置 | 进 App 的 `/` 菜单（`APP_PROTOCOL_VISIBLE_BUILTIN_SLASH_COMMAND_NAMES`）与帮助目录 |

- 空闲执行是一条 **kind = `"reload"` 的维护轮**：`beginActiveTurn("reload")` → `TurnStarted`
  （`inputVisibility: "model-only"` + `executionKind: "controlOnly"`——0ms 维护轮，不渲染用户气泡、
  模型读不到文本、也不产生 Agent 工时）→ 重读两端口 → 工具面差量 → `rebuildContextPrefix` →
  `TurnComplete`（空 response）。形状照抄 `executeManualCompact`。
- **回执**：维护轮成功后追加一条 `ForkReloadCompleted` 会话事件，投影落成 `timelineMarker`（`reload` 型，lane `assistantWork`，与 compact marker 同形），UI 渲染为分隔线灰字「已重载提示词与工具面」；带 `sourceCommandId` 供客户端 pending command 对账。失败与排队提示仍走 toast。
- **缓存例外**：本命令显式打破「前缀在会话内不可变」——一次性 prompt cache 前缀失效是它的**目的**，
  不是回归。设置在两次执行之间没有变化时，重建出的前缀逐字节相同，缓存不会失效。日志记录前后值便于确认。
- 让位规则照抄 identity-preset：workflow actor / `customSystemPrompt` 会话里身份段本就不投影
  （builder 既有规则），reload 不改这条语义；子代理运行时（`subagent_child`）不可达命令面，实现里直接短路。
- 幂等：重复执行安全，不设操作锁（compact 的锁是压缩去重需要的，reload 不需要）。
- 失败回退：状态文件读不到/损坏 → 诊断 warn（`fork.tool_mode.load.failed` / `identity_preset.load.failed`，
  与首次读取同一事件名）→ 回退「本功能不存在」的默认（fail-open 到现状），不中断会话。

## 4. 执行链路

```
App `/` 菜单 `/refresh`（parseV4VisibleSlashCommand → kind "refresh"）
   └─ v4 信封 { type: "refresh", sessionId }
        └─ NATIVE_HANDLERS.refresh（zcode-protocol-v4/commands/handlers/reload.ts）
             ├─ 空闲 → record.app.reloadForkOverrides(...) → runtime.executeForkReload（维护轮）
             └─ 忙碌 → enqueueDeferredInputForBusyWork("/refresh", { commandKind: "refresh" })
                        └─ 回合结束排空时 executeTurnCommand("/refresh")
                             └─ turn.ts 分流 parseRefreshCommand → executeForkReload（同一条执行路径）

executeForkReload（core/src/runtime/methods/reload.ts）：
   0. beginActiveTurn("reload") + TurnStarted(model-only)
   1. identityPresetPort.loadActive() → config.identityPreset        （诊断 warn）
   2. forkToolModePort.loadActive()   → config.toolAllowlist         （宿主名单交集在端口内完成）
   3. 工具差量：内置：按 resolveBuiltInToolAllowlist 注销不再允许的，再整体重注册（含 embedded-search 联动）
               MCP：注销上次注册名，按启动期描述符快照以新名单重注册（不重连）
   4. cachedTools = null
   5. rebuildContextPrefix（新提示词 + 新 guidanceToolNames）
   6. 发 ForkReloadCompleted 事件（→ 投影成 timelineMarker 灰字回执）
   7. fork.reload.completed 日志（mode / injectTools / toolCount / identity / added / removed）
   8. TurnComplete（空 response）
```

**为什么用端口 + 维护轮，而不是直接改 `config`**：创建期与重载必须共用同一份读盘/交集逻辑
（单点真相源）——端口镜像 `fork/identity-preset/file-port.ts` 的既有模式；维护轮让「队列排空执行的
`/refresh`」与「空闲直接执行的 `/refresh`」落到同一个入口，状态机（TurnStarted/Complete）不会出现
「输入被消费但没有 turn 边界」的悬挂。

## 5. 状态所有者

| 状态 | 所有者 | 位置 |
| --- | --- | --- |
| 两个设置文件 | host 服务（既有） | `~/.zcode/tool-groups.json`、`~/.zcode/presets/active.json` |
| 会话内生效值 | runtime config | `config.toolAllowlist` / `config.identityPreset`（reload 的写入点） |
| 工具注册表 | runtime | `runtime.registry`（差量注销 + 全量重注册） |
| 回执 | 渲染层 toast | 不持久化 |

## 6. 接口

```ts
// core：工具档位文件端口（镜像 identity 端口；创建期与 /refresh 共用）
interface ForkToolModePort {
  loadActive(): Promise<ForkToolModeOutcome>;
}
interface ForkToolModeOutcome {
  mode: ForkToolMode;
  injectTools: boolean;
  /** 本会话最终应使用的可见性白名单；undefined = 不加约束（仅当标准档且宿主无名单）。 */
  toolAllowlist?: readonly string[];
  diagnostic?: string;
}
```

- v4 命令信封 `refresh`（空 payload）；`commandKind`/intent kind 联合使用 `"refresh"`。
- App facade：`reloadForkOverrides()`（供 v4 handler 调用；内部走 `executeForkReload`）。

## 7. 边界与风险

1. **收窄方向必须显式注销**：`registerBuiltInTools` 只做「注册时过滤」，不会移除上一次注册的项；
   MCP 同理——`initializeMcp` 目前丢弃 `registerMcpTools` 的返回名单，需在 runtime 上记住最近一次注册名。
2. **MCP 重注册不重连**：用启动期描述符快照按新名单重新过滤注册；服务器配置变更不在范围内。
3. **embedded-search 联动**：Bash 进出 allowlist 会翻转 Glob/Grep 的存在。重注册必须走完整选项集
   （`registerRuntimeBuiltInTools` 的 deps 门齐备），不能复用 `refreshBranchAwareBuiltInTools` 的精简集合
   （它有意省略 `includeNodeRepl` 等门，只适用于「不新增」的分支刷新）。
4. **上游漂移面**：33 个上游文件、54 行 `FORK(reload-command)` 标记（含事件/投影/分享面；口径见 FEATURES 条目）。
5. **缓存成本**：一次性前缀失效属于命令目的；无变化时不失效（见第 3 节）。命令日志记录 before/after。
6. **版本偏斜**：v4 binder 对未原生化的命令回落旧桥；旧 CLI 收到 `refresh` 会按其默认路径拒绝/忽略。
   fork 的 UI 与 CLI 同版本发布，属可接受。
7. **不改变首次读取路径**：创建期解析改走同一端口，语义与原 `resolveForkToolMode` 等价（标准档 =
   不下发/保持宿主名单）。「已开着的会话不受影响」的既有语义不变——除用户显式执行 `/refresh`。

## 8. 验收场景

1. 空闲执行 `/refresh`：同一会话的下一轮请求携带新提示词与新工具面；历史消息不变；日志出现
   `fork.reload.completed`。
2. 不执行 `/refresh`：行为与现状一致（设置仍只对新会话/冷恢复生效）。
3. 忙碌时执行：toast 提示已排队；回合结束后自动执行（日志可见）。
4. 极简 → 标准：此前被剃掉的工具恢复注册（含 MCP）；标准 → 极简：被排除的工具从注册表消失。
5. 关/开「注入工具」：`/refresh` 后工具面清空 / 恢复。
6. 状态文件损坏：诊断 warn + 回退现状，会话不中断。
7. workflow actor / `customSystemPrompt` 会话：身份段不变（既有让位规则）。
8. 无变化时执行 `/refresh`：功能正常，请求前缀逐字节相同（缓存不失效）。
9. 冷恢复与 `/refresh` 同源同果（都走两个端口的 `loadActive`）。

## 上游公告迁移兼容（2026-11-03）

上游把 skills、环境、Git、日期从 context prefix 移到会话公告历史后，维护入口必须在工具面
定型、prefix 重建之后，调用同一个 `refreshRestoredAnnouncements` owner 协调公告：
skills 与指令按当前 builder 原位更新或移除；关闭动态上下文时移除已注入的环境、模型、
output-style、Git 与日期公告。不能只阻止下一次新增，否则模型仍看到旧清单与旧动态信息。

只改运行时模型历史中的明确 attachment 来源；保留真实用户/助手/工具对话、AGENTS.md、
memory 索引及其他业务公告，不修改持久化原始记录。冷恢复使用同一协调 owner；重新启用后
由上游正常请求公告路径重新生成。无设置变化时不改写公告字节。

验收：真实第一轮已产生公告 → `/refresh` 维护轮（零模型请求）→ 第二轮旧关闭项缺席，
真实消息与指令保留；重新启用后正常再公告。标准切极简档移除 Skill 时同样撤回旧清单。

## 2026-11-03 冷恢复回执修复（用户已批准）

真实 FRR01 发现原完成事件只在内存 eventStore：`/refresh` 成功后 marker 可见，但 `/reload` 重建实例后消失。CLI transcript 是唯一持久所有者；选择复用上游 `persistAssistantTimelinePartForSession`，将每次完成写成**独立** assistant `timeline_event` message + fork `fork_refresh_completed` typed timeline part，不新建 session_entry 类型或第二账本。不能给已有对话 anchor 追加 part，否则 rewind 到同 anchor 会错误保留发生在 cut 后的动作。

```text
refresh maintenance → appendEvent → existing timeline message/part persistence → live success event
                                      ↓
restart / rewind / fork → selectActiveConversationBranch → same transcript hydration → reload marker
```

- `event.id` 是完成幂等键，派生稳定 messageID/partID；message 与 part 均写成功后才通知 live sinks。写失败沿原维护轮错误路径，不发布成功回执。
- part 只含 completion eventId、可缺省的 sourceCommandId、完成时刻；保持既有事件名 `fork_reload_completed` 和 UI marker type `reload`，无历史格式迁移。
- carrier provider-hidden，不进模型输入、不产生用户气泡或空 Agent 工作轮；首条输入就是 refresh 时也只有 marker。
- 冷恢复按物理 message 顺序独立消费 carrier；实时+冷事实按完成 eventId 去重，既不按文本猜身份，也不把全部 marker 堆到末尾。
- rewind/rollback/fork 直接沿用 active branch 与 message clone，不另造 generation/anchor过滤。相同对话 anchor 前后多个 refresh 由不同独立 message 区分；截断后只保留前缀内的 marker。
- 回归先红：真实 FRR01 维持 marker 跨 reload 的断言；另补真实 SQLite 写读、live/durable 去重、多 marker 顺序、无空轮、空历史、同 anchor 截断与 fork 前缀测试。

持久 part 的 completionEventId 必须非空；sourceCommandId 可缺省，但存在时同样必须为非空字符串，与共享 strict wire schema 对齐。非法时间、身份或宿主语义必须带 session/message/part 上下文抛错。已裁剪分支的完整 model-only/controlOnly 维护三联（start/completion/end）应一起从冷恢复材料中移除，不留下空 turnHeader；只有匹配已知持久完成事实的维护轮满足该规则，普通轮与未完成轮不受影响。
