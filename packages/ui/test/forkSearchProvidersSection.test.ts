import test from "node:test";
import assert from "node:assert/strict";
import { SETTINGS_SECTIONS } from "../src/settings/settingsPageConfig.js";
import { isSettingsSectionId } from "../src/lib/settingsNavigation.js";

// 注意：不要断言 HIDDEN_SETTINGS_SECTIONS —— 它是模块私有常量（settingsNavigation.ts:40 未导出），
// 而且 SETTINGS_SECTIONS 已经用 isSettingsSectionEnabled 过滤过隐藏栏目，断言它即可。
test("搜索栏目已注册且可导航", () => {
  assert.ok(SETTINGS_SECTIONS.some((section) => section.id === "searchProviders"));
  assert.equal(isSettingsSectionId("searchProviders"), true);
});

test("栏目文案在两种语言里都有", async () => {
  const zh = (await import("../src/i18n/locales/zh-CN.js")).default as Record<string, string>;
  const en = (await import("../src/i18n/locales/en-US.js")).default as Record<string, string>;
  const requiredKeys = [
    "settings.searchProviders.title",
    "settings.searchProviders.serverChannel",
    "settings.searchProviders.serverChannelEnabled",
    "settings.searchProviders.serverChannelDisabled",
    "settings.searchProviders.channels",
    "settings.searchProviders.add",
    "settings.searchProviders.addTitle",
    "settings.searchProviders.kind",
    "settings.searchProviders.label",
    "settings.searchProviders.apiKey",
    "settings.searchProviders.enabled",
    "settings.searchProviders.remove",
    "settings.searchProviders.empty",
    "settings.searchProviders.unavailable",
    "settings.searchProviders.priorityHint",
    "settings.searchProviders.keySyncHint",
    "settings.searchProviders.edit",
    "settings.searchProviders.editTitle",
    "settings.searchProviders.save",
    "settings.searchProviders.cancel",
    "settings.searchProviders.deleteConfirm",
    "settings.searchProviders.labelPlaceholder",
    "settings.searchProviders.apiKeyPlaceholder",
  ];
  for (const key of requiredKeys) {
    assert.ok(zh[key], `zh-CN 缺少 ${key}`);
    assert.ok(en[key], `en-US 缺少 ${key}`);
  }
});

test("readActiveModelNativeSearchEnabled 降级为 undefined（无单一活动模型）", async () => {
  const { readActiveModelNativeSearchEnabled } =
    await import("../src/fork/search-providers/SearchProvidersSection.js");
  assert.equal(readActiveModelNativeSearchEnabled(), undefined);
});

test("组件与 hook 正常导出", async () => {
  const { SearchProvidersSection } =
    await import("../src/fork/search-providers/SearchProvidersSection.js");
  const { useForkSearchProviders } =
    await import("../src/fork/search-providers/useForkSearchProviders.js");
  const { ChannelList } = await import("../src/fork/search-providers/ChannelList.js");
  const { AddChannelDialog, EditChannelDialog } =
    await import("../src/fork/search-providers/ChannelDialogs.js");
  const { ApiKeyInput } = await import("../src/settings/model-provider-section/ApiKeyInput.js");

  assert.equal(typeof SearchProvidersSection, "function");
  assert.equal(typeof useForkSearchProviders, "function");
  assert.equal(typeof ChannelList, "function");
  assert.equal(typeof AddChannelDialog, "function");
  assert.equal(typeof EditChannelDialog, "function");
  assert.equal(typeof ApiKeyInput, "function");
});
