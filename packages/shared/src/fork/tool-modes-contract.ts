/**
 * 功能组（fork）：工具模式与工具注入开关的跨包契约。
 *
 * 三档是包含关系（标准 ⊃ 基础 ⊃ 极简），档位 → 工具名的唯一来源在这里：
 * UI 用它渲染与计数，宿主用它把「当前档位」翻译成会话创建期的 `toolDenylist`。
 * 放 `@zcode/shared` 而不是各写一份，是因为两侧漂移的症状是「界面显示关了、请求里还在」。
 *
 * 见 FEATURES.md 的 tool-modes 条目与 docs/features/tool-modes/design.md 第 4、6 节。
 */

export const FORK_TOOL_MODE_CHANNEL = "fork-tool-modes";

export const FORK_TOOL_MODE_STATE_FILENAME = "tool-groups.json";
export const FORK_TOOL_MODE_STATE_SCHEMA_VERSION = 1;

export type ForkToolMode = "minimal" | "basic" | "standard";

/** 极简：能读、能写、能搜、能执行、能联网——干活的最小集合。 */
const MINIMAL_TOOL_NAMES = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
  "WebFetch",
  "WebSearch",
] as const;

/** 基础：在极简之上加任务与计划、提问、子代理协作、工作流、定时任务、技能。 */
const BASIC_EXTRA_TOOL_NAMES = [
  "TodoRead",
  "TodoWrite",
  "EnterPlanMode",
  "ExitPlanMode",
  "AskUserQuestion",
  "Agent",
  "SendMessage",
  "ReadSessionContext",
  "TaskOutput",
  "TaskStop",
  "Skill",
  "CronCreate",
  "CronList",
  "CronUpdate",
  "CronDelete",
  "CreateWorkflow",
  "AmendWorkflow",
  "SaveWorkflow",
  "EvalWorkflowSnippet",
  "ListWorkflowRuns",
  "GetWorkflowRun",
  "ResumeWorkflowRun",
  "ResolveWorkflowQuestion",
  "ListSavedWorkflows",
  "ListModels",
] as const;

/**
 * 标准：再加脚本运行时与内部通信面。
 * 后四个（Task / submit_result / escalate / RespondToCoordinator）只在对应端口在场时注册，
 * 列在这里是为了让「标准 = 全部内置工具」在 denylist 计算里成立。
 */
const STANDARD_EXTRA_TOOL_NAMES = [
  "js",
  "Task",
  "submit_result",
  "escalate",
  "RespondToCoordinator",
] as const;

/** 全部内置工具名。新增内置工具时必须同步这里，否则极简档会漏关它（有断言测试兜底）。 */
export const FORK_TOOL_MODE_ALL_BUILTIN_TOOL_NAMES: readonly string[] = [
  ...MINIMAL_TOOL_NAMES,
  ...BASIC_EXTRA_TOOL_NAMES,
  ...STANDARD_EXTRA_TOOL_NAMES,
];

export function resolveForkToolModeToolNames(mode: ForkToolMode): readonly string[] {
  switch (mode) {
    case "minimal":
      return [...MINIMAL_TOOL_NAMES];
    case "basic":
      return [...MINIMAL_TOOL_NAMES, ...BASIC_EXTRA_TOOL_NAMES];
    case "standard":
      return [...FORK_TOOL_MODE_ALL_BUILTIN_TOOL_NAMES];
  }
}

/**
 * 由「档位 + 注入开关」算出要下发的工具白名单。
 *
 * 返回 `undefined` = **不下发**（标准档且注入开启）= 不加任何约束 = 与改动前一致；
 * 返回空数组 = 一条工具都不注册（注入关闭）。
 *
 * 为什么是 allowlist：极简/基础的工具集是**已知固定**的，白名单能精确表达「就这些」——
 * denylist 表达不了：MCP 工具名在会话创建时不可知，会漏进极简档，也会在关闭注入时照旧下发。
 * 白名单同时覆盖 MCP（`runtime/methods/mcp.ts` 把同一份 allowlist 传给 MCP 注册），
 * 所以不需要去动 `mcpServers`。代价是上游新增内置工具不会自动进入极简/基础档——那是
 * 「极简就是这几个」的本意，另有断言测试在注册表变动时提醒做显式决定。
 */
export function resolveForkToolModeAllowlist(input: {
  mode: ForkToolMode;
  injectTools: boolean;
}): readonly string[] | undefined {
  if (!input.injectTools) {
    return [];
  }
  if (input.mode === "standard") {
    return undefined;
  }
  return resolveForkToolModeToolNames(input.mode);
}

export interface ForkToolModeStateFile {
  schemaVersion: number;
  /** 关闭后请求不下发任何工具定义；缺省 true（与改动前一致）。 */
  injectTools: boolean;
  /** 缺省 standard（与改动前一致）。 */
  mode: ForkToolMode;
}

export interface ForkToolModeState extends ForkToolModeStateFile {
  /** 当前档位会下发的内置工具名（UI 展示）。 */
  enabledToolNames: readonly string[];
  /** 当前档位不下发的内置工具名（UI 展示）。 */
  disabledToolNames: readonly string[];
  /** 标准档含全部 MCP 与插件工具；其余档位不下发（白名单覆盖 MCP 注册）。UI 据此提示。 */
  mcpEnabled: boolean;
}

export function isForkToolMode(value: unknown): value is ForkToolMode {
  return value === "minimal" || value === "basic" || value === "standard";
}

/** 状态文件解析：缺失、损坏、字段不认识一律回落到「标准 + 注入」，绝不让工具面意外变小。 */
export function parseForkToolModeStateFile(raw: unknown): ForkToolModeStateFile {
  const fallback: ForkToolModeStateFile = {
    schemaVersion: FORK_TOOL_MODE_STATE_SCHEMA_VERSION,
    injectTools: true,
    mode: "standard",
  };
  if (typeof raw !== "object" || raw === null) return fallback;
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== FORK_TOOL_MODE_STATE_SCHEMA_VERSION) return fallback;
  return {
    schemaVersion: FORK_TOOL_MODE_STATE_SCHEMA_VERSION,
    injectTools: typeof record.injectTools === "boolean" ? record.injectTools : true,
    mode: isForkToolMode(record.mode) ? record.mode : "standard",
  };
}

/** 组装给 UI 的完整状态。 */
export function buildForkToolModeState(file: ForkToolModeStateFile): ForkToolModeState {
  const enabled = new Set(resolveForkToolModeToolNames(file.mode));
  const disabledToolNames = file.injectTools
    ? FORK_TOOL_MODE_ALL_BUILTIN_TOOL_NAMES.filter((name) => !enabled.has(name))
    : [...FORK_TOOL_MODE_ALL_BUILTIN_TOOL_NAMES];
  return {
    ...file,
    enabledToolNames: file.injectTools ? [...enabled] : [],
    disabledToolNames,
    mcpEnabled: file.injectTools && file.mode === "standard",
  };
}
