/**
 * 设置 → Agent 能力 → 功能组 的数据入口。
 *
 * 只经 `IServiceAccessor.forkToolModeService` 访问 host（web / 远端环境没有该服务时为 undefined）。
 * 状态由宿主持有并写盘，这里不做本地持久化——否则会出现「界面显示改了、agent 读到的还是旧值」。
 * 见 docs/features/tool-modes/design.md 第 5、7 节。
 */
import { useCallback, useEffect, useState } from "react";
import type { ForkToolMode, ForkToolModeState } from "@zcode/shared";

import { useServices } from "@/hooks/useServices.js";

export interface ForkToolModeController {
  /** host 未提供该服务（web / 远端环境）时为 false。 */
  available: boolean;
  state: ForkToolModeState | null;
  busy: boolean;
  error: string | null;
  setMode(mode: ForkToolMode): Promise<void>;
  setInjectTools(injectTools: boolean): Promise<void>;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useForkToolMode(): ForkToolModeController {
  const services = useServices();
  const service = services.forkToolModeService;
  const [state, setState] = useState<ForkToolModeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<ForkToolModeState>) => {
    setBusy(true);
    setError(null);
    try {
      setState(await action());
    } catch (caught) {
      setError(toMessage(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!service) return;
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
  }, [service]);

  return {
    available: Boolean(service),
    state,
    busy,
    error,
    setMode: async (mode) => {
      if (!service) return;
      await run(() => service.setMode(mode));
    },
    setInjectTools: async (injectTools) => {
      if (!service) return;
      await run(() => service.setInjectTools(injectTools));
    },
  };
}
