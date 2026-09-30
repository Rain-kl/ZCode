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

/** 组装给 UI 的完整状态。逐工具清单不在这里：工具名的权威来源在 core 的注册表。 */
export function buildForkToolModeState(file: ForkToolModeStateFile): ForkToolModeState {
  return { ...file, mcpEnabled: file.injectTools && file.mode === "standard" };
}
