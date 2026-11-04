import { describe, expect, it } from "vitest";
import {
  isUtcPlusEightTimeZone,
  resolveRemoteCdnBaseUrls,
  shouldPreferDomesticRemoteCdn,
} from "../src/main/remoteCdn.js";

describe("remoteCdn", () => {
  it("中文环境也从 GitHub 下载完整版本对应的 Server", () => {
    expect(
      shouldPreferDomesticRemoteCdn({
        locale: "zh-CN",
        timeZone: "Asia/Shanghai",
      }),
    ).toBe(true);
    expect(
      resolveRemoteCdnBaseUrls({
        env: "production",
        locale: "zh-CN",
        timeZone: "Asia/Shanghai",
        version: "0.0.0-test",
      }),
    ).toEqual([
      "https://github.com/Rain-kl/ZCode/releases/download/server-v0.0.0-test",
    ]);
  });

  it("语言和时区不改变版本锁定的 GitHub Server 下载源", () => {
    expect(
      shouldPreferDomesticRemoteCdn({
        locale: "en-US",
        timeZone: "Asia/Shanghai",
      }),
    ).toBe(false);
    expect(
      shouldPreferDomesticRemoteCdn({
        locale: "zh-CN",
        timeZone: "America/Los_Angeles",
      }),
    ).toBe(false);
    expect(
      resolveRemoteCdnBaseUrls({
        env: "production",
        locale: "zh-CN",
        timeZone: "America/Los_Angeles",
        version: "0.0.0-test",
      }),
    ).toEqual([
      "https://github.com/Rain-kl/ZCode/releases/download/server-v0.0.0-test",
    ]);
  });

  it("canary 复用固定 Server Release，正式版仍锁定版本 Release", () => {
    for (const version of ["3.17.162-dev.084c4811", "3.17.162-dev.12345678"]) {
      expect(resolveRemoteCdnBaseUrls({ env: "production", version })).toEqual([
        "https://github.com/Rain-kl/ZCode/releases/download/server-canary-build",
      ]);
    }
    expect(
      resolveRemoteCdnBaseUrls({ env: "production", version: "3.17.162" }),
    ).toEqual([
      "https://github.com/Rain-kl/ZCode/releases/download/server-v3.17.162",
    ]);
  });

  it("东八区判断应按 UTC 偏移而不是固定城市名单", () => {
    expect(isUtcPlusEightTimeZone("Asia/Shanghai")).toBe(true);
    expect(isUtcPlusEightTimeZone("Asia/Singapore")).toBe(true);
    expect(isUtcPlusEightTimeZone("Asia/Tokyo")).toBe(false);
  });

  it("测试产品环境应固定使用内网 SSH remote assets 根目录", () => {
    expect(
      resolveRemoteCdnBaseUrls({
        env: "test",
        locale: "zh-CN",
        timeZone: "Asia/Shanghai",
        version: "0.0.0-test",
      }),
    ).toEqual([
      "http://intranet.example.invalid:12345/ssh-remote-assets/0.0.0-test",
    ]);
  });

  it("显式覆盖 CDN 基址时不再按产品环境选择默认值", () => {
    expect(
      resolveRemoteCdnBaseUrls({
        env: "test",
        overrideBaseUrl: "https://cdn.example.com/releases///",
        version: "0.0.0-test",
      }),
    ).toEqual(["https://cdn.example.com/releases"]);
  });
});
