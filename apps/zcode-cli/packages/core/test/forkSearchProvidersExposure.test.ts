import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shouldExposeWebSearch } from "../src/runtime/methods/config.js";
import { resetSearchChannelCacheForTests } from "../src/fork/search-providers/channels.js";

const modelWith = (native: boolean) => ({ properties: { supportsNativeWebSearch: native } }) as never;

function homeWithTavilyChannel(enabled = true): string {
  const home = mkdtempSync(join(tmpdir(), "sp-"));
  const dir = join(home, ".zcode", "cli", "fork");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({
      version: 1,
      channels: [{ id: "a", kind: "tavily", label: "", enabled, apiKey: "k" }],
    }),
    "utf8",
  );
  return home;
}

test("无 model 时不过滤（注册表枚举语义不变）", () => {
  resetSearchChannelCacheForTests();
  assert.equal(
    shouldExposeWebSearch(undefined, { homeDir: mkdtempSync(join(tmpdir(), "sp-")) }),
    true,
  );
});

test("模型支持服务端搜索 → 暴露（与今天一致）", () => {
  resetSearchChannelCacheForTests();
  assert.equal(
    shouldExposeWebSearch(modelWith(true), { homeDir: mkdtempSync(join(tmpdir(), "sp-")) }),
    true,
  );
});

test("模型不支持且无 Tavily 渠道 → 不暴露（回归保护）", () => {
  resetSearchChannelCacheForTests();
  assert.equal(
    shouldExposeWebSearch(modelWith(false), { homeDir: mkdtempSync(join(tmpdir(), "sp-")) }),
    false,
  );
});

test("模型不支持但有启用的 Tavily 渠道 → 暴露（本次解锁的场景）", () => {
  resetSearchChannelCacheForTests();
  assert.equal(
    shouldExposeWebSearch(modelWith(false), { homeDir: homeWithTavilyChannel() }),
    true,
  );
});

test("唯一的 Tavily 渠道被禁用 → 回到不暴露", () => {
  resetSearchChannelCacheForTests();
  assert.equal(
    shouldExposeWebSearch(modelWith(false), { homeDir: homeWithTavilyChannel(false) }),
    false,
  );
});

test("生产形态：不传 options 且模型支持原生搜索 → 暴露", () => {
  resetSearchChannelCacheForTests();
  assert.equal(shouldExposeWebSearch(modelWith(true)), true);
});

test("生产形态：不传 options 且无 model → 暴露（注册表枚举）", () => {
  resetSearchChannelCacheForTests();
  assert.equal(shouldExposeWebSearch(undefined), true);
});
