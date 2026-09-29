import { useState } from "react";
import type { ForkSearchProviderChannel } from "@zcode/shared";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ApiKeyInput } from "@/settings/model-provider-section/ApiKeyInput.js";

export function AddChannelDialog({
  onSubmit,
  disabled,
}: {
  onSubmit: (input: { kind: "tavily"; label: string; apiKey: string }) => Promise<void>;
  disabled?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({ kind: "tavily", label: label.trim(), apiKey: apiKey.trim() });
      setOpen(false);
      setLabel("");
      setApiKey("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className="self-start gap-1.5">
          <Plus className="size-4" />
          {intl.formatMessage({ id: "settings.searchProviders.add" })}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({ id: "settings.searchProviders.addTitle" })}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-ui-xs font-medium text-foreground">
                {intl.formatMessage({ id: "settings.searchProviders.kind" })}
              </label>
              <Input value="Tavily" readOnly disabled className="h-9 bg-muted" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-ui-xs font-medium text-foreground">
                {intl.formatMessage({ id: "settings.searchProviders.label" })}
              </label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={intl.formatMessage({
                  id: "settings.searchProviders.labelPlaceholder",
                })}
                className="h-9"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-ui-xs font-medium text-foreground">
                {intl.formatMessage({ id: "settings.searchProviders.apiKey" })}
              </label>
              <ApiKeyInput
                value={apiKey}
                visible={apiKeyVisible}
                onChange={setApiKey}
                onBlur={() => {}}
                onToggleVisibility={() => setApiKeyVisible((v) => !v)}
              />
            </div>
          </div>
          <DialogFooter className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              {intl.formatMessage({ id: "settings.searchProviders.cancel" })}
            </Button>
            <Button type="submit" size="sm" disabled={submitting || !apiKey.trim()}>
              {intl.formatMessage({ id: "settings.searchProviders.save" })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditChannelDialog({
  channel,
  open,
  onOpenChange,
  onSave,
}: {
  channel: ForkSearchProviderChannel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (patch: { label?: string; apiKey?: string }) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const [label, setLabel] = useState(channel.label);
  const [apiKey, setApiKey] = useState(channel.apiKey);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await onSave({ label: label.trim(), apiKey: apiKey.trim() });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setLabel(channel.label);
          setApiKey(channel.apiKey);
          setApiKeyVisible(false);
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({ id: "settings.searchProviders.editTitle" })}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-ui-xs font-medium text-foreground">
                {intl.formatMessage({ id: "settings.searchProviders.kind" })}
              </label>
              <Input value="Tavily" readOnly disabled className="h-9 bg-muted" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-ui-xs font-medium text-foreground">
                {intl.formatMessage({ id: "settings.searchProviders.label" })}
              </label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={intl.formatMessage({
                  id: "settings.searchProviders.labelPlaceholder",
                })}
                className="h-9"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-ui-xs font-medium text-foreground">
                {intl.formatMessage({ id: "settings.searchProviders.apiKey" })}
              </label>
              <ApiKeyInput
                value={apiKey}
                visible={apiKeyVisible}
                onChange={setApiKey}
                onBlur={() => {}}
                onToggleVisibility={() => setApiKeyVisible((v) => !v)}
              />
            </div>
          </div>
          <DialogFooter className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {intl.formatMessage({ id: "settings.searchProviders.cancel" })}
            </Button>
            <Button type="submit" size="sm" disabled={saving || !apiKey.trim()}>
              {intl.formatMessage({ id: "settings.searchProviders.save" })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
