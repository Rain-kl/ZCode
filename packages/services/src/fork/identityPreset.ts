/**
 * 系统指令（fork）服务面：`~/.zcode/presets/` 的唯一写入口。
 *
 * 数据契约在 `@zcode/shared` 的 `fork/identity-preset-contract.js`；这里加 `Event` 成员，
 * 因为 `Event` 来自 `@zcode/rpc`，只有 services 层依赖它（与 fork WebDAV 服务同构）。
 * 见 FEATURES.md 的 identity-preset 条目与 docs/features/identity-preset/design.md 第 8 节。
 */
import type { Event } from "@zcode/rpc";
import {
  FORK_IDENTITY_PRESET_CHANNEL,
  type ForkIdentityPresetProfile,
  type ForkIdentityPresetState,
  type ForkIdentityPresetTemplateId,
} from "@zcode/shared";

import { createServiceDescriptor } from "../descriptors.js";

export interface IForkIdentityPresetService {
  getState(): Promise<ForkIdentityPresetState>;
  setEnabled(enabled: boolean): Promise<ForkIdentityPresetState>;
  /** 是否注入动态段（环境/git/风格指导/上下文管理）；关闭后系统提示词只剩身份段。 */
  setInjectDynamic(injectDynamic: boolean): Promise<ForkIdentityPresetState>;
  createProfile(input: {
    name: string;
    template: ForkIdentityPresetTemplateId;
  }): Promise<ForkIdentityPresetState>;
  readProfile(id: string): Promise<ForkIdentityPresetProfile>;
  saveProfile(input: {
    id: string;
    name: string;
    content: string;
  }): Promise<ForkIdentityPresetState>;
  deleteProfile(id: string): Promise<ForkIdentityPresetState>;
  activateProfile(id: string | null): Promise<ForkIdentityPresetState>;
  /** 状态变化订阅（开关、激活项、配置集合变化）。属性式 Event：渲染层用 `service.onStateChanged(listener)`。 */
  onStateChanged: Event<ForkIdentityPresetState>;
}

export const IForkIdentityPresetService = createServiceDescriptor<IForkIdentityPresetService>(
  FORK_IDENTITY_PRESET_CHANNEL,
);
