import test from "node:test";
import assert from "node:assert/strict";
import { SETTINGS_SECTIONS } from "../src/settings/settingsPageConfig.js";
import { isSettingsSectionId } from "../src/lib/settingsNavigation.js";

// 注意：不要断言 HIDDEN_SETTINGS_SECTIONS —— 它是模块私有常量（settingsNavigation.ts:40 未导出），
// 而且 SETTINGS_SECTIONS 已经用 isSettingsSectionEnabled 过滤过隐藏栏目，断言它即可。
test("网络搜索栏目已注册且可导航", () => {
  assert.ok(SETTINGS_SECTIONS.some((section) => section.id === "searchProviders"));
  assert.equal(isSettingsSectionId("searchProviders"), true);
});

test("网络搜索栏目挂在 Agent 能力分组下", () => {
  // 分组是产品决定：它是 agent 的外部能力配置（与 MCP 同类），不是「基础设置」。
  // 断言分组而不只断言存在——否则把它移回 basics 也能全绿。
  const section = SETTINGS_SECTIONS.find((entry) => entry.id === "searchProviders");
  assert.ok(section, "期望 searchProviders 栏目已注册");
  assert.equal(section.groupId, "agentCapabilities");
});

test("栏目标题是「网络搜索」/「Web Search」，不再是泛称「搜索」", async () => {
  const zh = (await import("../src/i18n/locales/zh-CN.js")).default as Record<string, string>;
  const en = (await import("../src/i18n/locales/en-US.js")).default as Record<string, string>;
  // 泛称「搜索」会与工作区文件搜索（.zcodeignore）混淆，故断言为精确标题而非仅断言键存在。
  assert.equal(zh["settings.searchProviders.title"], "网络搜索");
  assert.equal(en["settings.searchProviders.title"], "Web Search");
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
