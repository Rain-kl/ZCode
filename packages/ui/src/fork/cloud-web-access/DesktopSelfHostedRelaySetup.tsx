import { useState, type FormEvent } from "react";
import { LoaderCircle, ServerCog } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { toast } from "@/components/ui/toast.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import type { DesktopSelfHostedRelaySetupProps } from "./contract.js";

export function DesktopSelfHostedRelaySetup({
  current,
  onConfigured,
}: DesktopSelfHostedRelaySetupProps) {
  const platform = usePlatform();
  const { intl } = useZCodeIntl();
  const [endpoint, setEndpoint] = useState(current?.endpoint ?? "");
  const [username, setUsername] = useState(current?.username ?? "");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const configure = platform.configureWebRemoteControlRelay;
    if (!configure) {
      toast(intl.formatMessage({ id: "webRemoteControl.selfHosted.unavailable" }));
      return;
    }
    setSubmitting(true);
    try {
      const result = await configure({ endpoint, username, password });
      setPassword("");
      onConfigured(result);
      toast(intl.formatMessage({ id: "webRemoteControl.selfHosted.configured" }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast(
        intl.formatMessage(
          { id: "webRemoteControl.selfHosted.configureFailed" },
          { error: message },
        ),
      );
      logger.error("[DesktopSelfHostedRelaySetup] 配置自建 Relay 失败", {
        error: message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      data-testid="web-remote-control-self-hosted-setup"
      className="flex flex-1 flex-col justify-center gap-4 px-4 py-6"
      onSubmit={(event) => void submit(event)}
    >
      <div className="space-y-2 text-center">
        <ServerCog className="mx-auto size-8 text-foreground-subtle" />
        <h3 className="text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "webRemoteControl.selfHosted.title" })}
        </h3>
        <p className="text-ui-base/relaxed text-foreground-subtle">
          {intl.formatMessage({
            id: "webRemoteControl.selfHosted.description",
          })}
        </p>
      </div>
      <label className="space-y-1.5 text-ui-base text-foreground">
        <span>{intl.formatMessage({ id: "webRemoteControl.selfHosted.endpoint" })}</span>
        <Input
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
          placeholder="https://relay.example.com"
          autoCapitalize="none"
          autoCorrect="off"
          required
        />
      </label>
      <label className="space-y-1.5 text-ui-base text-foreground">
        <span>{intl.formatMessage({ id: "webRemoteControl.selfHosted.username" })}</span>
        <Input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          required
        />
      </label>
      <label className="space-y-1.5 text-ui-base text-foreground">
        <span>{intl.formatMessage({ id: "webRemoteControl.selfHosted.password" })}</span>
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      <Button type="submit" disabled={submitting} className="gap-2 enabled:cursor-pointer">
        {submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
        {intl.formatMessage({ id: "webRemoteControl.selfHosted.connect" })}
      </Button>
    </form>
  );
}
