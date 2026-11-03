import { useState } from "react";
import { ZCodeAppLogo } from "@zcode/ui/app-logo";
import { Button } from "@zcode/ui";
import {
  SelfHostedRemoteAuthError,
  type SelfHostedRemoteCredentials,
} from "#src/web-remote-control/index.js";

interface WebLoginPageProps {
  onLogin: (credentials: SelfHostedRemoteCredentials) => Promise<void>;
}

// FORK-BEGIN(cloud-web-access)
export function WebLoginPage({ onLogin }: WebLoginPageProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<"invalid-credentials" | "relay-unavailable" | null>(null);
  const zh = (document.documentElement.lang || navigator.language).toLowerCase().startsWith("zh");
  const submit = async () => {
    if (!username.trim() || !password || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onLogin({ username, password });
    } catch (caught) {
      setError(caught instanceof SelfHostedRemoteAuthError ? caught.reason : "relay-unavailable");
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-8 text-foreground">
      <section className="w-full max-w-sm rounded-lg border border-card-border bg-card p-5 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <ZCodeAppLogo className="size-10" />
          <div className="min-w-0">
            <div className="text-ui-xs font-medium text-foreground">ZCode</div>
            <h1 className="text-ui-lg font-medium text-foreground">
              {zh ? "登录自建远控" : "Sign In to Self-hosted Remote"}
            </h1>
          </div>
        </div>
        <p className="mb-5 text-ui-xs leading-6 text-foreground-subtle">
          {zh
            ? "使用部署 Relay 时设置的统一账号密码。它只用于远控连接，不会修改模型账号。"
            : "Use the account configured for this Relay. It does not change your model credentials."}
        </p>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="block space-y-1.5 text-ui-sm font-medium">
            <span>{zh ? "账号" : "Username"}</span>
            <input
              name="username"
              autoComplete="username"
              value={username}
              disabled={isSubmitting}
              onChange={(event) => setUsername(event.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 font-normal outline-none focus:border-primary"
            />
          </label>
          <label className="block space-y-1.5 text-ui-sm font-medium">
            <span>{zh ? "密码" : "Password"}</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={isSubmitting}
              onChange={(event) => setPassword(event.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 font-normal outline-none focus:border-primary"
            />
          </label>
          {error ? (
            <p role="alert" className="text-ui-sm text-destructive">
              {error === "invalid-credentials"
                ? zh
                  ? "账号或密码错误。"
                  : "The username or password is incorrect."
                : zh
                  ? "无法连接远控服务，请检查网络后重试。"
                  : "The remote service is unavailable. Check your connection and try again."}
            </p>
          ) : null}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={isSubmitting || !username.trim() || !password}
          >
            {isSubmitting ? (zh ? "正在登录…" : "Signing in…") : zh ? "登录" : "Sign In"}
          </Button>
        </form>
      </section>
    </main>
  );
}
// FORK-END(cloud-web-access)
