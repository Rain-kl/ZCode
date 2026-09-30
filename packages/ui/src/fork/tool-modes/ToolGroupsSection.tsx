/**
 * 设置 → Agent 能力 → 功能组。
 *
 * 总开关「注入工具」+ 工具模式三选一（极简 / 基础 / 标准）。档位用三张并列的卡片呈现：
 * 三档是包含关系（标准 ⊃ 基础 ⊃ 极简），三张卡片能把「每档换来的工具面」摊在同一屏里比较，
 * 下拉框一次只显示一项。卡片顺序 = `FORK_TOOL_MODES` 的数组顺序（能力递增）。
 * 工具面在会话创建时冻结，所以面板必须明说「对新会话生效」。
 * 逐工具清单不在渲染层：工具名的权威来源是 core 的注册表分类，这里只呈现档位与后果。
 *
 * 卡片不套 SettingsGroupCard：组卡是「设置行」的容器（行间靠 border-t 分隔），卡片是并列的
 * 可选项，两层卡面叠起来后选中态底色与组卡底色分不清层级（DESIGN.md 的 Cards and Panels）。
 * 选中态沿用仓库既有的可选中卡片语言：border-foreground/60 + bg-card-selected + 小圆点对勾。
 */
import { Check } from "lucide-react";
import {
  FORK_TOOL_MODES,
  TID_SETTINGS_TOOL_GROUPS_INJECT_SWITCH,
  TID_SETTINGS_TOOL_GROUPS_MODE_CARD,
  testId,
} from "@zcode/shared";

import { cn } from "@/components/lib/utils.js";
import { Switch } from "@/components/ui/switch.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

import { forkToolModeSummaryId, forkToolModeTitleId } from "./modeCopy.js";
import { useForkToolMode } from "./useForkToolMode.js";

export function ToolGroupsSection() {
  const { intl } = useZCodeIntl();
  const controller = useForkToolMode();
  const t = (id: string) => intl.formatMessage({ id });

  if (!controller.available) {
    return (
      <SettingsGroupCard>
        <div className="px-4 py-3 text-ui-base text-foreground-subtle">
          {t("settings.toolGroups.unavailable")}
        </div>
      </SettingsGroupCard>
    );
  }

  const injectTools = controller.state?.injectTools ?? true;
  const mode = controller.state?.mode ?? "standard";
  const disabled = controller.busy || !injectTools;

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
      </SettingsGroupCard>

      <div className="space-y-3">
        <div className="text-ui-base font-medium text-foreground">
          {t("settings.toolGroups.mode")}
        </div>
        {/* 三张卡片是单选式按钮（aria-pressed），不是 radiogroup：卡片整块可点、没有 roving tabindex，
            与设置页既有的卡片选择器（onboarding 的 UI 模式）同一套语义。 */}
        <div
          role="group"
          aria-label={t("settings.toolGroups.mode")}
          className="grid grid-cols-1 gap-4 sm:grid-cols-3"
        >
          {FORK_TOOL_MODES.map((candidate) => {
            const selected = candidate === mode;
            return (
              <button
                key={candidate}
                type="button"
                aria-pressed={selected}
                disabled={disabled}
                // 已选中的档位不再写一次盘：点击的必要条件是「换一档」。
                onClick={() => {
                  if (!selected) void controller.setMode(candidate);
                }}
                data-testid={testId(TID_SETTINGS_TOOL_GROUPS_MODE_CARD, candidate)}
                className={cn(
                  "flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                  selected
                    ? "border-foreground/60 bg-card-selected"
                    : "border-card-border bg-card hover:border-border-hover hover:bg-surface-hover disabled:hover:border-card-border disabled:hover:bg-card",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="text-ui-base font-medium text-foreground">
                    {t(forkToolModeTitleId(candidate))}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "ml-auto flex size-4 shrink-0 items-center justify-center rounded-full border",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border",
                    )}
                  >
                    {selected ? <Check className="size-3" /> : null}
                  </span>
                </span>
                <span className="text-ui-sm leading-relaxed text-foreground-subtle">
                  {t(forkToolModeSummaryId(candidate))}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-ui-sm leading-relaxed text-foreground-subtle">
          {injectTools
            ? t("settings.toolGroups.takesEffectOnNewSessionHint")
            : t("settings.toolGroups.injectionOffHint")}
        </p>
      </div>

      {controller.error ? (
        <div className="rounded-lg border border-destructive/40 px-4 py-3 text-ui-sm text-destructive">
          {controller.error}
        </div>
      ) : null}
    </div>
  );
}
