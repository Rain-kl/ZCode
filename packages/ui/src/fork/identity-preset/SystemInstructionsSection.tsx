/**
 * 设置 → Agent 能力 → 系统指令。
 *
 * 总开关 + 多组提示词配置的增删改与激活。启用后，新会话的系统提示词「身份段」
 * （cli_prefix 与身份声明）被所选配置正文替换；环境、gitStatus、上下文管理等运行时事实段保留。
 * 保存与激活都只写盘、不热切换，所以面板必须明说「对新会话生效」。
 * 见 docs/features/identity-preset/design.md 第 6、8 节。
 */
import { useCallback, useState } from "react";
import { FilePlus2, Pencil, Trash2 } from "lucide-react";
import type { ForkIdentityPresetTemplateId } from "@zcode/shared";

import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useAlertDialog } from "@/hooks/useAlertDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard } from "@/settings/SettingsPageParts.js";
import {
  testId,
  TID_SETTINGS_SYSTEM_INSTRUCTIONS_ACTIVATE,
  TID_SETTINGS_SYSTEM_INSTRUCTIONS_CREATE,
  TID_SETTINGS_SYSTEM_INSTRUCTIONS_DELETE,
  TID_SETTINGS_SYSTEM_INSTRUCTIONS_EDIT,
  TID_SETTINGS_SYSTEM_INSTRUCTIONS_SAVE,
  TID_SETTINGS_SYSTEM_INSTRUCTIONS_SWITCH,
  TID_SETTINGS_SYSTEM_INSTRUCTIONS_TEMPLATE,
} from "@zcode/shared";

import { useForkIdentityPreset } from "./useForkIdentityPreset.js";

interface EditorState {
  id: string;
  name: string;
  content: string;
}

export function SystemInstructionsSection() {
  const { intl } = useZCodeIntl();
  const controller = useForkIdentityPreset();
  const requestAlert = useAlertDialog();
  const [newName, setNewName] = useState("");
  const [template, setTemplate] = useState<ForkIdentityPresetTemplateId>("default");
  const [editor, setEditor] = useState<EditorState | null>(null);

  const t = useCallback(
    (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values),
    [intl],
  );

  if (!controller.available) {
    return <SettingsGroupCard>{t("settings.systemInstructions.unavailable")}</SettingsGroupCard>;
  }

  const state = controller.state;
  const enabled = state?.enabled ?? false;

  const startCreate = async () => {
    const createdId = await controller.createProfile({ name: newName, template });
    if (!createdId) return;
    setNewName("");
    const profile = await controller.loadProfile(createdId);
    if (profile) setEditor({ id: profile.id, name: profile.name, content: profile.content });
  };

  const startEdit = async (id: string) => {
    const profile = await controller.loadProfile(id);
    if (profile) setEditor({ id: profile.id, name: profile.name, content: profile.content });
  };

  const confirmDelete = async (id: string, name: string) => {
    const approved = await requestAlert({
      title: t("settings.systemInstructions.delete.title"),
      description: t("settings.systemInstructions.delete.body", { name }),
      actionLabel: t("settings.systemInstructions.delete.confirm"),
    });
    if (!approved) return;
    await controller.deleteProfile(id);
    setEditor((current) => (current?.id === id ? null : current));
  };

  return (
    <div className="space-y-3">
      <SettingsGroupCard>
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <div className="space-y-1">
            <div className="text-ui-base font-medium">
              {t("settings.systemInstructions.enable")}
            </div>
            <div className="text-ui-sm text-foreground-subtle">
              {t("settings.systemInstructions.enableHint")}
            </div>
          </div>
          <Switch
            checked={enabled}
            disabled={controller.busy}
            onCheckedChange={(next: boolean) => void controller.setEnabled(next)}
            data-testid={TID_SETTINGS_SYSTEM_INSTRUCTIONS_SWITCH}
          />
        </div>
      </SettingsGroupCard>

      <div className="px-1 text-ui-sm text-foreground-subtle">
        {t("settings.systemInstructions.takesEffectOnNewSession")}
      </div>

      {controller.error ? (
        <div className="rounded-lg border border-destructive/40 px-4 py-3 text-ui-sm text-destructive">
          {controller.error}
        </div>
      ) : null}

      {enabled && state?.activeMissing ? (
        <div className="rounded-lg border border-amber-500/40 px-4 py-3 text-ui-sm">
          {t("settings.systemInstructions.activeMissing")}
        </div>
      ) : null}

      <SettingsGroupCard>
        <div className="space-y-3 px-5 py-4">
          <div className="text-ui-base font-medium">
            {t("settings.systemInstructions.profiles")}
          </div>
          {(state?.profiles ?? []).length === 0 ? (
            <div className="text-ui-sm text-foreground-subtle">
              {t("settings.systemInstructions.empty")}
            </div>
          ) : (
            <ul className="space-y-2">
              {(state?.profiles ?? []).map((profile) => {
                const isActive = state?.activeId === profile.id;
                return (
                  <li
                    key={profile.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-ui-base">{profile.name}</span>
                      {isActive ? (
                        <span className="rounded-md bg-surface px-2 py-0.5 text-ui-sm text-foreground-subtle">
                          {t("settings.systemInstructions.activeBadge")}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={controller.busy || isActive}
                        onClick={() => void controller.activateProfile(profile.id)}
                        data-testid={testId(TID_SETTINGS_SYSTEM_INSTRUCTIONS_ACTIVATE, profile.id)}
                      >
                        {t("settings.systemInstructions.activate")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={controller.busy}
                        onClick={() => void startEdit(profile.id)}
                        data-testid={testId(TID_SETTINGS_SYSTEM_INSTRUCTIONS_EDIT, profile.id)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={controller.busy}
                        onClick={() => void confirmDelete(profile.id, profile.name)}
                        data-testid={testId(TID_SETTINGS_SYSTEM_INSTRUCTIONS_DELETE, profile.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SettingsGroupCard>

      <SettingsGroupCard>
        <div className="space-y-3 px-5 py-4">
          <div className="text-ui-base font-medium">{t("settings.systemInstructions.create")}</div>
          <div className="flex items-center gap-2">
            <Input
              value={newName}
              placeholder={t("settings.systemInstructions.namePlaceholder")}
              onChange={(event) => setNewName(event.target.value)}
            />
            <select
              className="h-9 rounded-md border border-border bg-transparent px-2 text-ui-base"
              value={template}
              onChange={(event) => setTemplate(event.target.value as ForkIdentityPresetTemplateId)}
              data-testid={TID_SETTINGS_SYSTEM_INSTRUCTIONS_TEMPLATE}
            >
              <option value="default">{t("settings.systemInstructions.template.default")}</option>
              <option value="skeleton">{t("settings.systemInstructions.template.skeleton")}</option>
            </select>
            <Button
              disabled={controller.busy || newName.trim().length === 0}
              onClick={() => void startCreate()}
              data-testid={TID_SETTINGS_SYSTEM_INSTRUCTIONS_CREATE}
            >
              <FilePlus2 className="size-4" />
              {t("settings.systemInstructions.createAction")}
            </Button>
          </div>
        </div>
      </SettingsGroupCard>

      {editor ? (
        <SettingsGroupCard>
          <div className="space-y-3 px-5 py-4">
            <div className="text-ui-base font-medium">
              {t("settings.systemInstructions.editor")}
            </div>
            <Input
              value={editor.name}
              onChange={(event) =>
                setEditor((current) =>
                  current ? { ...current, name: event.target.value } : current,
                )
              }
            />
            <Textarea
              className="min-h-[240px] font-mono text-ui-sm"
              value={editor.content}
              onChange={(event) =>
                setEditor((current) =>
                  current ? { ...current, content: event.target.value } : current,
                )
              }
            />
            <div className="flex items-center gap-2">
              <Button
                disabled={controller.busy}
                onClick={async () => {
                  if (!editor) return;
                  await controller.saveProfile(editor);
                  setEditor(null);
                }}
                data-testid={TID_SETTINGS_SYSTEM_INSTRUCTIONS_SAVE}
              >
                {t("settings.systemInstructions.save")}
              </Button>
              <Button variant="ghost" onClick={() => setEditor(null)}>
                {t("settings.systemInstructions.cancel")}
              </Button>
            </div>
          </div>
        </SettingsGroupCard>
      ) : null}
    </div>
  );
}
