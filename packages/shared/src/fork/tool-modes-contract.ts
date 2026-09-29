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
 * 由「档位 + 注入开关」算出要下发的工具禁用名单。
 *
 * 用 denylist 而不是 allowlist：allowlist 是 fail-closed，未分类的新工具与名字在创建时才知的
 * MCP 工具都会被一并砍掉；denylist 只关用户明确排除的部分，「标准」档天然等价于不下发。
 */
export function resolveForkToolModeDenylist(input: {
  mode: ForkToolMode;
  injectTools: boolean;
}): readonly string[] {
  if (!input.injectTools) {
    return [...FORK_TOOL_MODE_ALL_BUILTIN_TOOL_NAMES];
  }
  const enabled = new Set(resolveForkToolModeToolNames(input.mode));
  return FORK_TOOL_MODE_ALL_BUILTIN_TOOL_NAMES.filter((name) => !enabled.has(name));
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
  /** 极简 / 基础档不下发 MCP 工具；UI 据此提示。 */
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
