// 设置页「搜索」栏目；见 FEATURES.md 的 search-providers 条目
import type { ReactNode } from "react";
import { Globe, Lock } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useForkSearchProviders } from "./useForkSearchProviders.js";
import { ChannelList } from "./ChannelList.js";
import { AddChannelDialog } from "./ChannelDialogs.js";

/**
 * 服务端搜索启用状态。
 *
 * 需求与设计规范明确约束：
 * 1. 设置页内无单一活动模型概念（只有模型提供商与模型配置列表）；
 * 2. 严禁为显示此状态新建第二套活动模型读取；
 * 3. 拿不到活动模型时降级为静态说明（返回 undefined）。
 */
export function readActiveModelNativeSearchEnabled(): boolean | undefined {
  return undefined;
}

function FormattedMessage({ id }: { id: string }): ReactNode {
  const { intl } = useZCodeIntl();
  return <>{intl.formatMessage({ id })}</>;
}

/** 只读首行：链条的第一环，不可拖不可禁，视觉上区别于可编辑渠道。 */
function ServerChannelRow({ enabled }: { enabled?: boolean }) {
  const { intl } = useZCodeIntl();
  return (
    <div
      className="flex items-center justify-between p-3.5 rounded-lg border border-input-border/60 bg-muted/40"
      data-testid="search-providers-server-channel"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center justify-center size-8 rounded bg-background border border-input-border/40 shrink-0 text-foreground-subtle">
          <Globe className="size-4" />
        </div>
        <div className="min-w-0 flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-ui-sm font-medium text-foreground">
              {intl.formatMessage({ id: "settings.searchProviders.serverChannel" })}
            </span>
            {enabled !== undefined ? (
              <span
                className={cn(
                  "text-ui-xs px-2 py-0.5 rounded-full font-medium",
                  enabled
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "bg-muted text-foreground-subtle border border-input-border/40",
                )}
              >
                {intl.formatMessage({
                  id: enabled
                    ? "settings.searchProviders.serverChannelEnabled"
                    : "settings.searchProviders.serverChannelDisabled",
                })}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="text-ui-xs text-foreground-subtle shrink-0 flex items-center gap-1">
        <Lock className="size-3.5 text-foreground-subtle/70" />
      </div>
    </div>
  );
}

export function SearchProvidersSection() {
  const controller = useForkSearchProviders();
  const serverNativeEnabled = readActiveModelNativeSearchEnabled();

  if (!controller.available) {
    return (
      <p className="text-ui-sm text-foreground-subtle" data-testid="search-providers-unavailable">
        <FormattedMessage id="settings.searchProviders.unavailable" />
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4 max-w-2xl" data-testid="search-providers-section">
      {controller.error ? (
        <div className="text-ui-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3">
          {controller.error}
        </div>
      ) : null}
      {/* 只读首行：链条的第一环，不可拖不可禁 */}
      <ServerChannelRow enabled={serverNativeEnabled} />
      {/* 渠道列表：拖拽排序 + 启用开关 + 备注 + 删除 */}
      <ChannelList controller={controller} />
      <AddChannelDialog onSubmit={controller.add} disabled={controller.busy} />
      <p className="text-ui-sm text-foreground-subtle">
        <FormattedMessage id="settings.searchProviders.priorityHint" />
      </p>
      <p className="text-ui-sm text-foreground-subtle">
        <FormattedMessage id="settings.searchProviders.keySyncHint" />
      </p>
    </div>
  );
}
