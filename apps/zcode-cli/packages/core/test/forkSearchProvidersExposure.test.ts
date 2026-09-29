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
    shouldExposeWebSearch.call({ homeDir: mkdtempSync(join(tmpdir(), "sp-")) }, undefined),
    true,
  );
});

test("模型支持服务端搜索 → 暴露（与今天一致）", () => {
  resetSearchChannelCacheForTests();
  assert.equal(
    shouldExposeWebSearch.call({ homeDir: mkdtempSync(join(tmpdir(), "sp-")) }, modelWith(true)),
    true,
  );
});

test("模型不支持且无 Tavily 渠道 → 不暴露（回归保护）", () => {
  resetSearchChannelCacheForTests();
  assert.equal(
    shouldExposeWebSearch.call({ homeDir: mkdtempSync(join(tmpdir(), "sp-")) }, modelWith(false)),
    false,
  );
});

test("模型不支持但有启用的 Tavily 渠道 → 暴露（本次解锁的场景）", () => {
  resetSearchChannelCacheForTests();
  assert.equal(shouldExposeWebSearch.call({ homeDir: homeWithTavilyChannel() }, modelWith(false)), true);
});

test("唯一的 Tavily 渠道被禁用 → 回到不暴露", () => {
  resetSearchChannelCacheForTests();
  assert.equal(
    shouldExposeWebSearch.call({ homeDir: homeWithTavilyChannel(false) }, modelWith(false)),
    false,
  );
});
