import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "electron-updater/out/providerFactory.js";
import { GenericProvider } from "electron-updater/out/providers/GenericProvider.js";
import { resolveFiles } from "electron-updater/out/providers/Provider.js";

/**
 * 依赖契约测试：断言**我们依赖的 electron-updater 行为**，不是复述它的实现。
 *
 * 为什么要有这个文件：`packages/desktop/src/main/fork/github-update/feed.ts` 与发布流水线
 * 都建立在几个第三方契约上——channel 决定更新元数据文件名、generic provider 沿用
 * `useMultipleRangeRequest`、资产相对路径按 feed 基址解析。这些能力**不在类型签名里**
 * （默认值、文件名拼接、URL 解析语义），上游改掉它们不会产生类型错误，只会让
 * 「发现更新」在运行时静默变成 404 或整包下载。所以把期望固化成断言。
 *
 * 深路径 import 是刻意的：这些能力没有从 electron-updater 包根导出。
 * 若某次升级后 import 失败，正说明契约面移动了 —— 先确认行为是否仍然成立，
 * 再更新 import 路径，不要在没确认的情况下改断言。
 */

const FEED_URL = "https://github.com/Rain-kl/ZCode/releases/latest/download/";

/** 只提供 provider 会读到的成员，避免把 Electron 的 AppUpdater 拖进单测。 */
const updaterStub = { channel: null, isAddNoCacheQuery: false };

function createProvider(configuration, runtimeOptions) {
  return new GenericProvider({ provider: "generic", url: FEED_URL, ...configuration }, updaterStub, {
    isUseMultipleRangeRequest: false,
    ...runtimeOptions,
  });
}

test("generic feed 必须沿用 useMultipleRangeRequest: false", () => {
  // 这条决定差分下载是否退化成整包：GitHub 的 Range 响应头不满足 electron-updater 的
  // multipart 判定，一旦被改回默认（true）会让 Windows 更新从约 15MB 变成整包。
  const client = createClient(
    { provider: "generic", url: FEED_URL, useMultipleRangeRequest: false },
    updaterStub,
    { isUseMultipleRangeRequest: true, platform: "darwin" },
  );
  assert.equal(client.isUseMultipleRangeRequest, false);
});

test("channel 与平台后缀决定更新元数据文件名（CI 上传清单依赖它）", () => {
  // 流水线上传与客户端请求必须用同一套命名：stable → latest.yml / latest-mac.yml，
  // preview → dev.yml / dev-mac.yml。后缀规则变了会让客户端直接报找不到 channel 文件。
  const cases = [
    { platform: "darwin", suffix: "-mac" },
    { platform: "win32", suffix: "" },
  ];
  for (const { platform, suffix } of cases) {
    assert.equal(createProvider({ channel: "dev" }, { platform }).channel, `dev${suffix}`);
    // 不带 channel 时退回默认名，对应 stable 通道。
    assert.equal(createProvider({}, { platform }).channel, `latest${suffix}`);
  }
});

test("linux 的 channel 文件名带上架构后缀", () => {
  // 本 fork 不发布 linux 包，但这条规则会改变"同一份 yml 名称"的假设，
  // 所以钉住它。TEST_UPDATER_ARCH 是该实现读取的覆盖点，用它让断言与宿主架构无关。
  const previous = process.env.TEST_UPDATER_ARCH;
  try {
    process.env.TEST_UPDATER_ARCH = "x64";
    assert.equal(createProvider({ channel: "dev" }, { platform: "linux" }).channel, "dev-linux");
    process.env.TEST_UPDATER_ARCH = "arm64";
    assert.equal(createProvider({ channel: "dev" }, { platform: "linux" }).channel, "dev-linux-arm64");
  } finally {
    if (previous === undefined) delete process.env.TEST_UPDATER_ARCH;
    else process.env.TEST_UPDATER_ARCH = previous;
  }
});

test("updater.channel 覆盖 feed 里的 channel", () => {
  // feed.ts 同时设置两者，靠的就是这个优先级；若反过来，preview 会去请求 stable 的元数据。
  const provider = createProvider({ channel: "dev" }, { platform: "darwin" });
  assert.equal(provider.channel, "dev-mac");

  const updaterDriven = new GenericProvider(
    { provider: "generic", url: FEED_URL, channel: "dev" },
    { channel: "latest", isAddNoCacheQuery: false },
    { isUseMultipleRangeRequest: false, platform: "darwin" },
  );
  assert.equal(updaterDriven.channel, "latest-mac");
});

test("资产相对路径按 feed 基址解析，基址必须带尾斜杠", () => {
  const updateInfo = {
    version: "3.14.4",
    files: [{ url: "ZCode-3.14.4-mac-arm64.zip", sha512: "abc", size: 1 }],
  };

  const resolved = resolveFiles(updateInfo, new URL(FEED_URL));
  assert.equal(resolved[0].url.href, `${FEED_URL}ZCode-3.14.4-mac-arm64.zip`);

  // 这个断言是刻意的：不带尾斜杠时 electron-updater 会把最后一个路径段当成文件名丢掉，
  // 资产与 metadata 全部 404（本项目最初就是这么写错的，靠这条测试才发现）。
  // 钉住它，防止以后有人「顺手」把 feed.ts 里的尾斜杠去掉。
  const withoutTrailingSlash = resolveFiles(
    updateInfo,
    new URL("https://github.com/Rain-kl/ZCode/releases/latest/download"),
  );
  assert.equal(
    withoutTrailingSlash[0].url.href,
    "https://github.com/Rain-kl/ZCode/releases/latest/ZCode-3.14.4-mac-arm64.zip",
  );
});

test("更新元数据缺少 checksum 时必须抛错", () => {
  // 供应链校验只有 yml 里的 sha512。若上游把它降级成"缺失即跳过"，
  // 我们就必须在发布流水线侧自己补上校验，不能默认它一定检查。
  assert.throws(
    () => resolveFiles({ version: "3.14.4", files: [{ url: "a.zip" }] }, new URL(FEED_URL)),
    /checksum/i,
  );
});
