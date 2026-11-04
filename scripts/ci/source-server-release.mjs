import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const descriptorName = "source-server-release.json";
const targets = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"];
const devVersionPattern = /^\d+\.\d+\.\d+-dev\.[0-9a-f]{8}$/u;

export function sourceServerReleaseTag(version) {
  return devVersionPattern.test(version)
    ? "server-canary-build"
    : `server-v${version}`;
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifySourceServerRelease(dir, version) {
  const descriptor = JSON.parse(
    await readFile(join(dir, descriptorName), "utf8"),
  );
  if (descriptor.schemaVersion !== 1 || descriptor.version !== version) {
    throw new Error(
      `Invalid Source Server descriptor version: expected ${version}, received ${descriptor.version}`,
    );
  }
  if (
    !Array.isArray(descriptor.archives) ||
    descriptor.archives.length !== targets.length ||
    new Set(descriptor.archives.map((archive) => archive.target)).size !==
      targets.length
  ) {
    throw new Error(
      "Source Server descriptor must contain all four distinct release targets",
    );
  }
  for (const archive of descriptor.archives) {
    if (
      !targets.includes(archive.target) ||
      archive.version !== version ||
      archive.fileName !== `zcode-server-${archive.target}.tar.gz` ||
      JSON.stringify(archive.urls) !== JSON.stringify([archive.fileName])
    ) {
      throw new Error(
        `Invalid Source Server archive contract for ${archive.target}`,
      );
    }
    const path = join(dir, archive.fileName);
    if (
      !Number.isSafeInteger(archive.sizeBytes) ||
      archive.sizeBytes <= 0 ||
      (await stat(path)).size !== archive.sizeBytes ||
      !/^[a-f0-9]{64}$/u.test(archive.sha256) ||
      (await sha256(path)) !== archive.sha256
    ) {
      throw new Error(`Source Server archive verification failed: ${path}`);
    }
    const manifestPath = `zcode-server-${archive.target}/manifest.json`;
    const { stdout } = await exec("tar", ["-xOzf", path, manifestPath]);
    const manifest = JSON.parse(stdout);
    if (
      manifest.product !== "zcode-server" ||
      manifest.appVersion !== version ||
      manifest.target !== archive.target
    ) {
      throw new Error(
        `Source Server archive manifest mismatch: ${path}; expected ${version}/${archive.target}, received ${manifest.appVersion}/${manifest.target}`,
      );
    }
    // 安装器和 CLI 均依赖此随包配置；只检查 --version 会漏过实际启动时的资源缺失。
    const providerPath = `zcode-server-${archive.target}/runtime/provider/zcode-builtin.json`;
    try {
      const { stdout: provider } = await exec("tar", [
        "-xOzf",
        path,
        providerPath,
      ]);
      const config = JSON.parse(provider);
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new Error("provider config must be a JSON object");
      }
    } catch (cause) {
      throw new Error(
        `Invalid Source Server provider resource: ${path}/${providerPath}`,
        {
          cause,
        },
      );
    }
  }
  return descriptor;
}

async function gh(args) {
  const { stdout } = await exec("gh", args, { maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

async function readRelease(repo, tag, run) {
  try {
    const release = JSON.parse(
      await run(["api", `repos/${repo}/releases/tags/${tag}`]),
    );
    if (typeof release.draft !== "boolean")
      throw new Error(`Invalid GitHub release response for ${tag}`);
    return release;
  } catch (error) {
    // GitHub 鉴权/网络错误不能伪装成“不存在”。
    if (!(error instanceof Error) || !/HTTP 404/u.test(error.message))
      throw error;
    return null;
  }
}

export async function reuseSourceServerRelease(
  { dir, version, repo },
  run = gh,
) {
  const tag = sourceServerReleaseTag(version);
  const release = await readRelease(repo, tag, run);
  if (!release || release.draft) return false;
  await run([
    "release",
    "download",
    tag,
    "--repo",
    repo,
    "--dir",
    dir,
    "--clobber",
  ]);
  try {
    await verifySourceServerRelease(dir, version);
  } catch (error) {
    // 固定 dev Release 在新提交上天然还是上一版本；这是重建信号，不是发布损坏。
    if (
      devVersionPattern.test(version) &&
      error instanceof Error &&
      error.message.startsWith("Invalid Source Server descriptor version:")
    ) {
      await rm(dir, { recursive: true, force: true });
      return false;
    }
    throw error;
  }
  return true;
}

async function cleanupLegacyDevSourceServerReleases(repo, run) {
  const tags = await run([
    "release",
    "list",
    "--repo",
    repo,
    "--limit",
    "1000",
    "--json",
    "tagName",
    "--jq",
    ".[].tagName",
  ]);
  for (const tag of tags.split(/\r?\n/u).filter(Boolean)) {
    if (!/^server-v\d+\.\d+\.\d+-dev\./u.test(tag)) continue;
    await run([
      "release",
      "delete",
      tag,
      "--repo",
      repo,
      "--yes",
      "--cleanup-tag",
    ]);
  }
}

export async function publishSourceServerRelease(
  { dir, version, repo, commit },
  run = gh,
) {
  if (
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version) ||
    !/^[\w.-]+\/[\w.-]+$/u.test(repo) ||
    !/^[a-f0-9]{8,40}$/u.test(commit)
  ) {
    throw new Error(
      "Invalid Source Server release version, repository or commit",
    );
  }
  const descriptor = await verifySourceServerRelease(dir, version);
  const isDev = devVersionPattern.test(version);
  const tag = sourceServerReleaseTag(version);
  const release = await readRelease(repo, tag, run);
  if (!isDev && release && !release.draft) {
    const existingDir = await mkdtemp(
      join(tmpdir(), "zcode-server-published-"),
    );
    try {
      await run([
        "release",
        "download",
        tag,
        "--repo",
        repo,
        "--dir",
        existingDir,
      ]);
      const existing = await verifySourceServerRelease(existingDir, version);
      for (const archive of descriptor.archives) {
        const previous = existing.archives.find(
          (entry) => entry.target === archive.target,
        );
        if (
          previous.sha256 !== archive.sha256 ||
          previous.sizeBytes !== archive.sizeBytes
        ) {
          throw new Error(
            `Refusing to replace published Source Server ${tag}/${archive.fileName}: content changed`,
          );
        }
      }
      return;
    } finally {
      await rm(existingDir, { recursive: true, force: true });
    }
  }
  if (isDev && release) {
    // GitHub 不支持置顶 prerelease；删除 Release 但保留固定 tag，再重新公开，更新时间会回到列表前部。
    await run(["release", "delete", tag, "--repo", repo, "--yes"]);
  }
  if (!release || isDev) {
    await run([
      "release",
      "create",
      tag,
      "--repo",
      repo,
      ...(release ? ["--verify-tag"] : ["--target", commit]),
      "--draft",
      "--prerelease",
      "--latest=false",
      "--title",
      isDev
        ? "Source Server Dev channel (latest canary)"
        : `Source Server ${version}`,
      "--notes",
      `Companion runtime for ZCode ${version}. Commit: ${commit}.`,
    ]);
  }
  // draft 失败可安全重跑；正式版公开后只校验，绝不覆盖同版本运行时或移动 tag。
  await run([
    "release",
    "upload",
    tag,
    "--repo",
    repo,
    ...descriptor.archives.map((archive) => join(dir, archive.fileName)),
    "--clobber",
  ]);
  await run([
    "release",
    "upload",
    tag,
    "--repo",
    repo,
    join(dir, descriptorName),
    "--clobber",
  ]);
  await run([
    "release",
    "edit",
    tag,
    "--repo",
    repo,
    "--draft=false",
    "--prerelease",
    "--latest=false",
  ]);
  if (isDev) await cleanupLegacyDevSourceServerReleases(repo, run);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [command, dir, version] = process.argv.slice(2);
  if (!dir || !version || !["verify", "publish", "reuse"].includes(command)) {
    throw new Error(
      "Usage: source-server-release.mjs <verify|publish|reuse> <asset-dir> <version>",
    );
  }
  if (command === "verify") await verifySourceServerRelease(dir, version);
  else if (command === "reuse") {
    const reused = await reuseSourceServerRelease({
      dir,
      version,
      repo: process.env.GH_REPO,
    });
    // 只输出机器结果，便于 CI 决定是否需要重新构建。
    console.log(`reused=${reused}`);
  } else
    await publishSourceServerRelease({
      dir,
      version,
      repo: process.env.GH_REPO,
      commit: process.env.COMMIT,
    });
  if (command !== "reuse")
    console.log(`[source-server-release] ${command} complete: ${version}`);
}
