/**
 * FORK(rpc-channel-manifest): 可选服务可用性的判定时机。
 *
 * 背景：`services.forkXxx` 这类可选成员在收到对端 Initialize（携带通道清单）之前一直是惰性代理，
 * 读它拿不到「不存在」，调用它则会落到服务端的「未知通道」超时逻辑上（1s 后报错）。
 * 所以「能不能发调用」必须等清单到达（`isInitialized()` 为 true）之后才能判定；
 * 而「界面显示可用还是不可用」读的是成员本身（清单缺席时为 undefined）。
 *
 * 未知清单 = 历史行为 = 视为可用：因此旧服务端（Initialize 不带清单）不会被永久判成不可用。
 * 见 FEATURES.md 的 rpc-channel-manifest 条目。
 */
import { useEffect, useState } from "react";
import type { IChannelAvailability } from "@zcode/services";
import { useServices } from "./useServices.js";

/** 清单是否已到达，可用性是否可以断言。 */
export function useChannelAvailabilityReady(availability?: IChannelAvailability): boolean {
  const [ready, setReady] = useState(() => availability?.isInitialized() ?? true);

  useEffect(() => {
    if (!availability) {
      setReady(true);
      return;
    }
    setReady(availability.isInitialized());
    // Initialize 到达时清单才成为事实；订阅后重算，让「可用」在握手完成时自动出现。
    const subscription = availability.onDidChange(() => setReady(availability.isInitialized()));
    return () => subscription.dispose();
  }, [availability]);

  return ready;
}

/** 该服务成员此刻可以安全发起调用：清单已到且清单包含该通道。 */
export function useChannelServiceUsable<T>(service: T | undefined): boolean {
  const services = useServices();
  const ready = useChannelAvailabilityReady(services.channelAvailability);
  return ready && Boolean(service);
}
