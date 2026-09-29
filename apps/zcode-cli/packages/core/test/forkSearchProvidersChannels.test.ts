import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  countAvailableSearchChannels,
  loadForkSearchChannels,
  resetSearchChannelCacheForTests,
} from "../src/fork/search-providers/channels.js";

const httpClientPort = { async request() { throw new Error("not used"); } };
const modelWith = (native: boolean) =>
  ({ properties: { supportsNativeWebSearch: native } }) as never;

function writeChannelsFile(home: string, payload: unknown, mtimeSeconds?: number): string {
  const dir = join(home, ".zcode", "cli", "fork");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "settings.json");
  writeFileSync(file, JSON.stringify(payload), "utf8");
  if (mtimeSeconds !== undefined) utimesSync(file, mtimeSeconds, mtimeSeconds);
  return file;
}

test("文件缺失 = 0 条 Tavily 渠道，不抛错", () => {
  resetSearchChannelCacheForTests();
  const home = mkdtempSync(join(tmpdir(), "sp-"));
  assert.deepEqual(loadForkSearchChannels({ homeDir: home, httpClientPort }), []);
});

test("只把启用中的渠道变成可调用渠道，顺序保持", () => {
  resetSearchChannelCacheForTests();
  const home = mkdtempSync(join(tmpdir(), "sp-"));
  writeChannelsFile(home, {
    version: 1,
    channels: [
      { id: "a", kind: "tavily", label: "一", enabled: true, apiKey: "k1" },
      { id: "b", kind: "tavily", label: "二", enabled: false, apiKey: "k2" },
      { id: "c", kind: "tavily", label: "三", enabled: true, apiKey: "k3" },
    ],
  });
  const channels = loadForkSearchChannels({ homeDir: home, httpClientPort });
  assert.deepEqual(channels.map((c) => c.id), ["a", "c"]);
});

test("mtime 变化让缓存失效（WebDAV 恢复整体替换文件的场景）", () => {
  resetSearchChannelCacheForTests();
  const home = mkdtempSync(join(tmpdir(), "sp-"));
  writeChannelsFile(
    home,
    { version: 1, channels: [{ id: "a", kind: "tavily", label: "旧", enabled: true, apiKey: "old" }] },
    1_000_000,
  );
  assert.deepEqual(
    loadForkSearchChannels({ homeDir: home, httpClientPort }).map((c) => c.label),
    ["旧"],
  );
  writeChannelsFile(
    home,
    { version: 1, channels: [{ id: "a", kind: "tavily", label: "新", enabled: true, apiKey: "new" }] },
    2_000_000,
  );
  assert.deepEqual(
    loadForkSearchChannels({ homeDir: home, httpClientPort }).map((c) => c.label),
    ["新"],
  );
});

test("文件损坏 = 0 条渠道，不抛错", () => {
  resetSearchChannelCacheForTests();
  const home = mkdtempSync(join(tmpdir(), "sp-"));
  const dir = join(home, ".zcode", "cli", "fork");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.json"), "{ not json", "utf8");
  assert.deepEqual(loadForkSearchChannels({ homeDir: home, httpClientPort }), []);
});

test("渠道数 = 服务端能力 + 启用中的 Tavily 数", () => {
  resetSearchChannelCacheForTests();
  const home = mkdtempSync(join(tmpdir(), "sp-"));
  assert.equal(countAvailableSearchChannels({ homeDir: home, model: modelWith(false) }), 0);
  assert.equal(countAvailableSearchChannels({ homeDir: home, model: modelWith(true) }), 1);
  writeChannelsFile(home, {
    version: 1,
    channels: [
      { id: "a", kind: "tavily", enabled: true, apiKey: "k" },
      { id: "b", kind: "tavily", enabled: false, apiKey: "k" },
    ],
  });
  assert.equal(countAvailableSearchChannels({ homeDir: home, model: modelWith(false) }), 1);
  assert.equal(countAvailableSearchChannels({ homeDir: home, model: modelWith(true) }), 2);
});
