import { useState } from "react";
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleIcon,
  LaptopIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@zcode/ui/button";
import { DevicePlatformIcon, getDevicePlatformLabel } from "@zcode/ui/device-platform-icon";
import { WebRemoteControlBrand } from "#src/web-remote-control/ui/webRemoteControlBrand.js";
import {
  WebRemoteControlConnectionSheet,
  WebRemoteControlDeviceRow,
} from "#src/web-remote-control/ui/webRemoteControlConnectionSheet.js";
import type {
  WebRemoteControlDeviceGroup,
  WebRemoteControlDeviceListAccount,
  WebRemoteControlDeviceListView,
} from "#src/web-remote-control/contract.js";

import type { WebRemoteControlScreenLocale } from "#src/web-remote-control/domain/webRemoteControlScreenCopy.js";
import { WebRemoteControlSwitchAccountDialog } from "#src/web-remote-control/ui/webRemoteControlSwitchAccountDialog.js";

// FORK(cloud-web-access): 离线设备删除复用设备页的语言与视觉规范。
const copyByLocale = {
  "zh-CN": {
    title: "选择电脑",
    switchAccount: "切换",
    switchAccountFallback: "切换账号",
    refresh: "刷新",
    deleteOffline: "删除离线设备",
    deleteSelected: "删除已选",
    cancel: "取消",
    deleteError: "删除失败",
    loading: "正在加载设备…",
    online: "在线",
    offline: "离线",
    unnamed: "未命名设备",
    connections: (count: number) => `${count} 个连接`,
    notFound: "没看到你的电脑？在电脑端 ZCode 登录同一账号并开启远程控制，然后刷新。",
    emptyTitle: "暂无设备",
    emptyDescription: "在电脑端登录同一账号并开启 Web 远程控制，然后刷新列表。",
    error: "无法加载设备，请检查网络后刷新。",
  },
  "en-US": {
    title: "Choose a computer",
    switchAccount: "Switch",
    switchAccountFallback: "Switch account",
    refresh: "Refresh",
    deleteOffline: "Delete offline devices",
    deleteSelected: "Delete selected",
    cancel: "Cancel",
    deleteError: "Deletion failed",
    loading: "Loading devices…",
    online: "Online",
    offline: "Offline",
    unnamed: "Unnamed device",
    connections: (count: number) => `${count} connections`,
    notFound:
      "Don't see your computer? Sign in to ZCode on it with the same account, turn on remote control, then refresh.",
    emptyTitle: "No devices yet",
    emptyDescription:
      "Sign in with the same account on your computer, enable Web remote control, then refresh this list.",
    error: "Could not load devices. Check your connection and refresh.",
  },
};

type DeviceListCopy = (typeof copyByLocale)["zh-CN"];

const PROVIDER_LABELS: Record<WebRemoteControlDeviceListAccount["provider"], string> = {
  zai: "Z.ai",
  bigmodel: "BigModel",
  // FORK(cloud-web-access): 自建账号在设备页明确显示为 Relay 身份。
  "self-hosted": "Self-hosted Relay",
};

interface WebRemoteControlDeviceListPageProps {
  view: WebRemoteControlDeviceListView;
  locale: WebRemoteControlScreenLocale;
  onSelect(sid: string): void;
  onDelete(mids: string[]): Promise<void>;
  onRefresh(): void;
  onSwitchAccount(): void;
  /** 多连接弹层的“启动于”相对时间基准，测试注入。 */
  now?: () => number;
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <h2 className="flex items-baseline gap-1.5 px-1 pb-2 pt-6 text-ui-sm font-medium text-foreground-subtle">
      {label}
      <span className="text-foreground-subtlest">{count}</span>
    </h2>
  );
}

function DeviceTile({ platform, online }: { platform?: string; online: boolean }) {
  return (
    <span className="relative flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-foreground">
      <DevicePlatformIcon platform={platform} className="size-[18px]" />
      {online ? (
        <span
          aria-hidden="true"
          className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-success ring-2 ring-card"
        />
      ) : null}
    </span>
  );
}

function describeDevice(
  device: WebRemoteControlDeviceGroup,
  copy: DeviceListCopy,
  showId: boolean,
): string {
  const platform = getDevicePlatformLabel(device.platform);
  const online = device.onlineConnections.length > 0;
  const single = device.onlineConnections.length === 1 ? device.onlineConnections[0] : undefined;
  const version = single?.meta.version?.trim();
  const parts = online
    ? [platform, version ? `ZCode ${version}` : undefined]
    : [platform, copy.offline];
  const filtered = parts.filter((part): part is string => Boolean(part));
  if (filtered.length === 0) filtered.push(online ? copy.online : copy.offline);
  // 设备 ID 默认隐藏；同组重名时才追加 MID 前 8 位区分，前 8 位不参与身份判断。
  if (showId) filtered.push(`ID ${device.deviceMid.slice(0, 8)}`);
  return filtered.join(" · ");
}

function DeviceSection({
  label,
  devices,
  copy,
  selectable,
  selecting,
  selected,
  onOpen,
}: {
  label: string;
  devices: WebRemoteControlDeviceGroup[];
  copy: DeviceListCopy;
  selectable: boolean;
  selecting: boolean;
  selected: ReadonlySet<string>;
  onOpen(device: WebRemoteControlDeviceGroup): void;
}) {
  if (devices.length === 0) return null;
  const nameCounts = new Map<string, number>();
  for (const device of devices) {
    const name = device.name || copy.unnamed;
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  return (
    <section>
      <SectionHeader label={label} count={devices.length} />
      <ul className="overflow-hidden rounded-xl border border-card-border bg-card">
        {devices.map((device, index) => {
          const name = device.name || copy.unnamed;
          const online = device.onlineConnections.length > 0;
          const multiple = device.onlineConnections.length > 1;
          return (
            <li key={device.deviceMid}>
              <WebRemoteControlDeviceRow
                first={index === 0}
                // 全离线行原生禁用；在线行在刷新中/失败时也暂不可选，沿用入口 admission。
                disabled={!selectable || (selecting ? online : !online)}
                selected={selecting && !online ? selected.has(device.deviceMid) : undefined}
                onClick={() => onOpen(device)}
                dimmed={!online}
                leading={<DeviceTile platform={device.platform} online={online} />}
                trailing={
                  selecting && !online ? (
                    selected.has(device.deviceMid) ? (
                      <CheckCircle2Icon aria-hidden="true" className="size-5 text-foreground" />
                    ) : (
                      <CircleIcon aria-hidden="true" className="size-5 text-foreground-subtle" />
                    )
                  ) : online ? (
                    <>
                      {multiple ? (
                        <span className="shrink-0 text-ui-sm text-foreground-subtle">
                          {copy.connections(device.onlineConnections.length)}
                        </span>
                      ) : null}
                      <ChevronRightIcon
                        aria-hidden="true"
                        className="size-4 shrink-0 text-foreground-subtlest"
                      />
                    </>
                  ) : null
                }
              >
                <span className="block truncate text-ui-base font-medium">{name}</span>
                <span className="mt-0.5 block truncate text-ui-sm text-foreground-subtle">
                  {describeDevice(device, copy, (nameCounts.get(name) ?? 0) > 1)}
                </span>
              </WebRemoteControlDeviceRow>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AccountRow({
  account,
  copy,
  locale,
  onSwitchAccount,
}: {
  account?: WebRemoteControlDeviceListAccount;
  copy: DeviceListCopy;
  locale: WebRemoteControlScreenLocale;
  onSwitchAccount(): void;
}) {
  const switchButton = (label: string) => (
    <WebRemoteControlSwitchAccountDialog locale={locale} onConfirm={onSwitchAccount}>
      <Button
        type="button"
        variant="ghost"
        className="-my-2 h-9 shrink-0 rounded-lg px-2 font-medium focus-visible:bg-hover"
      >
        {label}
      </Button>
    </WebRemoteControlSwitchAccountDialog>
  );
  if (!account) {
    return (
      <div className="-ml-2 mt-1 flex items-center">{switchButton(copy.switchAccountFallback)}</div>
    );
  }
  return (
    <div className="mt-1 flex min-w-0 items-center gap-2 text-ui-sm text-foreground-subtle">
      {account.avatarUrl ? (
        <img
          src={account.avatarUrl}
          alt=""
          aria-hidden="true"
          className="size-5 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-hover text-ui-xs font-semibold text-foreground"
        >
          {Array.from(account.displayName.trim())[0]?.toUpperCase() ?? "?"}
        </span>
      )}
      <span className="min-w-0 truncate">
        {account.displayName} · {PROVIDER_LABELS[account.provider]}
      </span>
      {switchButton(copy.switchAccount)}
    </div>
  );
}

export function WebRemoteControlDeviceListPage({
  view,
  locale,
  onSelect,
  onDelete,
  onRefresh,
  onSwitchAccount,
  now = () => Date.now(),
}: WebRemoteControlDeviceListPageProps) {
  const copy = copyByLocale[locale];
  // FORK(cloud-web-access): 勾选状态仅属于当前设备页。
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [sheetDeviceMid, setSheetDeviceMid] = useState<string | null>(null);
  const selectable = !view.loading && !view.error && !deleting;
  const onlineDevices = view.devices.filter((device) => device.onlineConnections.length > 0);
  const offlineDevices = view.devices.filter((device) => device.onlineConnections.length === 0);
  const selectedMids = offlineDevices
    .filter((device) => selected.has(device.deviceMid))
    .map((device) => device.deviceMid);
  const sheetDevice = onlineDevices.find((device) => device.deviceMid === sheetDeviceMid);
  const openDevice = (device: WebRemoteControlDeviceGroup) => {
    if (selecting) {
      if (device.onlineConnections.length) return;
      setSelected((previous) => {
        const next = new Set(previous);
        if (next.has(device.deviceMid)) next.delete(device.deviceMid);
        else next.add(device.deviceMid);
        return next;
      });
      return;
    }
    const [only, ...others] = device.onlineConnections;
    if (!only) return;
    if (others.length === 0) onSelect(only.device_sid);
    else setSheetDeviceMid(device.deviceMid);
  };

  // 全局 body/#root 禁止滚动；入口自己承接长列表，保证末行可达。
  return (
    <main className="h-dvh overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-4 pb-10 pt-[calc(env(safe-area-inset-top)+12px)]">
        <div className="flex h-10 items-center">
          <WebRemoteControlBrand />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h1 className="text-ui-xl font-semibold">{copy.title}</h1>
          {/* FORK(cloud-web-access): 离线设备删除入口与刷新操作并排。 */}
          <div className="flex items-center">
            <Button
              type="button"
              variant="ghost"
              aria-label={selecting ? copy.cancel : copy.deleteOffline}
              title={selecting ? copy.cancel : copy.deleteOffline}
              disabled={deleting || (!selecting && (offlineDevices.length === 0 || !selectable))}
              onClick={() => {
                setSelecting(!selecting);
                setSelected(new Set());
                setDeleteError(null);
              }}
              className="size-10 rounded-lg text-foreground-subtle focus-visible:bg-hover"
            >
              <Trash2Icon aria-hidden="true" className="size-[18px]" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              aria-label={copy.refresh}
              title={copy.refresh}
              disabled={view.loading}
              onClick={onRefresh}
              className="-mr-2 size-10 rounded-lg text-foreground-subtle focus-visible:bg-hover"
            >
              <RefreshCwIcon
                className={["size-[18px]", view.loading ? "animate-spin" : ""].join(" ")}
              />
            </Button>
          </div>
        </div>
        <AccountRow
          account={view.account}
          copy={copy}
          locale={locale}
          onSwitchAccount={onSwitchAccount}
        />

        {view.error ? (
          <p role="alert" className="mt-5 px-1 text-ui-sm text-destructive">
            {copy.error}
          </p>
        ) : null}
        {deleteError ? (
          <p role="alert" className="mt-5 px-1 text-ui-sm text-destructive">
            {copy.deleteError}: {deleteError}
          </p>
        ) : null}
        <div aria-busy={view.loading || deleting}>
          {view.devices.length > 0 ? (
            <>
              <DeviceSection
                label={copy.online}
                devices={onlineDevices}
                copy={copy}
                selectable={selectable}
                selecting={selecting}
                selected={selected}
                onOpen={openDevice}
              />
              <DeviceSection
                label={copy.offline}
                devices={offlineDevices}
                copy={copy}
                selectable={selectable}
                selecting={selecting}
                selected={selected}
                onOpen={openDevice}
              />
              {selecting ? (
                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={deleting}
                    onClick={() => {
                      setSelecting(false);
                      setSelected(new Set());
                    }}
                  >
                    {copy.cancel}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={!selectable || selectedMids.length === 0}
                    onClick={() => {
                      setDeleting(true);
                      setDeleteError(null);
                      void onDelete(selectedMids)
                        .then(() => {
                          setSelecting(false);
                          setSelected(new Set());
                        })
                        .catch((error: unknown) =>
                          setDeleteError(error instanceof Error ? error.message : String(error)),
                        )
                        .finally(() => setDeleting(false));
                    }}
                  >
                    {copy.deleteSelected} ({selectedMids.length})
                  </Button>
                </div>
              ) : null}
              <p className="px-1 pt-3 text-ui-sm leading-5 text-foreground-subtlest">
                {copy.notFound}
              </p>
            </>
          ) : view.loading ? (
            <p role="status" className="py-16 text-center text-ui-sm text-foreground-subtle">
              {copy.loading}
            </p>
          ) : !view.error ? (
            <div className="mt-16 flex flex-col items-center px-6 text-center">
              <span className="flex size-14 items-center justify-center rounded-xl bg-surface text-foreground-subtle">
                <LaptopIcon aria-hidden="true" className="size-7" />
              </span>
              <p className="mt-4 text-ui-base font-semibold">{copy.emptyTitle}</p>
              <p className="mt-1.5 text-ui-sm leading-5 text-foreground-subtle">
                {copy.emptyDescription}
              </p>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="mt-5 h-10 px-4"
                onClick={onRefresh}
              >
                <RefreshCwIcon />
                {copy.refresh}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      <WebRemoteControlConnectionSheet
        device={sheetDevice}
        locale={locale}
        disabled={!selectable}
        now={now}
        onClose={() => setSheetDeviceMid(null)}
        onSelect={(sid) => {
          setSheetDeviceMid(null);
          onSelect(sid);
        }}
      />
    </main>
  );
}
