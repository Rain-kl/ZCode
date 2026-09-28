/**
 * WebDAV 连接表单：设置页「同步」栏目与首屏引导共用（设计 6.5「与首屏登录卡共用同一组件」）。
 *
 * 只负责表单与连接动作；是否显示跳过按钮由调用方决定。
 */
import { useState } from "react";
import { FORK_WEBDAV_DEFAULT_DIRECTORY, type ForkWebdavCredentials } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { ForkWebdavController } from "@/fork/local-mode/useForkWebdav.js";

export function WebdavConnectionForm({
  controller,
  onSkip,
}: {
  controller: ForkWebdavController;
  onSkip?: () => void;
}) {
  const { intl } = useZCodeIntl();
  const [form, setForm] = useState<ForkWebdavCredentials>({
    url: "",
    username: "",
    password: "",
    directory: FORK_WEBDAV_DEFAULT_DIRECTORY,
  });
  const [testResult, setTestResult] = useState<string | null>(null);

  const update = (patch: Partial<ForkWebdavCredentials>) =>
    setForm((current) => ({ ...current, ...patch }));
  const canSubmit = Boolean(form.url && form.username && form.password);

  return (
    <div className="space-y-3">
      <Input
        value={form.url}
        placeholder={intl.formatMessage({ id: "settings.configSync.urlPlaceholder" })}
        onChange={(event) => update({ url: event.target.value })}
      />
      <Input
        value={form.username}
        placeholder={intl.formatMessage({ id: "settings.configSync.usernamePlaceholder" })}
        onChange={(event) => update({ username: event.target.value })}
      />
      <Input
        type="password"
        value={form.password}
        placeholder={intl.formatMessage({ id: "settings.configSync.passwordPlaceholder" })}
        onChange={(event) => update({ password: event.target.value })}
      />
      <Input
        value={form.directory}
        placeholder={FORK_WEBDAV_DEFAULT_DIRECTORY}
        onChange={(event) => update({ directory: event.target.value })}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={controller.busy || !form.url || !form.username}
          onClick={() => {
            void controller.testConnection(form).then((result) => {
              setTestResult(
                result.ok
                  ? intl.formatMessage({ id: "settings.configSync.testOk" })
                  : (result.error ?? ""),
              );
            });
          }}
        >
          {intl.formatMessage({ id: "settings.configSync.testConnection" })}
        </Button>
        <Button
          type="button"
          disabled={controller.busy || !canSubmit}
          onClick={() => void controller.configure(form)}
        >
          {intl.formatMessage({ id: "settings.configSync.signIn" })}
        </Button>
        {onSkip ? (
          <Button type="button" variant="ghost" disabled={controller.busy} onClick={onSkip}>
            {intl.formatMessage({ id: "settings.configSync.firstRun.skip" })}
          </Button>
        ) : null}
      </div>
      {testResult ? <p className="text-ui-base text-foreground-subtle">{testResult}</p> : null}
    </div>
  );
}
