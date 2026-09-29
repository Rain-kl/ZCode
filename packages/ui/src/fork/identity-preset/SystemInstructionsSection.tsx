/**
 * 设置 → Agent 能力 → 系统指令。
 *
 * 总开关 + 多组提示词配置的增删改与激活。启用后，新会话的系统提示词「身份段」
 * （cli_prefix 与身份声明）被所选配置正文替换；「注入动态提示词」关闭时连第③条（环境、gitStatus、
 * 沟通风格、上下文管理等）也整段不注入，只剩身份段与 Desktop Context。
 * 保存与激活都只写盘、不热切换，所以面板必须明说「对新会话生效」。
 *
 * 新建走标题右上角的小窗（只填名称与模板），创建后直接进编辑器手写正文：
 * 正文是长文本，内联在列表里会把列表挤成一团，也会让「浏览配置」和「写一段提示词」两件事混在一屏。
 *
 * 排版遵循 DESIGN.md 与设置页既有件：行用 SettingsRow（`px-4 py-3` + `border-t` 分隔、控件右对齐），
 * 卡片用 SettingsGroupCard（`rounded-xl`），表单用 SettingsFormTextarea + SettingsFormActions，
 * 字号只用 text-ui-*。不要退回自制卡片与自制选择器：那会让本页与其它设置页的行高、起点、圆角都不一致。
 */
import { useCallback, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { ForkIdentityPresetTemplateId } from "@zcode/shared";

import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { Switch } from "@/components/ui/switch.js";
import { useAlertDialog } from "@/hooks/useAlertDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsFormActions } from "@/settings/SettingsFormActions.js";
import { SettingsFormTextarea } from "@/settings/SettingsFormTextarea.js";
import { SettingsBadge, SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import {
  testId,
  TID_SETTINGS_SYSTEM_INSTRUCTIONS_ACTIVATE,
  TID_SETTINGS_SYSTEM_INSTRUCTIONS_CREATE,
  TID_SETTINGS_SYSTEM_INSTRUCTIONS_CREATE_DIALOG,
  TID_SETTINGS_SYSTEM_INSTRUCTIONS_CREATE_SUBMIT,
  TID_SETTINGS_SYSTEM_INSTRUCTIONS_DELETE,
  TID_SETTINGS_SYSTEM_INSTRUCTIONS_DYNAMIC_SWITCH,
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

/** 与 CommandForm / HookForm 同款字段标签：label 在输入框上方，不用 placeholder 兼任标签。 */
function FieldLabel({ children }: { children: string }) {
  return (
    <label className="mb-1 block text-ui-base font-medium text-foreground-subtle">{children}</label>
  );
}

export function SystemInstructionsSection() {
  const { intl } = useZCodeIntl();
  const controller = useForkIdentityPreset();
  const requestAlert = useAlertDialog();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [template, setTemplate] = useState<ForkIdentityPresetTemplateId>("default");
  const [editor, setEditor] = useState<EditorState | null>(null);

  const t = useCallback(
    (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values),
    [intl],
  );

  if (!controller.available) {
    return (
      <SettingsGroupCard>
        <div className="px-4 py-3 text-ui-base text-foreground-subtle">
          {t("settings.systemInstructions.unavailable")}
        </div>
      </SettingsGroupCard>
    );
  }

  const state = controller.state;
  const enabled = state?.enabled ?? false;
  // 缺省注入：旧 active.json 没有该字段，界面不能因为字段缺席就显示成关闭。
  const injectDynamic = state?.injectDynamic ?? true;
  const profiles = state?.profiles ?? [];
  // state 为 null 是首次拉取（controller 订阅到位前），与「确实没有配置」区分开。
  const loading = state === null && controller.error === null;
  const activeName = profiles.find((profile) => profile.id === state?.activeId)?.name;
  const activeMissing = enabled && state?.activeMissing === true;

  const createDisabled = controller.busy || newName.trim().length === 0;

  const startCreate = async () => {
    const createdId = await controller.createProfile({ name: newName, template });
    if (!createdId) return;
    setNewName("");
    setCreateOpen(false);
    // 新建后直接进编辑器：配置的价值全在正文，停在列表上等于让用户再点一次。
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
    <div className="space-y-4">
      <SettingsGroupCard>
        <SettingsRow
          label={t("settings.systemInstructions.enable")}
          description={t("settings.systemInstructions.enableHint")}
          control={
            <Switch
              checked={enabled}
              disabled={controller.busy}
              onCheckedChange={(next: boolean) => void controller.setEnabled(next)}
              data-testid={TID_SETTINGS_SYSTEM_INSTRUCTIONS_SWITCH}
            />
          }
        />
        <SettingsRow
          label={t("settings.systemInstructions.injectDynamic")}
          description={t("settings.systemInstructions.injectDynamicHint")}
          control={
            <Switch
              checked={injectDynamic}
              disabled={controller.busy || !enabled}
              onCheckedChange={(next: boolean) => void controller.setInjectDynamic(next)}
              data-testid={TID_SETTINGS_SYSTEM_INSTRUCTIONS_DYNAMIC_SWITCH}
            />
          }
        />
        <SettingsRow
          label={t("settings.systemInstructions.current")}
          description={
            activeMissing
              ? t("settings.systemInstructions.activeMissing")
              : t("settings.systemInstructions.takesEffectOnNewSession")
          }
          control={
            activeMissing ? (
              <span className="rounded-md bg-warning/10 px-2.5 py-1 text-ui-base font-medium text-warning">
                {t("settings.systemInstructions.activeMissingBadge")}
              </span>
            ) : enabled ? (
              <SettingsBadge>
                {activeName ?? t("settings.systemInstructions.systemDefault")}
              </SettingsBadge>
            ) : (
              // 关闭时生效的是系统默认提示词：这里不摆徽标，避免把某个预设名读成"正在使用"。
              <span className="text-ui-base text-foreground-subtle">
                {t("settings.systemInstructions.systemDefault")}
              </span>
            )
          }
        />
      </SettingsGroupCard>

      {controller.error ? (
        <p className="rounded-lg border border-destructive/40 px-4 py-3 text-ui-base text-destructive">
          {controller.error}
        </p>
      ) : null}

      <SettingsGroupCard>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="text-ui-base font-medium text-foreground">
            {t("settings.systemInstructions.profiles")}
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={controller.busy}
            onClick={() => setCreateOpen(true)}
            data-testid={TID_SETTINGS_SYSTEM_INSTRUCTIONS_CREATE}
          >
            <Plus className="size-4" />
            {t("settings.systemInstructions.createAction")}
          </Button>
        </div>

        {loading ? (
          <div className="border-t border-border px-4 py-3" aria-busy="true">
            <div className="space-y-3">
              <div className="h-4 w-40 animate-pulse rounded-sm bg-surface" />
              <div className="h-4 w-28 animate-pulse rounded-sm bg-surface" />
            </div>
          </div>
        ) : profiles.length === 0 ? (
          <div className="border-t border-border px-4 py-3 text-ui-base text-foreground-subtle">
            {t("settings.systemInstructions.empty")}
          </div>
        ) : (
          profiles.map((profile) => {
            const isActive = state?.activeId === profile.id;
            return (
              <SettingsRow
                key={profile.id}
                label={
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{profile.name}</span>
                    {isActive ? (
                      <SettingsBadge>{t("settings.systemInstructions.activeBadge")}</SettingsBadge>
                    ) : null}
                  </span>
                }
                control={
                  <>
                    {isActive ? null : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={controller.busy}
                        onClick={() => void controller.activateProfile(profile.id)}
                        data-testid={testId(TID_SETTINGS_SYSTEM_INSTRUCTIONS_ACTIVATE, profile.id)}
                      >
                        {t("settings.systemInstructions.activate")}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={controller.busy}
                      aria-label={t("settings.systemInstructions.editAction")}
                      onClick={() => void startEdit(profile.id)}
                      data-testid={testId(TID_SETTINGS_SYSTEM_INSTRUCTIONS_EDIT, profile.id)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={controller.busy}
                      aria-label={t("settings.systemInstructions.delete.title")}
                      onClick={() => void confirmDelete(profile.id, profile.name)}
                      data-testid={testId(TID_SETTINGS_SYSTEM_INSTRUCTIONS_DELETE, profile.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </>
                }
              />
            );
          })
        )}
      </SettingsGroupCard>

      {editor ? (
        <SettingsGroupCard>
          <div className="border-b border-border px-4 py-3 text-ui-base font-medium text-foreground">
            {t("settings.systemInstructions.editor")}
          </div>
          <form
            className="space-y-3 px-4 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              void (async () => {
                await controller.saveProfile(editor);
                setEditor(null);
              })();
            }}
          >
            <div className="max-w-sm">
              <FieldLabel>{t("settings.systemInstructions.nameLabel")}</FieldLabel>
              <Input
                value={editor.name}
                onChange={(event) =>
                  setEditor((current) =>
                    current ? { ...current, name: event.target.value } : current,
                  )
                }
              />
            </div>
            <div>
              <FieldLabel>{t("settings.systemInstructions.contentLabel")}</FieldLabel>
              <SettingsFormTextarea
                className="min-h-[280px] resize-y leading-relaxed"
                value={editor.content}
                onChange={(event) =>
                  setEditor((current) =>
                    current ? { ...current, content: event.target.value } : current,
                  )
                }
              />
            </div>
            <SettingsFormActions>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditor(null)}>
                {t("settings.systemInstructions.cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={controller.busy}
                data-testid={TID_SETTINGS_SYSTEM_INSTRUCTIONS_SAVE}
              >
                {t("settings.systemInstructions.save")}
              </Button>
            </SettingsFormActions>
          </form>
        </SettingsGroupCard>
      ) : null}

      <Dialog
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next);
          if (!next) setNewName("");
        }}
      >
        <DialogContent
          className="w-[min(480px,calc(100vw-2rem))] max-w-none"
          data-testid={TID_SETTINGS_SYSTEM_INSTRUCTIONS_CREATE_DIALOG}
        >
          <DialogTitle className="text-ui-lg font-medium text-foreground">
            {t("settings.systemInstructions.create")}
          </DialogTitle>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void startCreate();
            }}
          >
            <div>
              <FieldLabel>{t("settings.systemInstructions.nameLabel")}</FieldLabel>
              <Input
                autoFocus
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
            </div>
            <div>
              <FieldLabel>{t("settings.systemInstructions.templateLabel")}</FieldLabel>
              <Select
                value={template}
                onValueChange={(next) => setTemplate(next as ForkIdentityPresetTemplateId)}
              >
                <SelectTrigger
                  className="w-full min-w-0"
                  data-testid={TID_SETTINGS_SYSTEM_INSTRUCTIONS_TEMPLATE}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">
                    {t("settings.systemInstructions.template.default")}
                  </SelectItem>
                  <SelectItem value="skeleton">
                    {t("settings.systemInstructions.template.skeleton")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <SettingsFormActions>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCreateOpen(false);
                  setNewName("");
                }}
              >
                {t("settings.systemInstructions.cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={createDisabled}
                data-testid={TID_SETTINGS_SYSTEM_INSTRUCTIONS_CREATE_SUBMIT}
              >
                {t("settings.systemInstructions.createSubmit")}
              </Button>
            </SettingsFormActions>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
