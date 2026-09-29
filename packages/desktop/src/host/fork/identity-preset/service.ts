/**
 * 系统指令（fork）宿主服务实现。
 *
 * 把 profile-store 暴露成 RPC 面，并在每次写操作后广播新状态：事件必须在状态写入之后发出，
 * 否则渲染层会拿到旧值再自己刷新一次，出现「刚保存又跳回旧内容」的竞态。
 * 见 FEATURES.md 的 identity-preset 条目与 docs/features/identity-preset/design.md 第 8 节。
 */
import { Emitter } from "@zcode/rpc";
import type { ForkIdentityPresetState } from "@zcode/shared";

import type { IForkIdentityPresetService } from "@zcode/services";

import { createFileIdentityPresetStore } from "./profile-store.js";

export function createForkIdentityPresetService(input: {
  root: string;
}): IForkIdentityPresetService {
  const store = createFileIdentityPresetStore({ root: input.root });
  const emitter = new Emitter<ForkIdentityPresetState>();

  const buildState = async (): Promise<ForkIdentityPresetState> => {
    const state = await store.readState();
    const profiles = await store.list();
    return {
      enabled: state.enabled,
      activeId: state.activeId,
      injectDynamic: state.injectDynamic,
      injectSkills: state.injectSkills,
      // agent 侧遇到悬空 activeId 会静默回退系统默认；这里把它显式报给 UI，
      // 否则用户会以为「开着但没生效」是 bug。
      activeMissing:
        state.enabled &&
        state.activeId !== null &&
        !profiles.some((profile) => profile.id === state.activeId),
      root: store.root,
      profiles,
    };
  };

  const mutate = async (action: () => Promise<unknown>): Promise<ForkIdentityPresetState> => {
    await action();
    const state = await buildState();
    emitter.fire(state);
    return state;
  };

  return {
    getState: buildState,
    setEnabled: (enabled) => mutate(() => store.setEnabled(enabled)),
    setInjectDynamic: (injectDynamic) => mutate(() => store.setInjectDynamic(injectDynamic)),
    setInjectSkills: (injectSkills) => mutate(() => store.setInjectSkills(injectSkills)),
    createProfile: (createInput) => mutate(() => store.create(createInput)),
    readProfile: (id) => store.read(id),
    saveProfile: (saveInput) => mutate(() => store.save(saveInput)),
    deleteProfile: (id) => mutate(() => store.remove(id)),
    activateProfile: (id) => mutate(() => store.activate(id)),
    onStateChanged: emitter.event,
  };
}
