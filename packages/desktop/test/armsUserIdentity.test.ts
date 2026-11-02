import { describe, expect, it, vi } from "vitest";
import { createArmsUserIdentitySync } from "../src/main/armsUserIdentity.js";

const DEVICE_MID = "device-mid-abc";

describe("armsUserIdentity", () => {
  // FORK-BEGIN(local-mode)
  it("禁用 ARMS 时 refresh 不触碰未初始化 SDK", () => {
    const setUser = vi.fn(() => {
      throw new Error("Config not initialized");
    });
    const sync = createArmsUserIdentitySync({ deviceMid: DEVICE_MID, enabled: false, setUser });
    expect(() => {
      sync.refresh();
      sync.refresh();
    }).not.toThrow();
    expect(setUser).not.toHaveBeenCalled();
  });

  it("启用时写入失败保留原错误，后续 refresh 重试直到写入成功", () => {
    const error = new Error("Config not initialized");
    const setUser = vi.fn().mockImplementationOnce(() => {
      throw error;
    });
    const sync = createArmsUserIdentitySync({ deviceMid: DEVICE_MID, enabled: true, setUser });
    expect(() => sync.refresh()).toThrow(error);
    sync.refresh();
    sync.refresh();
    expect(setUser).toHaveBeenCalledTimes(2);
  });
  // FORK-END(local-mode)

  it("始终以 deviceMid 作为 user.name 写入 ARMS", () => {
    const setUser = vi.fn();
    const sync = createArmsUserIdentitySync({
      deviceMid: DEVICE_MID,
      setUser,
    });
    sync.refresh();
    expect(setUser).toHaveBeenCalledTimes(1);
    expect(setUser).toHaveBeenCalledWith({ name: DEVICE_MID });
  });

  it("去重：同 deviceMid 不重复 setUser", () => {
    const setUser = vi.fn();
    const sync = createArmsUserIdentitySync({
      deviceMid: DEVICE_MID,
      setUser,
    });
    sync.refresh();
    sync.refresh();
    sync.refresh();
    expect(setUser).toHaveBeenCalledTimes(1);
  });
});
