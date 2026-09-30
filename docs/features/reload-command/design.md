# 覆盖设置热重载：/reload 命令（reload-command）

> 二开功能条目 id：`reload-command`。上游接线一律标注 `FORK(reload-command)`，检索见 `AGENTS.md`。
> 关联条目：`tool-modes`（工具档位与注入总开关）与 `identity-preset`（系统指令）——本命令让两者的设置在
> **已有会话**里原地生效，不需要新开对话或重启应用。

## 1. 背景与目标

工具档位（`~/.zcode/tool-groups.json`）与系统指令（`~/.zcode/presets/active.json`）目前在**会话创建 /
冷恢复**时读取一次（`create-app.ts` 的档位解析、`ensureContextInitialized` 的身份读取），运行中的会话
冻结——这是「前缀在会话内不可变」的缓存不变量（identity-preset design 6.3）。用户改完设置后，要么新开
对话、要么重启应用才能生效；`/fork` 之类借「新会话」达成等效，但会多出一条对话。

目标：新增 `/reload` 命令，在**现有会话**里重读这两个设置，就地重建提示词前缀与工具面，**下一轮起生效**；
对话历史不动。

## 2. 非目标

- 不重读工作区内容：skills 发现、AGENTS.md/用户指令、memory 索引都不在范围内（它们是内容不是设置，
  各自有刷新路径）。
- 不做 MCP 服务器配置本身的改动（`runtimeConfig.mcp` 仍是会话创建期配置；增删/修改服务器仍需新会话）。
  `/reload` 只按新档位重新过滤**已发现**的 MCP 工具。
- 不穿透子代理（沿用 tool-modes 的既有边界）。
- 不做 TUI 专属命令面（核心文本路径天然支持 `/reload`，菜单不另做）。

## 3. 语义（含已确认决策）

| 决策点 | 结论 |
| --- | --- |
| 执行回执 | **转录内灰字分隔线**（`timelineMarker` 的 `reload` 型，与 `/compact` 同款样式，文案「已重载提示词与工具面」）；排队与失败仍用 toast（与 compact 的排队/被拒提示同通道） |
| 忙碌时 | 排队到回合边界（与 compact 一致）：deferred input「`/reload`」入队，回合结束后由排空路径执行 |
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
App `/` 菜单 `/reload`（parseV4VisibleSlashCommand → kind "reload"）
   └─ v4 信封 { type: "reload", sessionId }
        └─ NATIVE_HANDLERS.reload（zcode-protocol-v4/commands/handlers/reload.ts）
             ├─ 空闲 → record.app.reloadForkOverrides(...) → runtime.executeForkReload（维护轮）
             └─ 忙碌 → enqueueDeferredInputForBusyWork("/reload", { commandKind: "reload" })
                        └─ 回合结束排空时 executeTurnCommand("/reload")
                             └─ turn.ts 分流 parseReloadCommand → executeForkReload（同一条执行路径）

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
`/reload`」与「空闲直接执行的 `/reload`」落到同一个入口，状态机（TurnStarted/Complete）不会出现
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
// core：工具档位文件端口（镜像 identity 端口；创建期与 /reload 共用）
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

- v4 命令信封 `reload`（空 payload）；`commandKind`/intent kind 联合新增 `"reload"`。
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
6. **版本偏斜**：v4 binder 对未原生化的命令回落旧桥；旧 CLI 收到 `reload` 会按其默认路径拒绝/忽略。
   fork 的 UI 与 CLI 同版本发布，属可接受。
7. **不改变首次读取路径**：创建期解析改走同一端口，语义与原 `resolveForkToolMode` 等价（标准档 =
   不下发/保持宿主名单）。「已开着的会话不受影响」的既有语义不变——除用户显式执行 `/reload`。

## 8. 验收场景

1. 空闲执行 `/reload`：同一会话的下一轮请求携带新提示词与新工具面；历史消息不变；日志出现
   `fork.reload.completed`。
2. 不执行 `/reload`：行为与现状一致（设置仍只对新会话/冷恢复生效）。
3. 忙碌时执行：toast 提示已排队；回合结束后自动执行（日志可见）。
4. 极简 → 标准：此前被剃掉的工具恢复注册（含 MCP）；标准 → 极简：被排除的工具从注册表消失。
5. 关/开「注入工具」：`/reload` 后工具面清空 / 恢复。
6. 状态文件损坏：诊断 warn + 回退现状，会话不中断。
7. workflow actor / `customSystemPrompt` 会话：身份段不变（既有让位规则）。
8. 无变化时执行 `/reload`：功能正常，请求前缀逐字节相同（缓存不失效）。
9. 冷恢复与 `/reload` 同源同果（都走两个端口的 `loadActive`）。
