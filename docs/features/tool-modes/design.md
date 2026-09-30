# 功能组：工具模式与工具注入开关（tool-modes）

> 二开功能条目 id：`tool-modes`。上游接线一律标注 `FORK(tool-modes)`，检索见 `AGENTS.md`。

## 1. 背景与目标

每次请求都携带全部工具定义，而多数会话只用到其中一小部分：请求体大、模型选择面宽、也更容易误调用。目标是在 **设置 → Agent 能力 → 功能组** 提供：

1. **工具模式三选一**：极简 / 基础 / 标准（默认标准，行为与改动前一致）。
2. **总开关「注入工具」**：关闭后请求不下发任何工具，模型只做纯文本回答。

## 2. 非目标

- 不做单工具粒度的开关（模式内部不再细分）。
- 不做按分组自由勾选（三档是固定集合）。
- 不改动子代理与工作流子代理的工具面（它们各有自己的档案与禁用名单；本开关只约束主会话请求）。
- 不动权限模式（build/edit/plan/yolo）与 `permission.allowedTools` 配置——它们是正交的既有闸门。

## 3. 工具现状（实测）

注册表共 **38 个内置工具**（`builtInTools`，来自把注册表跑出来的实测结果）。此外还有**动态来源**：MCP 服务器工具（名字形如 `<server>__<tool>`，含内置的 `computer-use__*`）与插件工具，其名字在会话创建时不可知。

## 4. 三档定义

| 档位                | 内容                                                                                                                                                                                                                                                                                                                                                                                                  | 工具数    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **极简** `minimal`  | `Read` `Write` `Edit` `Glob` `Grep` `Bash` `WebFetch` `WebSearch`                                                                                                                                                                                                                                                                                                                                     | 8         |
| **基础** `basic`    | 极简 + `TodoRead` `TodoWrite` `EnterPlanMode` `ExitPlanMode` `AskUserQuestion` `Agent` `SendMessage` `ReadSessionContext` `TaskOutput` `TaskStop` `Skill` `CronCreate` `CronList` `CronUpdate` `CronDelete` `CreateWorkflow` `AmendWorkflow` `SaveWorkflow` `EvalWorkflowSnippet` `ListWorkflowRuns` `GetWorkflowRun` `ResumeWorkflowRun` `ResolveWorkflowQuestion` `ListSavedWorkflows` `ListModels` | 33        |
| **标准** `standard` | 基础 + `js`（脚本运行时）+ `Task` / `submit_result` / `escalate` / `RespondToCoordinator`（后四个是子代理与工作流的内部通信面，只在对应端口在场时注册）+ 全部 MCP / 插件工具                                                                                                                                                                                                                          | 38 + 动态 |

档位是**包含关系**：标准 ⊃ 基础 ⊃ 极简。默认 `standard`，因此默认行为与改动前逐字节一致。

## 5. 状态所有者

| 状态                | 所有者                       | 位置                                                                                                                                                              |
| ------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 当前模式 + 注入开关 | fork 功能组服务（host）      | `~/.zcode/tool-groups.json`（`{ schemaVersion: 1, injectTools: boolean, mode: "minimal"\|"basic"\|"standard" }`，缺省 `{ injectTools: true, mode: "standard" }`） |
| 三档的工具集合定义  | `@zcode/shared` 的 fork 契约 | 代码常量，UI 与 host 共用一份                                                                                                                                     |
| 界面局部状态        | 渲染层                       | 不持久化                                                                                                                                                          |

文件与身份配置同级（用户级、跨工作区），并纳入 WebDAV 同步清单（一行）。

## 6. 执行链路

```
设置 → Agent 能力 → 功能组
   └─ fork 服务读写 ~/.zcode/tool-groups.json
        └─ 宿主建会话 / 冷恢复时解析（resolveForkToolModeAllowlist）：
             极简 / 基础 → toolAllowlist = 该档的固定工具名集合
             标准        → 不下发（undefined = 不加任何约束 = 现状）
             注入关闭    → toolAllowlist = []（一条工具都不注册）
             → session/create（与 resume）参数 toolAllowlist
                  └─ agent 注册期与每轮 getTools 过滤（现成路径；guidanceToolNames 同步收敛）
```

**为什么是 allowlist 而不是 denylist**：极简/基础的工具集**已知固定**，白名单能精确表达「就这些」。denylist 表达不了这个意图——MCP 工具名在会话创建时不可知，会漏进极简档，也会在「注入工具」关闭时照旧下发（总开关形同虚设）。白名单同时覆盖 MCP：`runtime/methods/mcp.ts` 把同一份 allowlist 传给 MCP 注册，所以**不需要去动 `mcpServers`**。仓库既有先例：`EXPLORE_AGENT_ALLOWED_TOOLS` 就是用 allowlist 表达一个固定工具集。

空数组是本仓库既有的「不给任何工具」语义（`tools: "none"` 那条注释即此）。

## 7. 接口

```ts
export type ForkToolMode = "minimal" | "basic" | "standard";

/** 档位 → 内置工具名集合（含包含关系，由 shared 常量派生，不在调用点重复列举）。 */
export function resolveForkToolModeToolNames(mode: ForkToolMode): readonly string[];
/** 全部内置工具名（契约里的完整清单，供一致性与计数使用）。 */
export const FORK_TOOL_MODE_ALL_BUILTIN_TOOL_NAMES: readonly string[];

/** 状态文件与解析结果。 */
export interface ForkToolModeStateFile {
  schemaVersion: number;
  injectTools: boolean;
  mode: ForkToolMode;
}
export interface ForkToolModeState extends ForkToolModeStateFile {
  /** 当前档位下会下发的内置工具名（UI 展示用）。 */
  activeToolNames: readonly string[];
  /** 当前档位不下发的内置工具名（UI 展示用）。 */
  disabledToolNames: readonly string[];
}

interface IForkToolModeService {
  getState(): Promise<ForkToolModeState>;
  setInjectTools(injectTools: boolean): Promise<ForkToolModeState>;
  setMode(mode: ForkToolMode): Promise<ForkToolModeState>;
  onStateChanged: Event<ForkToolModeState>;
}
```

## 8. 语义与边界

1. **对新会话生效**：工具面在会话创建时冻结，面板明示「对新会话生效」；已开着的会话不受影响（改完重启应用或新建对话）。
2. **与既有闸门叠加，不覆盖**：注册表级的 `includeXxx` 门、动态工作流灰度门、automation 轮的硬禁用、子代理档案、`permission.allowedTools/disallowedTools` 全部照旧；本开关只会让工具面更小，永不变大。
3. **子代理不受约束**（v1）：`Agent` 拉起的子代理按各自档案取工具。若日后要让本开关穿透到子代理，需在子代理创建处传同一份 allowlist——本期不做，写进风险。
4. **注入关闭时的连带效果**：`# Session-specific guidance`、skills 清单等依赖工具在场的段会自动消失（走 `guidanceToolNames`），不需要额外开关。
5. **拒绝对话中途切换**：与身份配置同理由（前缀不可变），一次会话内固定。

## 9. 验收场景

1. 默认（未配置）：`toolDenylist` 为空、MCP 照旧下发，请求工具面与改动前一致。
2. 选极简：新会话请求只含 8 个内置工具，MCP 工具不存在，`# Session-specific guidance` 里与已关工具相关的指导消失。
3. 选基础：请求含 33 个内置工具，`js` 与内部四件套不在其中。
4. 选标准：回到场景 1。
5. 关闭「注入工具」：请求不含任何工具定义（tools 为空/缺席），模型只能纯文本回答；重新打开后恢复。
6. 冷恢复（resume）仍带同一份 allowlist，不因恢复而放大工具面。
7. 设置页显示当前档位与工具计数，并列出被禁用/启用哪些工具。

## 10. 风险与边界

1. **关掉执行/文件类工具等于废掉 agent**：极简档仍含它们（用户未要求可关），但真正危险的是把「注入工具」关掉却期待它干活——面板给出说明。
2. **MCP 在极简/基础档整体消失**：白名单不含 MCP 工具名，这是「极简只要那 8 个」的本意，但面板必须明说（否则用户会以为工具丢了）。
3. **子代理工具面不受约束**：极简档下 `Agent` 拉起的子代理仍可能持有更多工具——本期记录，不实现穿透。
4. **上游漂移**：新增或改名内置工具时，极简/基础档不会自动获得它（fail-closed，符合「极简就是这几个」的本意），但**必须有人做一次显式决定**。缓解：附一条断言测试比对注册表实际条目与常量清单，不一致即失败（放在 `apps/zcode-cli/packages/core/test/`，那里能同时 import 注册表与契约）。
5. **同步**：`tool-groups.json` 纳入 WebDAV 清单后，旧备份包不含该条目 → 按清单的「缺席即保持」规则不动本地。
