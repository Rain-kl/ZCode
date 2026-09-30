# reload-command 决策记录

日期：2026-09-30
关联：`docs/features/reload-command/design.md`、`docs/features/reload-command/implementation.md`、
`FEATURES.md` 的 `reload-command` 条目。

## 1. 起因

工具档位与系统指令都在会话创建/冷恢复时读取一次，运行中的会话冻结（前缀不可变的缓存不变量）。
用户改完设置后要么新开对话、要么重启应用；`/fork` 借「新会话」等效，但会多出一条对话。要求：
一条 `/reload` 在已有会话里原地生效。三项产品决策（用户确认）：回执用轻量提示、忙碌排队到回合
边界（与 compact 一致）、进 `/` 菜单。

## 2. 关键决策

### 2.1 解析单点化：bootstrap resolver 迁入 core 端口，并改「终值」语义

- **决策**：删除 `bootstrap/src/fork/tool-modes.ts` 的 `resolveForkToolMode`，读盘+交集逻辑并入
  `core/src/fork/tool-modes/file-port.ts`（镜像 identity-preset 端口的既有模式）。端口的
  `toolAllowlist` 返回**本会话最终值**：标准档 = 宿主名单本身（可能 undefined），而不是
  「不下发（undefined）」。
- **理由**：创建期与 `/reload` 必须共用同一份逻辑（两份必然漂移）。「不下发」语义在创建期没
  问题（有 `!== undefined` 守卫，宿主名单原样留在 runtimeConfig），但 `/reload` 从极简切回标准
  时需要一个**要恢复的目标值**——若端口返回 undefined，赋值会把宿主约束一并抹掉（CUA 等带
  宿主名单的会话会被放大工具面）。终值语义让调用方无条件赋值即可。
- **代价**：`fork.tool_mode.resolved` 日志的 `toolCount` 在「标准档 + 宿主有名单」时从 null 变为
  宿主名单长度；实际会话里宿主名单罕见，可接受。

### 2.2 执行路径走 submitPrompt + turn 分流，不新增 App facade 方法

- **决策**：空闲时 v4 handler `record.app.submitPrompt("/reload")`；忙碌时与 compact 完全同形
  入 FIFO。两条路径都经 `turn.ts` 的 `parseReloadCommand` 分流到 `executeForkReload`。
- **理由**：①compact 的既成形状就是「命令 handler 只负责投递，执行在 turn 管线里」——排队排空
  本身必须经 `executeTurnCommand`，绕开它意味着第二条执行路径；②`submitPrompt` 自带
  admission/边界处理，直接调 runtime 方法要另造一遍；③唯一执行点保证「输入被消费必有 turn
  边界」（control-only-turn 的教训）。TurnStarted 用 `model-only` 旗标：事件留 raw input 供
  排查/恢复，但投影不渲染用户气泡，模型也读不到该文本；并带 `executionKind: "controlOnly"`
  （0ms 维护轮：`conversationTurnRenderUnits` 与投影的工时/时长推导都会跳过它，否则旧 UI 会把
  duration=0 显示成「已工作」）。

### 2.3 收窄靠显式注销；内置重注册用完整选项集

- **决策**：`registerBuiltInTools` 只做「注册时过滤」，不回收旧项——`/reload` 收窄方向先按
  `resolveBuiltInToolAllowlist` 把被排除且在场的内置工具逐个 `unregister`，再整体重注册；
  MCP 注销上次注册名单后按启动期描述符快照重过滤。
- **理由**：不注销 = 标准→极简后旧工具仍在注册表（静默永不生效）；复用
  `refreshBranchAwareBuiltInTools` 的精简选项集会漏掉 `includeNodeRepl` 等门的工具（该函数
  只在「不新增」的分支刷新场景安全，注释已写明）。重注册传 `silentDuplicateWarnings`，
  与分支刷新同一口径，避免每次 `/reload` 控制台刷屏。

### 2.4 MCP 不重连，用启动期快照重过滤

- **决策**：`initializeMcp` 留存 `mcpToolDescriptors` 与本次注册名；`refreshForkMcpToolRegistrations`
  只做注销+按新名单重注册。
- **理由**：MCP 服务器配置是会话创建期配置（v4 createSession 注释明确「必须随 create 一次性进入
  record」），增删服务器本来就要求新会话；`/reload` 的职责只是让**可见性档位**对已发现工具生效，
  重连会把一个亚秒级维护动作变成网络动作。

### 2.5 回执：转录内灰字分隔线（首版 toast 方案已被用户否决）

- **决策（用户确认）**：成功回执 = 转录内 `timelineMarker`（`reload` 型），样式对齐 `/compact`
  的「上下文已压缩」——两侧细线 + 居中灰字「已重载提示词与工具面」；排队与失败仍用 toast。
- **背景**：首版按「成本不成比例」的判断只做了 toast（要动 rows schema、产品投影、cold hydration、
  渲染四处）。用户明确要求对齐 compact 的转录样式后按四处逐一落地：
  ①`contracts` 新增 `ForkReloadCompleted` 事件（payload 带 `sourceCommandId`）；
  ②`product-projection` 新增 handler 落 `timelineMarker`（lane `assistantWork`，与 compact 同泳道）；
  ③`rows.ts` 的 marker 联合新增 `{ type: "reload" }`；④`ConversationRowView` 加分隔线分支（刷新图标 +
  `chat.reload.marker` 文案）。分享面（公开投影 allow-list + 只读时间线标签）同步补齐——
  公开投影的穷尽 switch 没有 default，新增行类型会编译失败，这正是它设计的闸门。
- **顺带**：`pendingCommandRegistry` 的结算条件加入 `reload`（marker 带 `sourceCommandId` =
  命令已执行的权威证据，替代恢复提示）；成功 toast 移除（避免与标记双份回执）。
- **代价与边界**：cold 恢复不需要额外 hydration 代码——v4 投影按事件重放，事件持久化后标记自然重建
  （与 compact marker 同机制）；运行期渲染仍是未单测项，列在 implementation.md 的未验证清单。

### 2.6 队列 kind 扩为 "reload" 并纳入既有的控制命令排除

- **决策**：`"reload"` 加入 steer/intent/activeTurnKind 四个联合与两处 zod schema；
  `steering.ts` 的两处 inline-guide 排除同步加 `"reload"`；UI 侧把 reload 纳入可回放输入命令、
  并从 Composer 回填里排除。
- **理由**：排队语义必须让排队项有身份（UI 队列展示、回放、去重判断都读 kind）；不加排除项，
  控制命令可能被当作 inline guide 消费进当前回合（compact 的先例注释）。回填排除是因为
  maintenance 命令的「文本」不是可编辑重发的用户消息（compact 同样排除）。
