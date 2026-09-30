/**
 * 功能组（fork）：三档工具分类。
 *
 * 工具名的**权威来源是注册表**（`builtInTools`）——这份文件只做「把已注册的工具归到哪一档」，
 * 不复制工具清单的全集：分类完整性由 `forkToolModeTools.test.ts` 盯着（注册表新增或改名工具时
 * 该测试变红，逼一次显式归类，而不是让档位语义随上游静默漂移）。
 *
 * 放 core 而不是 `@zcode/shared`：名单只有持有注册表的一方能保证与注册表一致；渲染层需要的是
 * 「当前档位」，不是逐工具清单。
 * 见 FEATURES.md 的 tool-modes 条目与 docs/features/tool-modes/design.md 第 4 节。
 */

/** 极简：能读、能写、能搜、能执行、能联网——干活的最小集合。 */
export const FORK_TOOL_MODE_MINIMAL_TOOL_NAMES = [
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
export const FORK_TOOL_MODE_BASIC_EXTRA_TOOL_NAMES = [
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
 * 归类在这里是为了让「注册表里的每个工具都有归属」这条不变式成立。
 */
export const FORK_TOOL_MODE_STANDARD_EXTRA_TOOL_NAMES = [
  "js",
  "Task",
  "submit_result",
  "escalate",
  "RespondToCoordinator",
] as const;

export type ForkToolModeName = "minimal" | "basic" | "standard";

/** 三档共有的分类结果，供完整性测试与档位解析共用一份定义。 */
export const FORK_TOOL_MODE_CLASSIFICATION: readonly {
  mode: ForkToolModeName;
  toolNames: readonly string[];
}[] = [
  { mode: "minimal", toolNames: FORK_TOOL_MODE_MINIMAL_TOOL_NAMES },
  { mode: "basic", toolNames: FORK_TOOL_MODE_BASIC_EXTRA_TOOL_NAMES },
  { mode: "standard", toolNames: FORK_TOOL_MODE_STANDARD_EXTRA_TOOL_NAMES },
];

/**
 * 档位 → 要下发的工具白名单；返回 `undefined` = 不下发（标准档，等于不加约束）。
 *
 * 极简/基础是封闭集合：MCP 工具名不在这里，因此它们不会漏进这两个档位——这正是
 * 「极简只要这几个」的语义，也是不用 denylist 的原因（denylist 表达不了封闭性）。
 */
export function resolveForkToolModeToolNames(
  mode: ForkToolModeName,
): readonly string[] | undefined {
  if (mode === "standard") {
    return undefined;
  }
  const toolNames = FORK_TOOL_MODE_CLASSIFICATION.filter((entry) =>
    mode === "minimal" ? entry.mode === "minimal" : entry.mode !== "standard",
  ).flatMap((entry) => entry.toolNames);
  return toolNames;
}
