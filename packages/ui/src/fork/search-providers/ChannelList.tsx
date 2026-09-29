import { useCallback, useState } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
import type { ForkSearchProviderChannel } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { ForkSearchProvidersController } from "./useForkSearchProviders.js";
import { EditChannelDialog } from "./ChannelDialogs.js";

function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function SortableChannelItem({
  channel,
  controller,
  onDelete,
}: {
  channel: ForkSearchProviderChannel;
  controller: ForkSearchProvidersController;
  onDelete: () => void;
}) {
  const { intl } = useZCodeIntl();
  const [editOpen, setEditOpen] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: channel.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "flex items-center justify-between p-3 rounded-lg border border-input-border bg-card",
          isDragging ? "relative z-10 shadow-md opacity-90" : "",
        )}
        data-testid={`search-provider-item-${channel.id}`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <button
            type="button"
            className="cursor-grab active:cursor-grabbing text-foreground-subtle hover:text-foreground p-1 -m-1 touch-pan-y"
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
          <span className="text-ui-xs px-1.5 py-0.5 rounded bg-muted font-medium text-foreground-subtle shrink-0">
            Tavily
          </span>
          <span className="text-ui-sm font-medium text-foreground truncate max-w-[140px]">
            {channel.label || (
              <span className="text-foreground-subtle italic">
                {intl.formatMessage({ id: "settings.searchProviders.label" })}
              </span>
            )}
          </span>
          <span className="text-ui-xs text-foreground-subtle font-mono truncate max-w-[120px]">
            {maskApiKey(channel.apiKey)}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Switch
            checked={channel.enabled}
            disabled={controller.busy}
            onCheckedChange={(checked) => {
              void controller.update(channel.id, { enabled: checked });
            }}
            aria-label={intl.formatMessage({ id: "settings.searchProviders.enabled" })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={controller.busy}
            onClick={() => setEditOpen(true)}
            aria-label={intl.formatMessage({ id: "settings.searchProviders.edit" })}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={controller.busy}
            className="text-destructive hover:text-destructive"
            onClick={onDelete}
            aria-label={intl.formatMessage({ id: "settings.searchProviders.remove" })}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      {editOpen ? (
        <EditChannelDialog
          channel={channel}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSave={async (patch) => {
            await controller.update(channel.id, patch);
          }}
        />
      ) : null}
    </>
  );
}

export function ChannelList({ controller }: { controller: ForkSearchProvidersController }) {
  const { intl } = useZCodeIntl();
  const [channelToDelete, setChannelToDelete] = useState<ForkSearchProviderChannel | null>(null);

  // 基础 PointerSensor 配 4px 激活距离，避免与手柄普通点击冲突；
  // 拖拽手柄独占绑定 listeners，行内开关/编辑/删除不排斥也不继承拖拽。
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) {
        return;
      }
      const activeId = String(active.id);
      const overId = String(over.id);
      const oldIndex = controller.channels.findIndex((c) => c.id === activeId);
      const newIndex = controller.channels.findIndex((c) => c.id === overId);
      if (oldIndex >= 0 && newIndex >= 0) {
        const reordered = arrayMove(controller.channels, oldIndex, newIndex);
        void controller.reorder(reordered.map((c) => c.id));
      }
    },
    [controller],
  );

  if (controller.channels.length === 0) {
    return (
      <div
        className="py-8 text-center text-ui-sm text-foreground-subtle border border-dashed border-input-border/60 rounded-lg"
        data-testid="search-providers-empty"
      >
        {intl.formatMessage({ id: "settings.searchProviders.empty" })}
      </div>
    );
  }

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={controller.channels.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-2">
            {controller.channels.map((channel) => (
              <SortableChannelItem
                key={channel.id}
                channel={channel}
                controller={controller}
                onDelete={() => setChannelToDelete(channel)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {channelToDelete ? (
        <AlertDialog
          open={Boolean(channelToDelete)}
          onOpenChange={(open) => {
            if (!open) {
              setChannelToDelete(null);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {intl.formatMessage({ id: "settings.searchProviders.deleteConfirm" })}
              </AlertDialogTitle>
              {channelToDelete.label ? (
                <AlertDialogDescription>{channelToDelete.label}</AlertDialogDescription>
              ) : null}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={controller.busy}>
                {intl.formatMessage({ id: "settings.searchProviders.cancel" })}
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={controller.busy}
                onClick={async () => {
                  try {
                    await controller.remove(channelToDelete.id);
                    setChannelToDelete(null);
                  } catch {
                    // 异常由 controller.error 记录展示，避免静默失败
                  }
                }}
              >
                {intl.formatMessage({ id: "settings.searchProviders.remove" })}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}
