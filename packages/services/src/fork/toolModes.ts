/**
 * 功能组（fork）服务面：工具模式与工具注入开关。
 *
 * 数据契约在 `@zcode/shared` 的 `fork/tool-modes-contract.js`；这里加 `Event` 成员，
 * 因为 `Event` 来自 `@zcode/rpc`，只有 services 层依赖它（与 fork WebDAV / identityPreset 同构）。
 * 见 FEATURES.md 的 tool-modes 条目与 docs/features/tool-modes/design.md 第 7 节。
 */
import type { Event } from "@zcode/rpc";
import { FORK_TOOL_MODE_CHANNEL, type ForkToolMode, type ForkToolModeState } from "@zcode/shared";

import { createServiceDescriptor } from "../descriptors.js";

export interface IForkToolModeService {
  getState(): Promise<ForkToolModeState>;
  /** 关闭后请求不下发任何工具定义（模型只能纯文本回答）。 */
  setInjectTools(injectTools: boolean): Promise<ForkToolModeState>;
  setMode(mode: ForkToolMode): Promise<ForkToolModeState>;
  /** 状态变化订阅。属性式 Event：渲染层用 `service.onStateChanged(listener)`。 */
  onStateChanged: Event<ForkToolModeState>;
}

export const IForkToolModeService =
  createServiceDescriptor<IForkToolModeService>(FORK_TOOL_MODE_CHANNEL);
