/**
 * 功能组（fork）：工具档位的文件端口。
 *
 * 创建期解析（bootstrap 的 create-app）与 `/reload` 重载共用这一份「读盘 + 宿主名单交集」
 * 逻辑（单点真相源）；镜像 `fork/identity-preset/file-port.ts` 的既有模式：绝不抛出，
 * 读不动/文件损坏时给诊断并回退「本功能不存在」的默认。
 *
 * `toolAllowlist` 是**最终值**语义：调用方直接把它写进 `runtimeConfig.toolAllowlist`。
 * 标准档 = 不加档位约束，返回值就是宿主名单本身（可能 undefined）——这样 `/reload` 从
 * 极简切回标准时能恢复宿主约束，而不是把约束一并丢掉。
 *
 * 见 FEATURES.md 的 tool-modes / reload-command 条目与 docs/features/reload-command/design.md。
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  FORK_TOOL_MODE_STATE_FILENAME,
  parseForkToolModeStateFile,
  type ForkToolMode,
} from "@zcode/shared";

import { resolveForkToolModeToolNames } from "./mode-tools.js";

export interface ForkToolModeOutcome {
  mode: ForkToolMode;
  injectTools: boolean;
  /** 本会话最终应使用的可见性白名单；undefined = 不加约束（仅当标准档且宿主无名单）。 */
  toolAllowlist?: readonly string[];
  /** 读盘失败/文件损坏时的诊断；有值表示已回退系统默认。 */
  diagnostic?: string;
}

export interface ForkToolModePort {
  loadActive(): Promise<ForkToolModeOutcome>;
}

export function createFileForkToolModePort(input: {
  root: string;
  /** 宿主下发的既有白名单（会话创建时捕获；档位只收敛不放宽）。 */
  hostAllowlist?: readonly string[];
}): ForkToolModePort {
  return {
    loadActive: async () => loadFromRoot(input.root, input.hostAllowlist),
  };
}

async function loadFromRoot(
  root: string,
  hostAllowlist: readonly string[] | undefined,
): Promise<ForkToolModeOutcome> {
  const stateFilePath = join(root, FORK_TOOL_MODE_STATE_FILENAME);
  let stateText: string;
  try {
    stateText = await readFile(stateFilePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // 文件不存在 = 未启用（首次使用与「关了同步的机器」的正常状态）。
      return standardOutcome(hostAllowlist);
    }
    return {
      ...standardOutcome(hostAllowlist),
      diagnostic: `${FORK_TOOL_MODE_STATE_FILENAME} 读取失败（${(error as NodeJS.ErrnoException).code ?? "unknown"}），已回退系统默认`,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(stateText);
  } catch {
    return {
      ...standardOutcome(hostAllowlist),
      diagnostic: `${FORK_TOOL_MODE_STATE_FILENAME} 不是合法 JSON，已回退系统默认`,
    };
  }

  const state = parseForkToolModeStateFile(raw);

  // 关闭注入：空数组 = 一条工具都不注册（MCP 同样为空，白名单覆盖 MCP 注册）。
  if (!state.injectTools) {
    return { mode: state.mode, injectTools: false, toolAllowlist: [] };
  }

  const modeToolNames = resolveForkToolModeToolNames(state.mode);
  // 标准档：不加档位约束，名单回到宿主名单本身（可能 undefined）。
  if (!modeToolNames) {
    return standardOutcome(hostAllowlist, state.mode);
  }

  const toolAllowlist =
    hostAllowlist && hostAllowlist.length > 0
      ? modeToolNames.filter((name) => hostAllowlist.includes(name))
      : modeToolNames;
  return { mode: state.mode, injectTools: true, toolAllowlist };
}

function standardOutcome(
  hostAllowlist: readonly string[] | undefined,
  mode: ForkToolMode = "standard",
): ForkToolModeOutcome {
  return {
    mode,
    injectTools: true,
    ...(hostAllowlist === undefined ? {} : { toolAllowlist: hostAllowlist }),
  };
}
