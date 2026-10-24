import { afterEach, describe, expect, it, vi } from "vitest";

const { init, policy } = vi.hoisted(() => ({ init: vi.fn(), policy: { localMode: false } }));
vi.mock("@zcode/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@zcode/shared")>()),
  get FORK_LOCAL_MODE() {
    return policy.localMode;
  },
}));

vi.mock("@arms/rum-electron/browser", () => ({
  default: { init },
}));

describe("ARMS Browser init", () => {
  afterEach(() => {
    policy.localMode = false;
    init.mockReset();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("本地模式即使存在旧 ARMS bridge 也不初始化、不重试", async () => {
    policy.localMode = true;
    vi.stubGlobal("ArmsEventBridge", { send: vi.fn() });
    const { initArmsBrowserRumOnce, scheduleArmsBrowserRumInit } =
      await import("../src/shared/armsBrowserInit.js");
    const timer = vi.spyOn(globalThis, "setTimeout");
    expect(initArmsBrowserRumOnce("production")).toBe(false);
    scheduleArmsBrowserRumInit("production");
    expect(init).not.toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled();
    timer.mockRestore();
  });

  it("显式使用本地开发运行态初始化 production 产品环境为 local", async () => {
    vi.stubGlobal("__ZCODE_ENV__", "production");
    vi.stubGlobal("ArmsEventBridge", { send: vi.fn() });
    const { initArmsBrowserRumOnce } = await import("../src/shared/armsBrowserInit.js");

    expect(initArmsBrowserRumOnce("development")).toBe(true);
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ env: "local" }));
  });
});
