/**
 * 功能组（fork）：把用户选定的工具档位落到 runtime 配置上。
 *
 * 读的是宿主写的状态文件（与身份配置同级、同模式）。落点只有一个：
 * `runtimeConfig.toolAllowlist` —— 可见性的唯一入口是 runtime 侧的
 * `resolveBuiltInToolAllowlist`，它同时也是 MCP 注册拿到的同一份名单。
 *
 * 与宿主下发的既有白名单（`options.runtimeConfig.toolAllowlist`，CUA 等会话会带）
 * **取交集**：档位只会让工具面更小，永不变大。标准档返回 undefined = 不下发 = 不加约束。
 *
 * 见 FEATURES.md 的 tool-modes 条目与 docs/features/tool-modes/design.md 第 6 节。
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  FORK_TOOL_MODE_STATE_FILENAME,
  FORK_TOOL_MODE_STATE_SCHEMA_VERSION,
  parseForkToolModeStateFile,
  type ForkToolMode,
} from "@zcode/shared";

import { resolveForkToolModeToolNames } from "@zcode/core";

export interface ApplyForkToolModeInput {
  storageRoot: string;
  /** 宿主下发的既有白名单（可能缺席）。 */
  hostAllowlist?: readonly string[];
  log?: (message: string, detail?: Record<string, unknown>) => void;
}

export interface ForkToolModeResolution {
  mode: ForkToolMode;
  injectTools: boolean;
  /** 要写进 runtimeConfig.toolAllowlist 的值；undefined = 不下发。 */
  toolAllowlist?: readonly string[];
}

export async function resolveForkToolMode(
  input: ApplyForkToolModeInput,
): Promise<ForkToolModeResolution> {
  const stateFilePath = join(input.storageRoot, FORK_TOOL_MODE_STATE_FILENAME);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(stateFilePath, "utf8"));
  } catch {
    // 文件缺失或损坏：按「标准 + 注入」处理，等价于本功能不存在。
    raw = { schemaVersion: FORK_TOOL_MODE_STATE_SCHEMA_VERSION };
  }
  const state = parseForkToolModeStateFile(raw);

  // 关闭注入：空数组 = 一条工具都不注册（MCP 同样为空，白名单覆盖 MCP 注册）。
  if (!state.injectTools) {
    return { mode: state.mode, injectTools: false, toolAllowlist: [] };
  }

  const modeToolNames = resolveForkToolModeToolNames(state.mode);
  // 标准档：不下发，保持宿主既有名单（若有）。
  if (!modeToolNames) {
    return { mode: state.mode, injectTools: true };
  }

  const hostAllowlist = input.hostAllowlist;
  const toolAllowlist =
    hostAllowlist && hostAllowlist.length > 0
      ? modeToolNames.filter((name) => hostAllowlist.includes(name))
      : modeToolNames;
  return { mode: state.mode, injectTools: true, toolAllowlist };
}
