/**
 * 应用级冲突弹窗：本机与远端都有改动时询问用户保留哪一侧。
 *
 * 出现时机：host 侧状态机进入 conflict；同一个冲突只自动弹一次（「稍后」后不再打扰），
 * 之后可从左下角状态项或设置页横幅重新打开。见 docs/features/local-mode/design.md 第 6.4 节。
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { subscribeForkWebdavConflictDialog } from "@/fork/local-mode/conflictDialogBus.js";
import { useForkWebdav } from "@/fork/local-mode/useForkWebdav.js";

export function ForkWebdavConflictDialog() {
  const { intl } = useZCodeIntl();
  const controller = useForkWebdav();
  const [open, setOpen] = useState(false);
  const autoOpenedRef = useRef(false);

  const inConflict = controller.status?.phase === "conflict";

  useEffect(() => {
    if (inConflict && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setOpen(true);
    }
    if (!inConflict) {
      autoOpenedRef.current = false;
      setOpen(false);
    }
  }, [inConflict]);

  useEffect(() => subscribeForkWebdavConflictDialog(() => setOpen(true)), []);

  if (!controller.available || !inConflict) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="fork-webdav-conflict-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4" />
            {intl.formatMessage({ id: "settings.configSync.conflictDialogTitle" })}
          </DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: "settings.configSync.conflictDialogBody" })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={controller.busy}
            onClick={() => {
              void controller.resolveConflict("keep-local").then(() => setOpen(false));
            }}
          >
            {intl.formatMessage({ id: "settings.configSync.conflictKeepLocal" })}
          </Button>
          <Button
            type="button"
            disabled={controller.busy}
            onClick={() => {
              void controller.resolveConflict("use-remote-latest").then(() => setOpen(false));
            }}
          >
            {intl.formatMessage({ id: "settings.configSync.conflictUseRemote" })}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {intl.formatMessage({ id: "settings.configSync.conflictLater" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
