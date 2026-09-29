/**
 * 设置 → Agent 能力 → 系统指令 的数据入口。
 *
 * 只经 `IServiceAccessor.forkIdentityPresetService` 访问 host（web / 远端环境没有该服务时为 undefined），
 * 订阅服务状态事件并向上暴露操作；错误统一落到 `error` 由栏目展示。
 * 文件与状态的唯一写入方是 host 服务，这里不做任何本地持久化——
 * 否则会出现「UI 显示已保存、agent 读到的还是旧内容」。
 *
 * FORK(rpc-channel-manifest): 能力缺席表现为「成员为 undefined」而不是「一次超时错误」；
 * 对端通道清单到达前不发任何探测调用，见 FEATURES.md 的 rpc-channel-manifest 条目。
 * 见 docs/features/identity-preset/design.md 第 6、8 节。
 */
import { useCallback, useEffect, useState } from "react";
import type {
  ForkIdentityPresetProfile,
  ForkIdentityPresetState,
  ForkIdentityPresetTemplateId,
} from "@zcode/shared";

import { useServices } from "@/hooks/useServices.js";
import { useChannelServiceUsable } from "@/hooks/useChannelAvailabilityReady.js";

export interface ForkIdentityPresetController {
  /** host 未提供该服务（web / 远端环境）时为 false。 */
  available: boolean;
  state: ForkIdentityPresetState | null;
  /** 正在执行一次用户操作（按钮禁用用）。 */
  busy: boolean;
  /** 最近一次操作失败的原因（栏目内展示）。 */
  error: string | null;
  refresh(): Promise<void>;
  loadProfile(id: string): Promise<ForkIdentityPresetProfile | null>;
  setEnabled(enabled: boolean): Promise<void>;
  createProfile(input: {
    name: string;
    template: ForkIdentityPresetTemplateId;
  }): Promise<string | null>;
  saveProfile(input: { id: string; name: string; content: string }): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  activateProfile(id: string | null): Promise<void>;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useForkIdentityPreset(): ForkIdentityPresetController {
  const services = useServices();
  const service = services.forkIdentityPresetService;
  const [state, setState] = useState<ForkIdentityPresetState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // FORK(rpc-channel-manifest): usable 表示「清单已到且含该通道」，用它门住所有调用；
  // 清单缺席时 service 为 undefined，available 即「当前环境不支持」，不产生错误状态。
  // 见 FEATURES.md 的 rpc-channel-manifest 条目
  const usable = useChannelServiceUsable(service);

  const run = useCallback(async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (caught) {
      setError(toMessage(caught));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!usable || !service) return;
    const next = await run(() => service.getState());
    if (next) setState(next);
  }, [run, service, usable]);

  useEffect(() => {
    if (!usable || !service) return;
    let active = true;
    void service.getState().then(
      (next) => {
        if (active) setState(next);
      },
      (caught: unknown) => {
        if (active) setError(toMessage(caught));
      },
    );
    // 属性式 Event：渲染层用 `service.onStateChanged(listener)`。
    const subscription = service.onStateChanged((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
      subscription.dispose();
    };
  }, [service, usable]);

  return {
    available: Boolean(service),
    state,
    busy,
    error,
    refresh,
    loadProfile: async (id) => {
      if (!usable || !service) return null;
      return (await run(() => service.readProfile(id))) ?? null;
    },
    setEnabled: async (enabled) => {
      if (!usable || !service) return;
      const next = await run(() => service.setEnabled(enabled));
      if (next) setState(next);
    },
    createProfile: async (input) => {
      if (!usable || !service) return null;
      // 服务返回的是新 state，不含新 id；从列表差集里取，避免再引入一个「最近创建」字段。
      const before = new Set((state?.profiles ?? []).map((profile) => profile.id));
      const next = await run(() => service.createProfile(input));
      if (!next) return null;
      setState(next);
      return next.profiles.find((profile) => !before.has(profile.id))?.id ?? null;
    },
    saveProfile: async (input) => {
      if (!usable || !service) return;
      const next = await run(() => service.saveProfile(input));
      if (next) setState(next);
    },
    deleteProfile: async (id) => {
      if (!usable || !service) return;
      const next = await run(() => service.deleteProfile(id));
      if (next) setState(next);
    },
    activateProfile: async (id) => {
      if (!usable || !service) return;
      const next = await run(() => service.activateProfile(id));
      if (next) setState(next);
    },
  };
}
