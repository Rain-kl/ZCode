/**
 * 左下角 WebDAV 状态项：显示连接/同步/冲突/错误状态，并提供快捷操作。
 *
 * 复用被隐藏的「连接使用」位置（设计 6.7）。打开设置时通过 `setPendingSettingsSectionIntent`
 * 直接跳到「同步」栏目。
 */
import { AlertTriangle, Cloud, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { setPendingSettingsSectionIntent } from "@/lib/settingsNavigation.js";
import { openForkWebdavConflictDialog } from "@/fork/local-mode/conflictDialogBus.js";
import { useForkWebdav } from "@/fork/local-mode/useForkWebdav.js";

export function ForkWebdavStatusMenuItem({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const { intl } = useZCodeIntl();
  const controller = useForkWebdav();
  // host 未提供该服务（web / 远端环境）时不显示，避免出现永远不可用的入口。
  if (!controller.available) {
    return null;
  }

  const status = controller.status;
  const phase = status?.phase ?? "idle";
  const configured = status?.configured === true;

  const label = !configured
    ? intl.formatMessage({ id: "settings.configSync.status.notConfigured" })
    : phase === "syncing"
      ? intl.formatMessage({ id: "settings.configSync.status.syncing" })
      : phase === "conflict"
        ? intl.formatMessage({ id: "settings.configSync.status.conflict" })
        : phase === "error"
          ? intl.formatMessage({ id: "settings.configSync.status.error" })
          : intl.formatMessage({ id: "settings.configSync.status.connected" });

  const Icon = !configured
    ? CloudOff
    : phase === "syncing"
      ? Loader2
      : phase === "conflict"
        ? AlertTriangle
        : Cloud;

  const openSyncSettings = () => {
    setPendingSettingsSectionIntent("configSync");
    onOpenSettings?.();
  };

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        data-testid="fork-webdav-status-item"
        onSelect={(event) => {
          event.preventDefault();
          openSyncSettings();
        }}
      >
        <Icon className={phase === "syncing" ? "size-4 animate-spin" : "size-4"} />
        {label}
      </DropdownMenuItem>
      {configured && phase === "conflict" ? (
        <DropdownMenuItem
          data-testid="fork-webdav-resolve-conflict"
          onSelect={openForkWebdavConflictDialog}
        >
          <AlertTriangle className="size-4" />
          {intl.formatMessage({ id: "settings.configSync.conflictResolve" })}
        </DropdownMenuItem>
      ) : null}
      {configured && phase === "error" ? (
        <DropdownMenuItem
          data-testid="fork-webdav-retry"
          onSelect={() => void controller.refresh()}
        >
          <RefreshCw className="size-4" />
          {intl.formatMessage({ id: "settings.configSync.status.retry" })}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}
