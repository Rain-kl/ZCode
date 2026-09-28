#!/usr/bin/env node
/**
 * 统一单测入口
 *
 * 为什么需要它：仓库里的测试是打散的 `*.test.ts`（`packages/<pkg>/test`、
 * `apps/<app>/packages/<pkg>/test`），各包 package.json 里没有 test 脚本，
 * 于是「补测试」这件事没有可执行的落点，同步上游后也没人跑。
 * 这里按包分组执行，并给每个包传它自己的 tsconfig —— `packages/ui` 的源码里用了
 * `@/*` 别名，只有带上 packages/ui/tsconfig.json 的 paths 才能解析。
 *
 * 用法：
 *   pnpm test:unit                    # 全部
 *   pnpm exec tsx --test <file>       # 单跑某个文件（排查时用）
 *
 * 约定：测试文件用 node:test + node:assert，不要 import 需要打包器别名/JSX 的模块，
 * 否则要么改用相对路径，要么把该模块的可测部分抽出来。见 AGENTS.md 的「依赖契约测试」。
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { resolveSpawnRuntimeOptions } from "./spawn-command.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const PNPM_COMMAND = "pnpm";
const TEST_FILE_SUFFIX = ".test.ts";

/**
 * 发现测试分组。分组粒度是「test 目录」而不是单个文件：
 * 同一个包的测试共享一份 tsconfig 与同一套模块解析，逐包执行也便于定位失败归属。
 */
function discoverTestGroups() {
  const groups = [];

  const addGroup = (testDir) => {
    if (!existsSync(testDir)) return;
    const files = readdirSync(testDir)
      .filter((name) => name.endsWith(TEST_FILE_SUFFIX))
      .sort()
      .map((name) => join(testDir, name));
    if (files.length === 0) return;
    groups.push({ testDir, packageDir: join(testDir, ".."), files });
  };

  const packagesDir = join(REPO_ROOT, "packages");
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (entry.isDirectory()) addGroup(join(packagesDir, entry.name, "test"));
  }

  // apps/<app>/packages/<pkg>/test（如 apps/zcode-cli/packages/core/test）
  const appsDir = join(REPO_ROOT, "apps");
  for (const app of readdirSync(appsDir, { withFileTypes: true })) {
    if (!app.isDirectory()) continue;
    const nestedPackagesDir = join(appsDir, app.name, "packages");
    if (!existsSync(nestedPackagesDir)) continue;
    for (const entry of readdirSync(nestedPackagesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) addGroup(join(nestedPackagesDir, entry.name, "test"));
    }
  }

  return groups.sort((left, right) => left.testDir.localeCompare(right.testDir));
}

function runGroup(group) {
  const displayName = relative(REPO_ROOT, group.testDir);
  const tsconfigPath = join(group.packageDir, "tsconfig.json");
  const env = { ...process.env };
  if (existsSync(tsconfigPath)) {
    // tsx 用这个变量选 tsconfig，才能拿到该包的 paths（`@/*` 等）。
    env.TSX_TSCONFIG_PATH = relative(REPO_ROOT, tsconfigPath);
  }

  console.log(`\n── ${displayName}（${group.files.length} 个文件）`);
  const result = spawnSync(PNPM_COMMAND, ["exec", "tsx", "--test", ...group.files], {
    cwd: REPO_ROOT,
    env,
    stdio: "inherit",
    ...resolveSpawnRuntimeOptions(PNPM_COMMAND),
  });

  if (result.error) throw result.error;
  return result.status === 0;
}

function main() {
  const groups = discoverTestGroups();
  if (groups.length === 0) {
    console.error("✗ 没有发现任何 *.test.ts，检查 discoverTestGroups 的目录约定");
    process.exitCode = 1;
    return;
  }

  const failedGroups = [];
  for (const group of groups) {
    if (!runGroup(group)) failedGroups.push(relative(REPO_ROOT, group.testDir));
  }

  if (failedGroups.length > 0) {
    console.error(`\n✗ ${failedGroups.length}/${groups.length} 组测试失败：`);
    for (const name of failedGroups) console.error(`  - ${name}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n✓ ${groups.length} 组测试全部通过`);
}

main();
