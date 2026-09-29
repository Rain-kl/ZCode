/**
 * 功能组（fork）宿主服务：把工具模式状态暴露成 RPC 面并在写操作后广播。
 * 见 FEATURES.md 的 tool-modes 条目与 docs/features/tool-modes/design.md 第 7 节。
 */
import { Emitter } from "@zcode/rpc";
import { buildForkToolModeState, type ForkToolModeState } from "@zcode/shared";
import type { IForkToolModeService } from "@zcode/services";

import { createFileToolModeStore } from "./store.js";

export function createForkToolModeService(input: { path: string }): IForkToolModeService {
  const store = createFileToolModeStore({ path: input.path });
  const emitter = new Emitter<ForkToolModeState>();

  const buildState = async (): Promise<ForkToolModeState> =>
    buildForkToolModeState(await store.read());

  const mutate = async (action: () => Promise<unknown>): Promise<ForkToolModeState> => {
    await action();
    const state = await buildState();
    // 事件在写盘之后发出：渲染层否则会先拿到旧值再自己刷新一次。
    emitter.fire(state);
    return state;
  };

  return {
    getState: buildState,
    setInjectTools: (injectTools) => mutate(() => store.setInjectTools(injectTools)),
    setMode: (mode) => mutate(() => store.setMode(mode)),
    onStateChanged: emitter.event,
  };
}
