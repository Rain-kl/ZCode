/**
 * 设置 → 基础设置 → 同步：WebDAV 备份恢复的管理面。
 *
 * 内容：连接配置与状态、开启自动同步、保留份数、云端备份、远端备份包列表（可恢复任意节点、可删除）、
 * 冲突提示。恢复是整份覆盖，确认框里说明会先自动备份当前本地配置。
 * 见 docs/features/local-mode/design.md 第 6.6 节。
 */
import { useCallback, useState } from "react";
import { AlertTriangle, Cloud, RefreshCw, Trash2, Upload } from "lucide-react";
import {
  FORK_WEBDAV_MAX_RETENTION_LIMIT,
  FORK_WEBDAV_MIN_RETENTION_LIMIT,
  type ForkWebdavBackup,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { useAlertDialog } from "@/hooks/useAlertDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard } from "@/settings/SettingsPageParts.js";
import { useForkWebdav } from "@/fork/local-mode/useForkWebdav.js";
import { WebdavConnectionForm } from "@/fork/local-mode/WebdavConnectionForm.js";

function formatBackupTime(backup: ForkWebdavBackup): string {
  const source = backup.createdAt || backup.lastModified || "";
  const parsed = Date.parse(source);
  if (!Number.isFinite(parsed)) {
    return backup.key;
  }
  return new Date(parsed).toLocaleString();
}

function formatSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function ConfigSyncPanel() {
  const { intl } = useZCodeIntl();
  const requestAlert = useAlertDialog();
  const controller = useForkWebdav();
  const t = useCallback(
    (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values),
    [intl],
  );

  const [retentionDraft, setRetentionDraft] = useState<string>("");

  const status = controller.status;
  const configured = status?.configured === true;
  const retentionValue = retentionDraft || String(status?.retentionLimit ?? "");

  if (!controller.available) {
    return (
      <p className="text-ui-base text-foreground-subtle">{t("settings.configSync.unavailable")}</p>
    );
  }

  const handleRestore = async (backup: ForkWebdavBackup) => {
    const confirmed = await requestAlert({
      title: t("settings.configSync.restoreConfirmTitle"),
      description: t("settings.configSync.restoreConfirmBody", { key: backup.key }),
      actionLabel: t("settings.configSync.restore"),
    });
    if (confirmed) {
      await controller.restoreBackup(backup.key);
    }
  };

  const handleDelete = async (backup: ForkWebdavBackup) => {
    const confirmed = await requestAlert({
      title: t("settings.configSync.deleteConfirmTitle"),
      description: t("settings.configSync.deleteConfirmBody", { key: backup.key }),
      actionLabel: t("settings.configSync.delete"),
    });
    if (confirmed) {
      await controller.deleteBackup(backup.key);
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-ui-base text-foreground-subtle">{t("settings.configSync.description")}</p>

      {(controller.error ?? status?.lastError) ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-ui-base text-foreground">
          {controller.error ?? status?.lastError}
        </div>
      ) : null}

      {status?.phase === "conflict" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-ui-base">
          <AlertTriangle className="size-4" />
          <span className="flex-1">{t("settings.configSync.conflictBanner")}</span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={controller.busy}
            onClick={() => void controller.resolveConflict("use-remote-latest")}
          >
            {t("settings.configSync.conflictUseRemote")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={controller.busy}
            onClick={() => void controller.resolveConflict("keep-local")}
          >
            {t("settings.configSync.conflictKeepLocal")}
          </Button>
        </div>
      ) : null}

      <SettingsGroupCard>
        <div className="space-y-4 px-4 py-4">
          <div className="flex items-center gap-2 text-ui-base font-semibold">
            <Cloud className="size-4" />
            {t("settings.configSync.connectionTitle")}
          </div>

          {!configured ? (
            <WebdavConnectionForm controller={controller} />
          ) : (
            <div className="space-y-3">
              <div className="text-ui-base text-foreground">
                <div className="text-foreground-subtle">{t("settings.configSync.connectedAs")}</div>
                <div className="font-medium">
                  {status?.username} @ {status?.url}
                  {status?.directory}
                </div>
                <div className="mt-1 text-foreground-subtle">
                  {status?.lastSyncAt
                    ? t("settings.configSync.lastSyncAt", {
                        time: new Date(status.lastSyncAt).toLocaleString(),
                      })
                    : t("settings.configSync.neverSynced")}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={controller.busy}
                  onClick={() => void controller.backupNow()}
                >
                  <Upload className="size-4" />
                  {t("settings.configSync.backupNow")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={controller.busy}
                  onClick={() => void controller.refresh()}
                >
                  <RefreshCw className="size-4" />
                  {t("settings.configSync.refresh")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={controller.busy}
                  onClick={() => void controller.disconnect()}
                >
                  {t("settings.configSync.disconnect")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </SettingsGroupCard>

      {configured ? (
        <>
          <SettingsGroupCard>
            <div className="space-y-4 px-4 py-4">
              <div className="text-ui-base font-semibold">
                {t("settings.configSync.behaviorTitle")}
              </div>
              <label className="flex items-center justify-between gap-4">
                <span className="text-ui-base">{t("settings.configSync.autoSyncLabel")}</span>
                <Switch
                  checked={status?.autoSync === true}
                  disabled={controller.busy}
                  onCheckedChange={(checked) =>
                    void controller.updateSettings({ autoSync: checked })
                  }
                />
              </label>
              <div className="flex items-center justify-between gap-4">
                <span className="text-ui-base">{t("settings.configSync.retentionLabel")}</span>
                <Input
                  className="w-24"
                  inputMode="numeric"
                  value={retentionValue}
                  onChange={(event) => setRetentionDraft(event.target.value)}
                  onBlur={() => {
                    const parsed = Number.parseInt(retentionDraft, 10);
                    setRetentionDraft("");
                    if (Number.isFinite(parsed)) {
                      void controller.updateSettings({ retentionLimit: parsed });
                    }
                  }}
                />
              </div>
              <p className="text-ui-base text-foreground-subtle">
                {t("settings.configSync.retentionHint", {
                  min: FORK_WEBDAV_MIN_RETENTION_LIMIT,
                  max: FORK_WEBDAV_MAX_RETENTION_LIMIT,
                })}
              </p>
            </div>
          </SettingsGroupCard>

          <SettingsGroupCard>
            <div className="space-y-2 px-4 py-4">
              <div className="text-ui-base font-semibold">
                {t("settings.configSync.backupsTitle")}
              </div>
              {controller.backups.length === 0 ? (
                <p className="text-ui-base text-foreground-subtle">
                  {t("settings.configSync.backupsEmpty")}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {controller.backups.map((backup) => (
                    <li key={backup.key} className="flex items-center gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-ui-base text-foreground">
                          {formatBackupTime(backup)}
                        </div>
                        <div className="truncate text-ui-base text-foreground-subtle">
                          {backup.key} · {formatSize(backup.size)}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={controller.busy}
                        onClick={() => void handleRestore(backup)}
                      >
                        {t("settings.configSync.restore")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={t("settings.configSync.delete")}
                        disabled={controller.busy}
                        onClick={() => void handleDelete(backup)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </SettingsGroupCard>
        </>
      ) : null}
    </div>
  );
}
