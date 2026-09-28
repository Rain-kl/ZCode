#!/usr/bin/env node

/**
 * 发布流水线的版本注入与产物校验。
 *
 * 背景：桌面端只在**构建期**从根 package.json 读取版本——build-metadata.mjs 把它写进
 * out/metadata/build-meta.json，再分别喂给 tsup/vite 的 __ZCODE_VERSION__ 和
 * electron-builder 的 extraMetadata.version。仓库没有任何环境变量覆盖入口，
 * 所以 CI 必须在打包前改写根 package.json，否则 tag 版本不会进入程序与产物文件名。
 *
 * apply 用法：
 *   node scripts/ci/release-version.mjs apply --tag v3.14.3
 *   node scripts/ci/release-version.mjs apply --dev-commit 1a2b3c4d
 *   node scripts/ci/release-version.mjs apply --version 3.14.3-dev.1a2b3c4d
 *
 * verify 用法（校验产物内实际携带的版本与提交号）：
 *   node scripts/ci/release-version.mjs verify --expect 3.14.3 \
 *     --asar packages/desktop/dist-mac-arm64/mac-arm64/ZCode.app/Contents/Resources/app.asar \
 *     [--expect-commit <full-sha>]
 *
 * 约定：apply 的机器可读结果（version=... / channel=...）写到 stdout，便于直接追加到
 * GITHUB_OUTPUT；人类可读日志一律走 stderr，避免污染 step output。
 */

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PACKAGE_JSON_PATH = "package.json";
// electron-builder 不接受 build metadata 段（`+`），因此这里只放行可选 prerelease。
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;
const DEV_COMMIT_LENGTH = 8;

function log(message) {
  process.stderr.write(`[release-version] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[release-version] ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, root: repositoryRoot };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const value = rest[index + 1];
    switch (arg) {
      case "--tag":
      case "--dev-commit":
      case "--version":
      case "--expect":
      case "--expect-commit":
      case "--asar":
      case "--root": {
        if (!value || value.startsWith("--")) {
          fail(`参数 ${arg} 缺少取值`);
        }
        options[arg.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] =
          value;
        index += 1;
        break;
      }
      default:
        fail(`不支持的参数: ${arg}`);
    }
  }

  return options;
}

/** 去掉 tag/环境里可能存在的 `v` 前缀与首尾空白，保持与 build-metadata.mjs 的 normalizeVersion 同口径。 */
function normalizeVersion(rawVersion) {
  const trimmed = rawVersion?.trim() ?? "";
  const withoutPrefix = trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
  if (!SEMVER_PATTERN.test(withoutPrefix)) {
    fail(`版本号不是合法 semver: ${rawVersion}`);
  }
  return withoutPrefix;
}

function resolveVersion(options) {
  if (options.version) {
    return { version: normalizeVersion(options.version), channel: "stable" };
  }

  if (options.tag) {
    return { version: normalizeVersion(options.tag), channel: "stable" };
  }

  if (options.devCommit) {
    if (!COMMIT_PATTERN.test(options.devCommit)) {
      fail(`提交号不是合法 SHA: ${options.devCommit}`);
    }
    const commit = options.devCommit.toLowerCase().slice(0, DEV_COMMIT_LENGTH);
    // 基底版本只取 x.y.z：重复的集成构建不能把上一次的 prerelease 段层层叠加。
    const baseVersion = readPackageJson(options.root).version.split("-")[0];
    const version = `${normalizeVersion(baseVersion)}-dev.${commit}`;
    return { version, channel: "dev" };
  }

  fail("apply 需要 --tag、--dev-commit 或 --version 之一");
}

function readPackageJson(root) {
  const packageJsonPath = resolve(root, PACKAGE_JSON_PATH);
  return { ...JSON.parse(readFileSync(packageJsonPath, "utf8")), packageJsonPath };
}

function setRootVersion(root, version) {
  const { packageJsonPath, ...packageJson } = readPackageJson(root);
  const previousVersion = packageJson.version;
  if (previousVersion === version) {
    log(`${PACKAGE_JSON_PATH} 版本已是 ${version}，无需改写`);
    return previousVersion;
  }

  packageJson.version = version;
  // 与仓库现有格式保持一致（2 空格缩进 + 末尾换行），避免 CI 里产生无关 diff。
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  log(`${PACKAGE_JSON_PATH} 版本 ${previousVersion} → ${version}`);
  return previousVersion;
}

function applyVersion(options) {
  const { version, channel } = resolveVersion(options);
  setRootVersion(options.root, version);
  // 机器可读输出：调用方直接 `>> "$GITHUB_OUTPUT"`。
  process.stdout.write(`version=${version}\nchannel=${channel}\n`);
}

function loadAsar() {
  const requireFromDesktop = createRequire(
    resolve(repositoryRoot, "packages/desktop/package.json"),
  );
  try {
    return requireFromDesktop("@electron/asar");
  } catch (error) {
    fail(`无法从 packages/desktop 解析 @electron/asar，请先执行 pnpm install: ${error.message}`);
  }
}

function extractAsarFile(asar, asarPath, fileName) {
  try {
    return asar.extractFile(asarPath, fileName);
  } catch (error) {
    fail(`读取 ${asarPath} 内的 ${fileName} 失败: ${error.message}`);
  }
}

function verifyArtifact(options) {
  if (!options.expect || !options.asar) {
    fail("verify 需要 --expect 与 --asar");
  }
  const expectedVersion = normalizeVersion(options.expect);
  const asarPath = resolve(options.root, options.asar);
  const asar = loadAsar();

  // 1) 安装包内 package.json 的 version：electron-builder extraMetadata 写入，运行时 app.getVersion() 读它。
  const packagedVersion = JSON.parse(
    extractAsarFile(asar, asarPath, "package.json").toString("utf8"),
  ).version;
  if (packagedVersion !== expectedVersion) {
    fail(`产物版本不一致: 期望 ${expectedVersion}，app.asar 内为 ${packagedVersion} (${asarPath})`);
  }

  // 2) build-meta.json：About 面板与遥测的版本/提交来源，编译期由 build-metadata.mjs 落盘。
  const buildMeta = JSON.parse(
    extractAsarFile(asar, asarPath, "out/metadata/build-meta.json").toString("utf8"),
  );
  if (buildMeta.appVersion !== expectedVersion) {
    fail(
      `产物 build-meta 版本不一致: 期望 ${expectedVersion}，实际 ${buildMeta.appVersion} (${asarPath})`,
    );
  }

  if (options.expectCommit) {
    const expectedCommit = options.expectCommit.toLowerCase();
    // build-meta 记录的是 --short=8 的短 SHA，因此比对前缀而不是全等。
    const recordedCommit = String(buildMeta.buildCommitId).toLowerCase();
    if (!COMMIT_PATTERN.test(expectedCommit) || !expectedCommit.startsWith(recordedCommit)) {
      fail(
        `产物提交号不一致: 期望 ${expectedCommit.slice(0, DEV_COMMIT_LENGTH)}，实际 ${buildMeta.buildCommitId}`,
      );
    }
  }

  log(
    `校验通过: version=${packagedVersion} commit=${buildMeta.buildCommitId} buildTime=${buildMeta.buildTime}`,
  );
  process.stdout.write(`verified=${packagedVersion}\n`);
}

const options = parseArgs(process.argv.slice(2));

switch (options.command) {
  case "apply":
    applyVersion(options);
    break;
  case "verify":
    verifyArtifact(options);
    break;
  default:
    fail("用法: release-version.mjs <apply|verify> [options]");
}
