import assert from "node:assert/strict";
import test from "node:test";
import {
  FORK_GITHUB_UPDATE_PREVIEW_CHANNEL,
  FORK_GITHUB_UPDATE_PREVIEW_TAG,
  applyForkGithubUpdateFeed,
  createForkGithubUpdateFeed,
  normalizeForkGithubUpdateBaseUrl,
  resolveForkGithubUpdateBaseUrl,
  resolveForkGithubUpdateChannel,
  type ForkGithubUpdateFeed,
  type ForkGithubUpdateUpdaterLike,
} from "../src/main/fork/github-update/feed.js";

const STABLE_BASE = "https://github.com/Rain-kl/ZCode/releases/latest/download/";
const PREVIEW_BASE = `https://github.com/Rain-kl/ZCode/releases/download/${FORK_GITHUB_UPDATE_PREVIEW_TAG}/`;

test("stable 走 releases/latest/download，preview 走指针 Release", () => {
  assert.equal(resolveForkGithubUpdateBaseUrl({ channel: "stable" }), STABLE_BASE);
  assert.equal(resolveForkGithubUpdateBaseUrl({ channel: "preview" }), PREVIEW_BASE);
});

test("基址必须以 / 结尾，否则 electron-updater 会吃掉最后一个路径段", () => {
  // electron-updater 用 `new URL(相对路径, base)` 解析 metadata 与资产：
  // base 不带尾斜杠时 `.../latest/download` 会被解析成 `.../latest/<asset>`（404）。
  // 这条契约由 packages/desktop/test/electronUpdaterFeedContract.test.ts 实证。
  for (const channel of ["stable", "preview"] as const) {
    assert.equal(resolveForkGithubUpdateBaseUrl({ channel }).endsWith("/"), true);
  }
  assert.equal(normalizeForkGithubUpdateBaseUrl("https://host/a/b"), "https://host/a/b/");
  assert.equal(normalizeForkGithubUpdateBaseUrl("https://host/a/b/"), "https://host/a/b/");
  // 尾斜杠要进 pathname，不能拼在 query 后面。
  assert.equal(normalizeForkGithubUpdateBaseUrl("https://host/feed?v=2"), "https://host/feed/?v=2");
});

test("只有 preview 使用 dev channel，stable 用默认 channel 文件", () => {
  assert.equal(resolveForkGithubUpdateChannel("stable"), null);
  assert.equal(resolveForkGithubUpdateChannel("preview"), FORK_GITHUB_UPDATE_PREVIEW_CHANNEL);
});

test("stable feed 不带 channel 字段，交给 electron-updater 用 latest.yml", () => {
  const feed = createForkGithubUpdateFeed({ channel: "stable" });
  assert.equal(feed.provider, "generic");
  assert.equal(feed.url, STABLE_BASE);
  assert.equal(feed.useMultipleRangeRequest, false);
  assert.equal("channel" in feed, false);
});

test("preview feed 带 dev channel，对应 dev.yml / dev-mac.yml", () => {
  const feed = createForkGithubUpdateFeed({ channel: "preview" });
  assert.equal(feed.url, PREVIEW_BASE);
  assert.equal(feed.channel, "dev");
});

test("dev 联调覆盖基址时只换地址，不改变 channel 语义", () => {
  const feed = createForkGithubUpdateFeed({
    channel: "stable",
    overrideBaseUrl: "http://127.0.0.1:8081/releases",
  });
  // 补上尾斜杠：本地 feed 同样是「目录」语义。
  assert.equal(feed.url, "http://127.0.0.1:8081/releases/");
  assert.equal("channel" in feed, false);

  const blank = createForkGithubUpdateFeed({ channel: "stable", overrideBaseUrl: "   " });
  assert.equal(blank.url, STABLE_BASE);

  // 写错的覆盖地址不能把 updater 初始化打挂，退回真实 feed。
  const invalid = createForkGithubUpdateFeed({ channel: "stable", overrideBaseUrl: "not a url" });
  assert.equal(invalid.url, STABLE_BASE);
});

function createUpdaterStub(): ForkGithubUpdateUpdaterLike & { applied: ForkGithubUpdateFeed[] } {
  return {
    applied: [] as ForkGithubUpdateFeed[],
    allowPrerelease: false,
    channel: null as string | null,
    setFeedURL(options: ForkGithubUpdateFeed) {
      this.applied.push(options);
    },
  };
}

test("应用 feed 时同步 allowPrerelease 与 channel", () => {
  const updater = createUpdaterStub();

  applyForkGithubUpdateFeed(updater, { channel: "stable" });
  assert.equal(updater.channel, null);
  assert.equal(updater.allowPrerelease, false);

  applyForkGithubUpdateFeed(updater, { channel: "preview" });
  assert.equal(updater.channel, "dev");
  assert.equal(updater.allowPrerelease, true);

  assert.deepEqual(
    updater.applied.map((feed) => feed.url),
    [STABLE_BASE, PREVIEW_BASE],
  );
});

test("通道切换后再次应用 feed 会同时换基址与 channel", () => {
  const updater = createUpdaterStub();
  applyForkGithubUpdateFeed(updater, { channel: "preview" });
  applyForkGithubUpdateFeed(updater, { channel: "stable" });

  // 只换 channel 不换基址（或反之）会让 preview 去 latest/download 找 dev.yml。
  assert.deepEqual(updater.applied.at(-1), {
    provider: "generic",
    url: STABLE_BASE,
    useMultipleRangeRequest: false,
  });
  assert.equal(updater.channel, null);
});
