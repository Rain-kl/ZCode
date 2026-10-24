import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZCODE_JWT_INVALID_BROADCAST_CHANNEL } from "@zcode/shared";

const { effects, requestAlert, cloudAccountEnabled } = vi.hoisted(() => ({
  cloudAccountEnabled: vi.fn(() => true),
  effects: [] as Array<() => unknown>,
  requestAlert: vi.fn(),
}));
// 云账号分支是本地模式关闭的可选能力，测试显式开启，避免依赖产品默认开关。
vi.mock("@zcode/shared", async (original) => ({
  ...(await original<typeof import("@zcode/shared")>()),
  isCloudAccountBackgroundEnabled: cloudAccountEnabled,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => unknown) => effects.push(effect),
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("@/hooks/useAlertDialog.js", () => ({ useAlertDialog: () => requestAlert }));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
vi.mock("@/root/useAccountConnectionLossNotification.js", () => ({
  useAccountConnectionLossNotification: vi.fn(),
}));
vi.mock("@/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { useRootOAuthEffects } from "@/root/useRootOAuthEffects.js";

describe("运行时登录失效进入重新登录", () => {
  beforeEach(() => {
    effects.length = 0;
    requestAlert.mockReset();
    cloudAccountEnabled.mockReturnValue(true);
  });
  it.each([true, false])("提示结果 %s 都使用登录入口，不重启 App", async (confirmed) => {
    let finish!: (value: boolean) => void;
    requestAlert.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    );
    let receive!: (message: { channel: string }) => void;
    const setUser = vi.fn(),
      onReauthenticationRequired = vi.fn(),
      executeDesktopCommand = vi.fn();
    useRootOAuthEffects({
      accountIntentKey: "synthetic",
      platform: { executeDesktopCommand } as never,
      services: {
        oauthService: { getActiveProvider: async () => null },
        broadcastService: {
          onMessage: (listener: typeof receive) => {
            receive = listener;
            return { dispose: vi.fn() };
          },
        },
      } as never,
      refreshProviderState: vi.fn(),
      setUser,
      setIsRestoringOAuthSession: vi.fn(),
      setOAuthError: vi.fn(),
      oauthPollingActive: false,
      setOAuthPollingActive: vi.fn(),
      markOAuthSuccess: vi.fn(),
      onReauthenticationRequired,
    });
    const dispose = effects[1]() as () => void;
    receive({ channel: ZCODE_JWT_INVALID_BROADCAST_CHANNEL });
    receive({ channel: ZCODE_JWT_INVALID_BROADCAST_CHANNEL });
    await vi.waitFor(() => expect(setUser).toHaveBeenCalledWith(null));
    expect(requestAlert).toHaveBeenCalledOnce();
    expect(requestAlert).toHaveBeenCalledWith(
      expect.objectContaining({ actionLabel: "login.expired.action" }),
    );
    expect(onReauthenticationRequired).not.toHaveBeenCalled();
    finish(confirmed);
    await vi.waitFor(() => expect(onReauthenticationRequired).toHaveBeenCalledOnce());
    expect(executeDesktopCommand).not.toHaveBeenCalled();
    dispose();
  });

  it.each(["before-alert", "during-alert"])(
    "新登录在 %s 完成时不显示或执行旧过期提示",
    async (timing) => {
      let finish!: (value: boolean) => void;
      requestAlert.mockReturnValue(
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
      );
      let activeProvider: "zai" | null = timing === "before-alert" ? "zai" : null;
      const getActiveProvider = vi.fn(async () => activeProvider),
        setUser = vi.fn(),
        onReauthenticationRequired = vi.fn();
      let receive!: (message: { channel: string }) => void;
      useRootOAuthEffects({
        accountIntentKey: "synthetic",
        platform: {} as never,
        services: {
          oauthService: { getActiveProvider },
          broadcastService: {
            onMessage: (listener: typeof receive) => {
              receive = listener;
              return { dispose: vi.fn() };
            },
          },
        } as never,
        refreshProviderState: vi.fn(),
        setUser,
        setIsRestoringOAuthSession: vi.fn(),
        setOAuthError: vi.fn(),
        oauthPollingActive: false,
        setOAuthPollingActive: vi.fn(),
        markOAuthSuccess: vi.fn(),
        onReauthenticationRequired,
      });
      const dispose = effects[1]() as () => void;
      receive({ channel: ZCODE_JWT_INVALID_BROADCAST_CHANNEL });
      if (timing === "before-alert") {
        await vi.waitFor(() => expect(getActiveProvider).toHaveBeenCalledOnce());
        expect(requestAlert).not.toHaveBeenCalled();
        expect(setUser).not.toHaveBeenCalled();
      } else {
        await vi.waitFor(() => expect(requestAlert).toHaveBeenCalledOnce());
        activeProvider = "zai";
        finish(true);
        await vi.waitFor(() => expect(getActiveProvider).toHaveBeenCalledTimes(2));
      }
      expect(onReauthenticationRequired).not.toHaveBeenCalled();
      dispose();
    },
  );
});

it("本地模式不订阅云账号失效通知", () => {
  effects.length = 0;
  requestAlert.mockReset();
  cloudAccountEnabled.mockReturnValue(false);
  const onMessage = vi.fn();
  useRootOAuthEffects({
    accountIntentKey: "local",
    platform: {} as never,
    services: { broadcastService: { onMessage } } as never,
    refreshProviderState: vi.fn(),
    setUser: vi.fn(),
    setIsRestoringOAuthSession: vi.fn(),
    setOAuthError: vi.fn(),
    oauthPollingActive: false,
    setOAuthPollingActive: vi.fn(),
    markOAuthSuccess: vi.fn(),
    onReauthenticationRequired: vi.fn(),
  });
  effects[1]();
  expect(onMessage).not.toHaveBeenCalled();
  expect(requestAlert).not.toHaveBeenCalled();
});
