import assert from "node:assert/strict";
import test from "node:test";

import { FORK_TOOL_MODES } from "@zcode/shared";

import { forkToolModeSummaryId, forkToolModeTitleId } from "../src/fork/tool-modes/modeCopy.js";

/**
 * 功能组面板的文案契约。
 *
 * 面板的卡片是按 `FORK_TOOL_MODES` 生成的，正文只活在 locale 里：档位加了而文案没跟上时，
 * 界面会把键名当正文显示（`formatMessage` 的缺省行为），编译期与类型检查都不会报错。
 * 所以这里逐个档位断言两种语言都有标题与正文——这是 `packages/ui` 侧能抓到这个漏项的唯一位置。
 */
async function loadLocales(): Promise<{ zh: Record<string, string>; en: Record<string, string> }> {
  const zh = (await import("../src/i18n/locales/zh-CN.js")).default as Record<string, string>;
  const en = (await import("../src/i18n/locales/en-US.js")).default as Record<string, string>;
  return { zh, en };
}

test("每个档位在两种语言里都有卡片标题与正文", async () => {
  const { zh, en } = await loadLocales();

  for (const mode of FORK_TOOL_MODES) {
    const titleId = forkToolModeTitleId(mode);
    const summaryId = forkToolModeSummaryId(mode);
    // 标题与正文必须是两个键：合成一条会让卡片退化成一整段文字，也比较不了。
    assert.notEqual(titleId, summaryId);

    for (const [locale, messages] of [
      ["zh-CN", zh],
      ["en-US", en],
    ] as const) {
      assert.ok(messages[titleId], `${locale} 缺少档位标题 ${titleId}`);
      assert.ok(messages[summaryId], `${locale} 缺少档位正文 ${summaryId}`);
    }
  }
});

test("卡片正文写的是分组，不是工具名", async () => {
  const { zh, en } = await loadLocales();
  const summaries = FORK_TOOL_MODES.flatMap((mode) => [
    zh[forkToolModeSummaryId(mode)],
    en[forkToolModeSummaryId(mode)],
  ]);

  for (const summary of summaries) {
    // 缺文案先在上一条用例里报（那时才有「哪个档位、哪种语言」的上下文），这里只做形态检查。
    assert.equal(typeof summary, "string", "卡片正文缺失，先看「每个档位…都有卡片标题与正文」");
    // 逐工具清单的权威来源是 core 的注册表分类，渲染层抄一份必然漂移；
    // 卡片只说「这一类工具」在不在（见 design.md 第 8 节）。出现驼峰或下划线标识符即视为抄了工具名。
    assert.doesNotMatch(summary, /[a-z]+[A-Z]|[a-z]+_[a-z]+/, `卡片正文里出现了工具名：${summary}`);
  }
});

test("面板的行文案在两种语言里都有", async () => {
  const { zh, en } = await loadLocales();
  const requiredKeys = [
    "settings.toolGroups.title",
    "settings.toolGroups.injectTools",
    "settings.toolGroups.injectToolsHint",
    "settings.toolGroups.mode",
    "settings.toolGroups.injectionOffHint",
    "settings.toolGroups.takesEffectOnNewSessionHint",
    "settings.toolGroups.unavailable",
  ];

  for (const key of requiredKeys) {
    assert.ok(zh[key], `zh-CN 缺少 ${key}`);
    assert.ok(en[key], `en-US 缺少 ${key}`);
  }
});
