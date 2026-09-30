/**
 * 设置 → Agent 能力 → 功能组。
 *
 * 总开关「注入工具」+ 工具模式三选一（极简 / 基础 / 标准）。
 * 工具面在会话创建时冻结，所以面板必须明说「对新会话生效」。
 * 逐工具清单不在渲染层：工具名的权威来源是 core 的注册表，这里只呈现档位与后果。
 * 见 docs/features/tool-modes/design.md 第 4、8 节。
 */
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { Switch } from "@/components/ui/switch.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import {
  TID_SETTINGS_TOOL_GROUPS_INJECT_SWITCH,
  TID_SETTINGS_TOOL_GROUPS_MODE_SELECT,
} from "@zcode/shared";
import type { ForkToolMode } from "@zcode/shared";

import { useForkToolMode } from "./useForkToolMode.js";

const MODE_IDS: readonly ForkToolMode[] = ["minimal", "basic", "standard"];

export function ToolGroupsSection() {
  const { intl } = useZCodeIntl();
  const controller = useForkToolMode();
  const t = (id: string) => intl.formatMessage({ id });

  if (!controller.available) {
    return <SettingsGroupCard>{t("settings.toolGroups.unavailable")}</SettingsGroupCard>;
  }

  const state = controller.state;
  const injectTools = state?.injectTools ?? true;
  const mode: ForkToolMode = state?.mode ?? "standard";
  const modeHint = !injectTools
    ? t("settings.toolGroups.hintNoTools")
    : mode === "standard"
      ? t("settings.toolGroups.hintStandard")
      : t("settings.toolGroups.hintRestricted");

  return (
    <div className="space-y-4">
      <SettingsGroupCard>
        <SettingsRow
          label={t("settings.toolGroups.injectTools")}
          description={t("settings.toolGroups.injectToolsHint")}
          control={
            <Switch
              checked={injectTools}
              disabled={controller.busy}
              onCheckedChange={(next: boolean) => void controller.setInjectTools(next)}
              data-testid={TID_SETTINGS_TOOL_GROUPS_INJECT_SWITCH}
            />
          }
        />
        <SettingsRow
          label={t("settings.toolGroups.mode")}
          description={modeHint}
          detail={
            <span className="text-ui-sm text-foreground-subtle">
              {t("settings.toolGroups.takesEffectOnNewSessionHint")}
            </span>
          }
          control={
            <Select
              value={mode}
              onValueChange={(next: string) => void controller.setMode(next as ForkToolMode)}
              disabled={controller.busy || !injectTools}
              data-testid={TID_SETTINGS_TOOL_GROUPS_MODE_SELECT}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODE_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {t(`settings.toolGroups.mode.${id}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </SettingsGroupCard>

      {controller.error ? (
        <div className="rounded-lg border border-destructive/40 px-4 py-3 text-ui-sm text-destructive">
          {controller.error}
        </div>
      ) : null}
    </div>
  );
}
