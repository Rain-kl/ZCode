/**
 * 功能组（fork）：工具模式与注入开关的宿主侧存储。
 *
 * 单份 JSON 文件（`<storageRoot>/tool-groups.json`），与身份配置同级的用户级状态。
 * 宿主是唯一写入方；agent 侧不读这个文件——宿主在会话创建期把它翻译成 `toolDenylist` 下发。
 * 见 FEATURES.md 的 tool-modes 条目与 docs/features/tool-modes/design.md 第 5、6 节。
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  FORK_TOOL_MODE_STATE_SCHEMA_VERSION,
  parseForkToolModeStateFile,
  type ForkToolMode,
  type ForkToolModeStateFile,
} from "@zcode/shared";

export class ToolModeStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ToolModeStoreError";
  }
}

export interface ToolModeStore {
  read(): Promise<ForkToolModeStateFile>;
  setInjectTools(injectTools: boolean): Promise<ForkToolModeStateFile>;
  setMode(mode: ForkToolMode): Promise<ForkToolModeStateFile>;
}

export function createFileToolModeStore(input: { path: string }): ToolModeStore {
  const filePath = input.path;

  const write = async (state: ForkToolModeStateFile): Promise<ForkToolModeStateFile> => {
    try {
      await mkdir(dirname(filePath), { recursive: true });
      // 原子写：半写的状态文件会让下一次读取回落成「标准」，用户会以为自己的选择被吞了。
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await rename(temporaryPath, filePath);
    } catch (error) {
      throw new ToolModeStoreError(`写入 ${filePath} 失败，请检查该目录是否可写`, { cause: error });
    }
    return state;
  };

  return {
    async read() {
      try {
        return parseForkToolModeStateFile(JSON.parse(await readFile(filePath, "utf8")));
      } catch {
        // 文件缺失或损坏：回落「标准 + 注入」。绝不在这里写盘——一次读取失败不该覆写用户选择。
        return parseForkToolModeStateFile(undefined);
      }
    },
    async setInjectTools(injectTools) {
      const current = await this.read();
      return await write({
        schemaVersion: FORK_TOOL_MODE_STATE_SCHEMA_VERSION,
        mode: current.mode,
        injectTools,
      });
    },
    async setMode(mode) {
      const current = await this.read();
      return await write({
        schemaVersion: FORK_TOOL_MODE_STATE_SCHEMA_VERSION,
        mode,
        injectTools: current.injectTools,
      });
    },
  };
}
