#!/usr/bin/env node
/**
 * fork 移除不变量检查（Fork removal invariants）
 *
 * 解决的问题：二开删掉的文件/符号，在上游同步时可能悄悄回来，而 git 不会提醒你。
 * 实测（见 .agents/notes/github-update/decisions.md）：
 *   - 情况 A：上游没碰被删文件 → 删除保留，无冲突（文件不会回来）；
 *   - 情况 B：上游改了被删文件 → `CONFLICT (modify/delete)`，git 把上游版本留在工作区，
 *            需要人工裁决。这里最现实的失误是「顺手保留上游版本」，等于撤销删除；
 *   - 情况 C：上游用**新文件**重新实现同一功能 → 0 冲突，完全静默；
 *   - 情况 D：删掉的是文件里的符号，上游在**别的文件**新增调用 → 0 冲突，静默；
 *            能否被发现只取决于该文件是否在类型检查范围内（本仓库
 *            `packages/desktop/src/main` 恰好不在 `pnpm typecheck` 覆盖内）。
 *
 * 所以这里断言的不是「路径墓碑」（只覆盖 A/B 的一部分），而是**行为不变量**：
 * 被移除的符号、接口、配置文件内容必须仍然缺席，我们那版接线必须仍然在位。
 * 每次同步上游之后必须跑一次，它把「静默回归」变成红灯。
 *
 * 用法：node scripts/check-fork-removals.mjs   （或 pnpm fork:check-removals）
 * 新增二开移除项时，在 FEATURES.md 条目里登记，并把规则加进下面的 REGISTRY。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");

/** 扫描范围：只覆盖代码与配置，不扫文档（设计文档/笔记里本来就会写到被移除的名字）。 */
const SCAN_ROOTS = ["packages", "apps", "scripts", ".github"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".cjs", ".js", ".json", ".yml", ".yaml"]);
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "out",
  "dist",
  "mock-cdn",
  "bundled-agents",
  "bundled-tools",
  "third-party",
  "license-texts",
  "coverage",
  ".git",
]);
/** 单文件上限：生成物过大时跳过并统计，避免为了扫描把内存打满。 */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * 检查器自身必须排除：REGISTRY 里以字面量形式写着被移除的符号名，
 * 不排除的话它每次都会命中自己。这不削弱检查——它不属于产品代码。
 */
const IGNORED_FILES = new Set(["scripts/check-fork-removals.mjs"]);

/**
 * 规则类型：
 * - absentFiles：这些路径必须不存在（被删除的文件不许复活）。
 * - absentPatterns：这些正则不许在任何被扫描文件中命中（被移除的符号/接口/端点不许复活）。
 * - requiredFiles：这些路径必须存在（我们的实现不许被上游版本挤掉）。
 * - requiredPatterns：在指定文件里必须命中（我们那版接线不许被上游版本覆盖）。
 */
const REGISTRY = [
  {
    // 见 FEATURES.md 的 github-update 条目与 docs/features/github-update/design.md
    featureId: "github-update",
    absentFiles: [
      {
        path: "packages/desktop/src/main/manifestUpdateProvider.ts",
        reason: "上游服务端 manifest 更新 provider，已由 GitHub Release feed 取代",
      },
      {
        path: "packages/desktop/src/main/forceUpdateGuard.ts",
        reason: "启动强更 gate，二开版本不接入上游强制下线",
      },
      {
        path: "packages/desktop/src/main/forceUpdatePrompt.ts",
        reason: "强更原生对话框，随强更 gate 一并移除",
      },
      { path: "packages/shared/src/forceUpdate.ts", reason: "强更最低版本比较，已无消费方" },
    ],
    absentPatterns: [
      { pattern: /\bmaybeBlockStartupForForceUpdate\b/, reason: "启动强更 gate 调用入口" },
      { pattern: /\brequestForceAutoUpdate\b/, reason: "强更触发的自动升级入口" },
      { pattern: /\bForceAutoUpdateState\b/, reason: "强更状态类型" },
      { pattern: /\bManifestUpdateProvider\b/, reason: "上游服务端 manifest provider" },
      { pattern: /\bgetForceUpdateConfig\b/, reason: "强更配置的 RPC 服务方法" },
      { pattern: /\bgetForceUpdateMinimalVersionFromConfig\b/, reason: "强更最低版本解析" },
      { pattern: /\bresolveForceUpdateRequirement\b/, reason: "强更判定" },
      { pattern: /\bForceUpdateConfig\b/, reason: "强更配置类型" },
      { pattern: /configs\.forceUpdate\b/, reason: "client/configs 的强更字段" },
      { pattern: /forceUpdate\.minimalVersion/, reason: "强更最低版本字段" },
      {
        pattern: /\/api\/v1\/releases\/electron\/manifest/,
        reason: "上游 Electron 更新 manifest 端点",
      },
    ],
    requiredFiles: [
      {
        path: "packages/desktop/src/main/fork/github-update/feed.ts",
        reason: "GitHub Release feed 解析（本 fork 更新源）",
      },
      {
        path: "packages/desktop/test/forkGithubUpdateFeed.test.ts",
        reason: "feed 单测",
      },
    ],
    requiredPatterns: [
      {
        path: "packages/desktop/src/main/autoUpdater.ts",
        // 必须匹配调用点而不是 import：只写符号名的话，光靠 import 行就能满足规则，
        // 上游版本把接线换掉也照样「通过」。
        pattern: /applyForkGithubUpdateFeed\(\s*autoUpdater\b/,
        reason: "autoUpdater 必须仍由 fork 的 GitHub feed 接线（上游版本胜出会退回服务端 manifest）",
      },
      {
        path: "packages/desktop/src/main/autoUpdater.ts",
        pattern: /resolveUpdateReleaseChannel\(\s*options\.settingService\s*\)/,
        reason: "初始化时必须按持久化的 preview 设置解析通道，否则 feed 基址与 channel 会对不上",
      },
      {
        path: "packages/desktop/electron-builder.config.js",
        pattern: /detectUpdateChannel:\s*true/,
        reason: "关掉它会让 dev 包写 latest*.yml，顶掉稳定通道的更新元数据",
      },
      {
        path: ".github/workflows/release.yml",
        pattern: /latest-mac\.yml/,
        reason: "发布流水线必须上传 macOS 更新元数据，否则客户端报找不到 channel 文件",
      },
      {
        path: ".github/workflows/release.yml",
        // 独立匹配赋值语句：只匹配 canary-build 的话，注释里的字样就能满足规则。
        pattern: /pointer_tag="canary-build"/,
        reason: "preview 通道的固定指针 Release",
      },
    ],
  },
];

function* walkFiles(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      yield* walkFiles(fullPath);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    if (!SCAN_EXTENSIONS.has(extension)) continue;
    yield fullPath;
  }
}

function toRepoPath(absolutePath) {
  return relative(REPO_ROOT, absolutePath).split(sep).join("/");
}

function collectScannedFiles() {
  const files = [];
  let skippedLargeFiles = 0;
  for (const root of SCAN_ROOTS) {
    for (const absolutePath of walkFiles(join(REPO_ROOT, root))) {
      let size = 0;
      try {
        size = statSync(absolutePath).size;
      } catch {
        continue;
      }
      if (size > MAX_FILE_BYTES) {
        skippedLargeFiles += 1;
        continue;
      }
      if (IGNORED_FILES.has(toRepoPath(absolutePath))) continue;
      files.push(absolutePath);
    }
  }
  return { files, skippedLargeFiles };
}

/**
 * 逐行扫描一个文件内容，返回命中的规则与行号。
 *
 * 快速预筛的正则**必须由规则本身拼出**：曾经手写过一个 `forceUpdate|ForceUpdate|manifest`
 * 的预筛，它不匹配 `requestForceAutoUpdate`（是 ForceAutoUpdate，不是 ForceUpdate），
 * 于是整整一条规则被静默跳过。手写预筛与规则表分叉是这类守卫最危险的失效方式，
 * 所以这里只从 rules 派生，并且 selfTest 会验证每条规则都真的能被扫到。
 */
function findAbsentPatternHits(patterns, content) {
  const coarseGate = new RegExp(patterns.map((rule) => `(?:${rule.pattern.source})`).join("|"));
  if (!coarseGate.test(content)) return [];

  const hits = [];
  const lines = content.split("\n");
  for (const rule of patterns) {
    for (let index = 0; index < lines.length; index += 1) {
      if (!rule.pattern.test(lines[index])) continue;
      hits.push({ line: index + 1, reason: rule.reason });
    }
  }
  return hits;
}

/** 从规则正则反推一个字面量探针，用于 selfTest。只覆盖本文件用到的简单正则形态。 */
function deriveProbeLiteral(pattern) {
  return pattern.source.replace(/\\b/g, "").replace(/\\(.)/g, "$1");
}

function checkFeature(feature, files) {
  const violations = [];

  for (const rule of feature.absentFiles) {
    const absolutePath = join(REPO_ROOT, rule.path);
    let exists = false;
    try {
      exists = statSync(absolutePath).isFile();
    } catch {
      exists = false;
    }
    if (exists) {
      violations.push({ location: rule.path, reason: rule.reason, detail: "文件已复活" });
    }
  }

  for (const rule of feature.requiredFiles) {
    const absolutePath = join(REPO_ROOT, rule.path);
    let exists = false;
    try {
      exists = statSync(absolutePath).isFile();
    } catch {
      exists = false;
    }
    if (!exists) {
      violations.push({ location: rule.path, reason: rule.reason, detail: "文件缺失" });
    }
  }

  const requiredByPath = new Map();
  for (const rule of feature.requiredPatterns) {
    const list = requiredByPath.get(rule.path) ?? [];
    list.push(rule);
    requiredByPath.set(rule.path, list);
  }
  for (const [path, rules] of requiredByPath) {
    let content;
    try {
      content = readFileSync(join(REPO_ROOT, path), "utf8");
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (!rule.pattern.test(content)) {
        violations.push({ location: path, reason: rule.reason, detail: "必需内容缺失" });
      }
    }
  }

  if (feature.absentPatterns.length === 0) return violations;

  for (const absolutePath of files) {
    let content;
    try {
      content = readFileSync(absolutePath, "utf8");
    } catch {
      continue;
    }
    for (const hit of findAbsentPatternHits(feature.absentPatterns, content)) {
      violations.push({
        location: `${toRepoPath(absolutePath)}:${hit.line}`,
        reason: hit.reason,
        detail: "被移除的符号/端点重新出现",
      });
    }
  }

  return violations;
}

/**
 * 自检：把每条 absentPatterns 规则的字面量探针塞进一段合成内容，确认扫描器真的能命中。
 * 目的是防止「规则写进表里但扫描路径把它过滤掉了」这种静默失效。
 */
function selfTest() {
  const failures = [];
  for (const feature of REGISTRY) {
    const probes = feature.absentPatterns.map((rule) => ({
      rule,
      probe: deriveProbeLiteral(rule.pattern),
    }));
    for (const { rule, probe } of probes) {
      if (probe.length === 0) {
        failures.push(`${feature.featureId}: 规则 ${rule.pattern.source} 无法推导探针`);
        continue;
      }
      const content = `const before = 1;\n${probe}\nconst after = 2;\n`;
      const hits = findAbsentPatternHits([rule], content);
      if (hits.length !== 1 || hits[0].line !== 2) {
        failures.push(
          `${feature.featureId}: 规则 ${rule.pattern.source} 未被扫描器命中（探针 ${probe}）`,
        );
      }
    }
  }
  return failures;
}

function main() {
  const selfTestFailures = selfTest();
  if (selfTestFailures.length > 0) {
    console.error("✗ 移除不变量检查自检失败（规则表与扫描器已分叉）");
    for (const failure of selfTestFailures) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  const { files, skippedLargeFiles } = collectScannedFiles();
  let totalViolations = 0;

  for (const feature of REGISTRY) {
    const violations = checkFeature(feature, files);
    if (violations.length === 0) {
      console.log(`✓ ${feature.featureId}: 移除不变量成立`);
      continue;
    }
    totalViolations += violations.length;
    console.error(`\n✗ ${feature.featureId}: ${violations.length} 处移除不变量被破坏`);
    for (const violation of violations) {
      console.error(`  - ${violation.location}`);
      console.error(`      ${violation.detail}：${violation.reason}`);
    }
  }

  if (totalViolations > 0) {
    console.error(
      [
        "",
        "这些内容在 FEATURES.md 里被登记为「已移除」。同步上游后出现，通常是：",
        "  1) 把 modify/delete 冲突按「保留上游版本」解决了 —— 请改回 git rm；",
        "  2) 上游用新文件/新符号重新实现了同一能力 —— 需要在 FEATURES.md 记录「同步冲突」条目，",
        "     并按 AGENTS.md 的同步流程与用户确认取舍，不要静默接受；",
        "  3) 上游覆盖了我们改过的上游文件（或反之）—— 按设计文档重新贴回最小 diff。",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `扫描 ${files.length} 个代码/配置文件${skippedLargeFiles > 0 ? `（跳过 ${skippedLargeFiles} 个超过 5MB 的文件）` : ""}，无违规。`,
  );
}

main();
