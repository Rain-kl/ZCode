import test from "node:test";
import assert from "node:assert/strict";
import { isChannelAvailable } from "../src/channelManifest.js";

// FORK(rpc-channel-manifest): 契约测试——上游若改动「清单缺失 = 视为可用」这条语义，
// 这里必须变红；见 FEATURES.md 的 rpc-channel-manifest 条目。
test("清单未知（旧服务端/握手未完成）时任何通道都视为可用", () => {
  assert.equal(isChannelAvailable(undefined, "fork-webdav"), true);
  assert.equal(isChannelAvailable(undefined, "file"), true);
});

test("清单已知时只认清单里声明过的通道", () => {
  const manifest = ["file", "setting", "zcode-agent"] as const;
  assert.equal(isChannelAvailable(manifest, "file"), true);
  assert.equal(isChannelAvailable(manifest, "fork-webdav"), false);
  assert.equal(isChannelAvailable(manifest, "fork-identity-preset"), false);
});

test("清单为空数组按未知处理：本端零通道不等于「全部不可用」", () => {
  // 空数组若当成「清单已知且为空」，装配顺序早于注册的服务端会把所有真实服务显示成不支持。
  assert.equal(isChannelAvailable([], "file"), true);
});

test("匹配是精确匹配，不受前缀/子串影响", () => {
  const manifest = ["file", "file-watcher"];
  assert.equal(isChannelAvailable(manifest, "file-watcher"), true);
  assert.equal(isChannelAvailable(manifest, "file-watch"), false);
  assert.equal(isChannelAvailable(manifest, "fil"), false);
});
