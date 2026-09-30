/**
 * 功能组（fork）：工具模式与工具注入开关的跨包契约。
 *
 * 三档是包含关系（标准 ⊃ 基础 ⊃ 极简）。这里只有档位本身与状态 schema：
 * 档位 → 工具名的权威来源是 core 的注册表分类
 * （`apps/zcode-cli/packages/core/src/fork/tool-modes/mode-tools.ts`），宿主把「当前档位」
 * 翻译成会话创建期的 `toolAllowlist`。放 `@zcode/shared` 而不是各写一份，是因为两侧漂移的
 * 症状是「界面显示关了、请求里还在」。
 *
 * 见 FEATURES.md 的 tool-modes 条目与 docs/features/tool-modes/design.md 第 4、6 节。
 */

export const FORK_TOOL_MODE_CHANNEL = "fork-tool-modes";

export const FORK_TOOL_MODE_STATE_FILENAME = "tool-groups.json";
export const FORK_TOOL_MODE_STATE_SCHEMA_VERSION = 1;

export type ForkToolMode = "minimal" | "basic" | "standard";

/**
 * 档位全集的**运行时**数组：`isForkToolMode` 与渲染层的卡片列表都读它，
 * 数组顺序 = 设置页卡片顺序 = 能力递增顺序（后一档包含前一档）。
 * 增删档位改这一处，`isForkToolMode` 与界面会一起跟上；逐档文案的齐备性由
 * `packages/ui/test/forkToolGroupsSection.test.ts` 按本数组逐个断言。
 */
export const FORK_TOOL_MODES: readonly ForkToolMode[] = ["minimal", "basic", "standard"];

export interface ForkToolModeStateFile {
  schemaVersion: number;
  /** 关闭后请求不下发任何工具定义；缺省 true（与改动前一致）。 */
  injectTools: boolean;
  /** 缺省 standard（与改动前一致）。 */
  mode: ForkToolMode;
}

export interface ForkToolModeState extends ForkToolModeStateFile {
  /** 标准档含全部 MCP 与插件工具；其余档位不下发（白名单覆盖 MCP 注册）。UI 据此提示。 */
  mcpEnabled: boolean;
}

export function isForkToolMode(value: unknown): value is ForkToolMode {
  if (typeof value !== "string") return false;
  return (FORK_TOOL_MODES as readonly string[]).includes(value);
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

/** 组装给 UI 的完整状态。逐工具清单不在这里：工具名的权威来源在 core 的注册表。 */
export function buildForkToolModeState(file: ForkToolModeStateFile): ForkToolModeState {
  return { ...file, mcpEnabled: file.injectTools && file.mode === "standard" };
}
