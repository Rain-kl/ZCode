/**
 * 本 fork 的桌面更新源：查询自己的 GitHub Release，而不是上游 zcode.z.ai 的服务端 manifest。
 *
 * 接入方式与取舍见 docs/features/github-update/design.md。要点：
 * - stable 基址用 GitHub 的 `releases/latest/download` 别名。GitHub 自己把 `latest` 定义为
 *   「最新的非 prerelease、非 draft 发布」，语义确定；不用 `provider: "github"`，
 *   因为它从 `releases.atom` 取第一条 entry 当最新版本，而该 feed 既包含 prerelease，
 *   本仓库的 entry 顺序还是「旧 → 新」，会解析到错误的 tag。
 * - preview 基址是固定 tag 的指针 Release，由发布流水线每次 `--clobber` 覆盖资产。
 * - 本模块保持纯函数：不 import electron / electron-updater，便于单测。
 */

import type { ElectronReleaseChannel } from "@zcode/shared";

/** 发布仓库；改这里即可把更新源指到别的 fork。 */
export const FORK_GITHUB_UPDATE_OWNER = "Rain-kl";
export const FORK_GITHUB_UPDATE_REPO = "ZCode";

/** preview 通道的指针 Release tag，只换资产、不移动 tag。 */
export const FORK_GITHUB_UPDATE_PREVIEW_TAG = "canary-build";

/**
 * preview 通道的 channel 名。electron-updater 的 channel 文件名规则是 `` `${channel}.yml` ``
 * （mac 追加 `-mac`），因此 preview 读 `dev.yml` / `dev-mac.yml`，
 * 与 electron-builder 对 `<version>-dev.<sha>` 这类 prerelease 版本生成的元数据文件名一致。
 */
export const FORK_GITHUB_UPDATE_PREVIEW_CHANNEL = "dev";

export const FORK_GITHUB_UPDATE_ORIGIN = "https://github.com";

export interface ForkGithubUpdateFeed {
  provider: "generic";
  url: string;
  useMultipleRangeRequest: false;
  channel?: string;
}

/** 只依赖被调用到的成员，避免把 electron-updater 的 AppUpdater 类型带进单测。 */
export interface ForkGithubUpdateUpdaterLike {
  setFeedURL(options: ForkGithubUpdateFeed): void;
  channel: string | null;
  allowPrerelease: boolean;
}

export function isForkPreviewUpdateChannel(channel: ElectronReleaseChannel): boolean {
  return channel === "preview";
}

/**
 * 基址必须当作**目录**，即以 `/` 结尾。
 *
 * 这不是风格问题：electron-updater 用 `newUrlFromBase(相对路径, baseUrl)` 解析 channel 文件与
 * 资产 URL，底层就是 `new URL(relative, base)`。基址不带尾斜杠时，最后一个路径段会被当成文件名丢掉：
 *
 *   base = .../releases/latest/download   -> .../releases/latest/a.zip        （404）
 *   base = .../releases/latest/download/  -> .../releases/latest/download/a.zip
 *
 * 尾斜杠要插进 pathname，不能直接拼在字符串末尾：`http://host/feed?v=2` 直接拼会得到
 * `http://host/feed?v=2/`，把 `/` 拼到了 query 后面。
 */
export function normalizeForkGithubUpdateBaseUrl(rawUrl: string): string {
  const url = new URL(rawUrl.trim());
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  return url.toString();
}

export function resolveForkGithubUpdateBaseUrl(options: {
  channel: ElectronReleaseChannel;
  /** dev 联调覆盖：整体替换基址（仅未打包时由调用方放行）。 */
  overrideBaseUrl?: string;
}): string {
  const override = options.overrideBaseUrl?.trim();
  if (override) {
    try {
      return normalizeForkGithubUpdateBaseUrl(override);
    } catch {
      // 覆盖地址只是联调开关：写错时退回真实 feed，并让调用方把生效地址打进日志。
      // 让 updater 初始化直接抛错的代价是更新入口静默消失，更难排查。
    }
  }

  const releaseRoot = `${FORK_GITHUB_UPDATE_ORIGIN}/${FORK_GITHUB_UPDATE_OWNER}/${FORK_GITHUB_UPDATE_REPO}/releases`;
  return isForkPreviewUpdateChannel(options.channel)
    ? `${releaseRoot}/download/${FORK_GITHUB_UPDATE_PREVIEW_TAG}/`
    : `${releaseRoot}/latest/download/`;
}

/** stable 用默认 channel 文件（`latest.yml`），因此返回 null 而不是空串。 */
export function resolveForkGithubUpdateChannel(
  channel: ElectronReleaseChannel,
): string | null {
  return isForkPreviewUpdateChannel(channel) ? FORK_GITHUB_UPDATE_PREVIEW_CHANNEL : null;
}

export function createForkGithubUpdateFeed(options: {
  channel: ElectronReleaseChannel;
  overrideBaseUrl?: string;
}): ForkGithubUpdateFeed {
  const channel = resolveForkGithubUpdateChannel(options.channel);
  return {
    provider: "generic",
    // generic provider 下载 GitHub 资产时是多段 Range 请求；GitHub 的响应头不满足
    // electron-updater 的 multipart 判定，留着只会退化成整包下载（与上游配置同因）。
    useMultipleRangeRequest: false,
    url: resolveForkGithubUpdateBaseUrl(options),
    ...(channel === null ? {} : { channel }),
  };
}

/**
 * 应用 feed。通道切换时必须重新调用，否则会拿新 channel 去请求旧基址（或反之）。
 * `allowPrerelease` 与 channel 同源，避免 electron-updater 内部对 prerelease 的判断分叉。
 */
export function applyForkGithubUpdateFeed(
  updater: ForkGithubUpdateUpdaterLike,
  options: { channel: ElectronReleaseChannel; overrideBaseUrl?: string },
): ForkGithubUpdateFeed {
  const feed = createForkGithubUpdateFeed(options);
  updater.allowPrerelease = isForkPreviewUpdateChannel(options.channel);
  updater.channel = feed.channel ?? null;
  updater.setFeedURL(feed);
  return feed;
}
