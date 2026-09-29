/**
 * 首屏 WebDAV 引导（可跳过）。
 *
 * 未配置 WebDAV 且没有跳过时展示；登录成功后由 host 自动上传/拉取配置。
 * 跳过写入 fork 状态文件（`firstRunSkipped`），之后不再自动弹出，可从设置 → 同步重新配置。
 * 见 docs/features/local-mode/design.md 第 6.5 节。
 */
import { useCallback, useEffect, useState } from "react";
import { Cloud } from "lucide-react";
import { useServices } from "@/hooks/useServices.js";
import { useChannelServiceUsable } from "@/hooks/useChannelAvailabilityReady.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useForkWebdav } from "@/fork/local-mode/useForkWebdav.js";
import { WebdavConnectionForm } from "@/fork/local-mode/WebdavConnectionForm.js";

export function FirstRunWebdavScreen({ onDone }: { onDone: () => void }) {
  const { intl } = useZCodeIntl();
  const controller = useForkWebdav();
  const configured = controller.status?.configured === true;

  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center px-6 py-10">
      <div className="w-full max-w-xl space-y-6 rounded-xl border border-border bg-card p-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <Cloud className="size-5" />
            {intl.formatMessage({ id: "settings.configSync.firstRun.title" })}
          </div>
          <p className="text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "settings.configSync.firstRun.description" })}
          </p>
        </div>

        {controller.error || controller.status?.lastError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-ui-base">
            {controller.error ?? controller.status?.lastError}
          </div>
        ) : null}

        {configured ? (
          <div className="space-y-3">
            <p className="text-ui-base">
              {intl.formatMessage({ id: "settings.configSync.firstRun.done" })}
            </p>
            <button
              type="button"
              className="text-ui-base font-medium text-primary underline-offset-4 hover:underline"
              onClick={onDone}
            >
              {intl.formatMessage({ id: "settings.configSync.firstRun.enter" })}
            </button>
          </div>
        ) : (
          <WebdavConnectionForm
            controller={controller}
            onSkip={() => {
              void controller.updateSettings({ firstRunSkipped: true }).then(onDone);
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * 首屏可见性：host 提供 WebDAV 服务、未配置、且没被跳过时展示。
 * 状态来自服务（含 `firstRunSkipped`），一旦用户配置或跳过就收起来。
 */
export function useForkWebdavFirstRunGate(): { visible: boolean; dismiss: () => void } {
  const services = useServices();
  const service = services.forkWebdavService;
  const [visible, setVisible] = useState(false);
  // FORK(rpc-channel-manifest): 清单到达前不探测（否则回不到「不支持」而是 1s 超时错误）；见 FEATURES.md 的 rpc-channel-manifest 条目
  const usable = useChannelServiceUsable(service);

  useEffect(() => {
    if (!usable || !service) {
      return;
    }
    let disposed = false;
    void service.getStatus().then((status) => {
      if (!disposed) {
        setVisible(!status.configured && !status.firstRunSkipped);
      }
    });
    const subscription = service.onStatusChanged((status) => {
      if (!disposed) {
        setVisible(!status.configured && !status.firstRunSkipped);
      }
    });
    return () => {
      disposed = true;
      subscription.dispose();
    };
  }, [service, usable]);

  const dismiss = useCallback(() => setVisible(false), []);
  return { visible, dismiss };
}
