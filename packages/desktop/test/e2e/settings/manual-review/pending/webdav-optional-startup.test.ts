import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@zcode/shared/test-ids";
import { clickTestIdByDom } from "../../../helpers/desktop-app.js";
import { skipOccupationOnboardingIfPresent } from "../../../helpers/occupation-onboarding.js";
import { sel } from "../../../helpers/selectors.js";

describe("WebDAV optional startup", () => {
  it("a fresh profile reaches the app without WebDAV and can configure sync voluntarily", async function () {
    this.timeout(90000);
    const stateFile = join(homedir(), ".zcode", "v2", "fork-webdav.json");
    // 首屏不得靠测试夹具预写 firstRunSkipped 放行；允许服务创建默认状态，但不能有凭据或 skip。
    const { readFile } = await import("node:fs/promises");
    try {
      await access(stateFile);
      const state = JSON.parse(await readFile(stateFile, "utf8"));
      expect(Boolean(state.url)).toBe(false);
      expect(Boolean(state.firstRunSkipped)).toBe(false);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }

    // 只关闭与本需求无关的既有职业引导，不点击 WebDAV 跳过或调用同步服务。
    await skipOccupationOnboardingIfPresent();
    await $(sel(TID_TASK_SETTINGS_BUTTON)).waitForDisplayed({ timeout: 30000 });
    expect(await browser.execute(() => document.body.innerText)).not.toMatch(
      /同步你的 ZCode 配置|Sync your ZCode settings/,
    );
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
    await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: 15000 });
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "configSync"));
    await browser.waitUntil(async () => browser.execute(() => Boolean(
      document.querySelector('input[type="password"]'),
    )), { timeout: 15000, timeoutMsg: "sync settings connection form did not appear" });
  });
});
