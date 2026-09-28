# 系统指令（identity-preset）第 1 期：内核 —— 实施计划

> **给执行者：** 必须用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务执行本计划。步骤用 `- [ ]` 复选框跟踪。
> 本期只做内核（共享契约、core fork 模块、builder 接线、bootstrap 端口装配），**不做 UI 与 WebDAV 同步**——那是第 2、3 期，见本文末尾「后续计划」。

**目标**：让「用户自定义身份段」在 agent 侧生效——启用时模型收到的系统提示词不再有 `cli_prefix`，身份段换成 `~/.zcode/presets/profiles/<id>.md` 的正文，动态段（环境 / gitStatus / 上下文管理 / 桌面契约）保持不变。

**架构**：agent 进程经 `AgentRuntimeConfig.identityPresetPort` 读盘（与既有 `contextSourcePort` 同构），解析结果在 `ensureContextInitialized` 冻结进 App 级 config，由 `context/builder.ts` 在第 1、2 段消费。契约与模板常量放 `packages/shared/src/fork/`（`@zcode/core` 已依赖 `@zcode/shared`，三方共用零漂移）。

**技术栈**：TypeScript / Node 24 / pnpm workspace / node:test + tsx（根目录执行）。

## 全局约束

- 设计依据：`docs/features/identity-preset/design.md`。任何与设计不一致的实现，必须在 `docs/features/identity-preset/implementation.md` 的「与设计的偏差」中记录。
- 上游文件（`packages/**`、`apps/zcode-cli/packages/{core,bootstrap}` 里**已存在**的文件）每一处改动都必须带 `FORK(identity-preset)` 标记，连续多行用 `FORK-BEGIN/END`；新增文件不需要标记。
- `<feature-id>` 固定为 `identity-preset`，与 `FEATURES.md` 条目 id 一致。
- 不新增第三方依赖；不新建 workspace 包。
- 提交遵循 Conventional Commits，**只 `git add` 本次任务显式修改的文件**，禁止 `git add .` / `git commit -a`，禁止推送远程。
- 工作区有他人施工中的文件，**绝对不要碰**：`packages/desktop/src/main/autoUpdater.ts`、`packages/desktop/src/fork/**`、`packages/desktop/test/forkGithubUpdateFeed.test.ts`、`docs/features/github-update/**`、`.zcodeignore`、`mise.toml`。
- 测试命令一律在**仓库根目录**执行：`pnpm exec tsx --test <file>`（`tsx` 只装在根；`apps/zcode-cli/packages/core` 下没有 tsx）。
- 每个任务结束执行 `pnpm typecheck`、`pnpm lint`；涉及文件移动/模块结构时另加 `pnpm architecture:check --changed`。
- 注释风格与仓库一致：写「为什么必须这样做」，不写「这一行做了什么」。设计里反复强调的约束（替换身份段、只对新会话生效、镜像文本）要落到注释上。

---

## 文件结构

**新增：**

| 文件                                                                       | 职责                                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/shared/src/fork/identity-preset-contract.ts`                     | 通道名、目录/文件名常量、id 与名称规则、状态与配置类型、两个模板常量、状态文件解析                     |
| `apps/zcode-cli/packages/core/src/fork/identity-preset/profile-file.ts`    | 单个 `.md` 配置的 frontmatter 解析与序列化（无 YAML 依赖）                                             |
| `apps/zcode-cli/packages/core/src/fork/identity-preset/identityManager.ts` | 身份段构造、激活项解析：`buildIdentityPresetSection` / `resolveActiveIdentityPreset`                   |
| `apps/zcode-cli/packages/core/src/fork/identity-preset/file-port.ts`       | 只读文件端口 `createFileIdentityPresetPort`：读 `active.json` + `profiles/<id>.md`，失败一律降级不抛错 |
| `apps/zcode-cli/packages/core/src/fork/identity-preset/index.ts`           | 该目录唯一公开入口                                                                                     |
| `packages/shared/test/forkIdentityPresetContract.test.ts`                  | 契约层单测（id/名称校验、状态文件容错）                                                                |
| `apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts`             | 解析/构造/端口单测 + 模板一致性断言                                                                    |
| `apps/zcode-cli/packages/core/test/forkIdentityPresetContext.test.ts`      | `ContextBuilder` 集成：system 消息形态与优先级组合                                                     |

**修改（上游文件，需 `FORK(identity-preset)` 标记）：**

| 文件                                                          | 改动                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/shared/src/index.ts`                                | 紧跟 `fork/webdav-contract.js` 增一行导出                          |
| `apps/zcode-cli/packages/core/src/index.ts`                   | 增一行 `export * from "./fork/identity-preset/index.js"`           |
| `apps/zcode-cli/packages/core/src/context/types.ts`           | `ContextBuilderConfig` 增 `identityPreset?`                        |
| `apps/zcode-cli/packages/core/src/context/builder.ts`         | 第 1、2 段按自定义身份分流                                         |
| `apps/zcode-cli/packages/core/src/runtime/types.ts`           | `AgentRuntimeConfig` 增 `identityPresetPort?` 与 `identityPreset?` |
| `apps/zcode-cli/packages/core/src/runtime/methods/context.ts` | 初始化时 await 端口一次并写入 config；下传给 builder config        |
| `apps/zcode-cli/packages/bootstrap/src/app/create-app.ts`     | 用 `join(storageRoot, "presets")` 构造 file-backed 端口            |

---

## Task 1: 共享契约与模板常量

**Files:**

- Create: `packages/shared/src/fork/identity-preset-contract.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/forkIdentityPresetContract.test.ts`

**Interfaces:**

- Consumes: 无
- Produces:
  - `FORK_IDENTITY_PRESET_CHANNEL = "fork-identity-preset"`
  - `FORK_IDENTITY_PRESET_ROOT_NAME = "presets"`、`FORK_IDENTITY_PRESET_PROFILES_DIRNAME = "profiles"`、`FORK_IDENTITY_PRESET_STATE_FILENAME = "active.json"`、`FORK_IDENTITY_PRESET_STATE_SCHEMA_VERSION = 1`
  - `FORK_IDENTITY_PRESET_ID_PATTERN: RegExp`、`FORK_IDENTITY_PRESET_NAME_MAX_LENGTH = 50`
  - `FORK_IDENTITY_PRESET_DEFAULT_TEMPLATE: string`、`FORK_IDENTITY_PRESET_SKELETON_TEMPLATE: string`
  - `type ForkIdentityPresetTemplateId = "default" | "skeleton"`
  - `interface ForkIdentityPresetSummary { id: string; name: string }`
  - `interface ForkIdentityPresetProfile { id: string; name: string; content: string }`
  - `interface ForkIdentityPresetState { enabled: boolean; activeId: string | null; activeMissing: boolean; root: string; profiles: ForkIdentityPresetSummary[] }`
  - `interface ForkIdentityPresetStateFile { schemaVersion: number; enabled: boolean; activeId: string | null }`
  - `parseForkIdentityPresetStateFile(raw: unknown): ForkIdentityPresetStateFile`
  - `isValidForkIdentityPresetId(value: string): boolean`
  - `normalizeForkIdentityPresetName(value: string): string | null`
  - `createForkIdentityPresetId(name: string): string`

- [ ] **Step 1: 写失败的测试**

创建 `packages/shared/test/forkIdentityPresetContract.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  FORK_IDENTITY_PRESET_DEFAULT_TEMPLATE,
  FORK_IDENTITY_PRESET_SKELETON_TEMPLATE,
  createForkIdentityPresetId,
  isValidForkIdentityPresetId,
  normalizeForkIdentityPresetName,
  parseForkIdentityPresetStateFile,
} from "@zcode/shared";

test("id 规则只接受小写字母数字与连字符", () => {
  assert.equal(isValidForkIdentityPresetId("concise"), true);
  assert.equal(isValidForkIdentityPresetId("my-style-2"), true);
  assert.equal(isValidForkIdentityPresetId("../escape"), false);
  assert.equal(isValidForkIdentityPresetId("A-Upper"), false);
  assert.equal(isValidForkIdentityPresetId(""), false);
  assert.equal(isValidForkIdentityPresetId("x".repeat(51)), false);
});

test("createForkIdentityPresetId 从名称派生合法 id", () => {
  assert.equal(createForkIdentityPresetId("Concise Style"), "concise-style");
  assert.match(createForkIdentityPresetId("极简风格"), /^preset-[a-z0-9]+$/);
  assert.equal(createForkIdentityPresetId("   "), "preset");
});

test("normalizeForkIdentityPresetName 拒绝空名与超长名", () => {
  assert.equal(normalizeForkIdentityPresetName("  极简 风格 "), "极简 风格");
  assert.equal(normalizeForkIdentityPresetName("   "), null);
  assert.equal(normalizeForkIdentityPresetName("x".repeat(51)), null);
});

test("状态文件解析对缺失与损坏一律降级为关闭", () => {
  const fallback = { schemaVersion: 1, enabled: false, activeId: null };
  assert.deepEqual(parseForkIdentityPresetStateFile(undefined), fallback);
  assert.deepEqual(parseForkIdentityPresetStateFile("not an object"), fallback);
  assert.deepEqual(parseForkIdentityPresetStateFile({ enabled: true, activeId: "x" }), fallback);
  assert.deepEqual(
    parseForkIdentityPresetStateFile({ schemaVersion: 99, enabled: true, activeId: "x" }),
    fallback,
  );
  assert.deepEqual(
    parseForkIdentityPresetStateFile({ schemaVersion: 1, enabled: true, activeId: "../x" }),
    {
      schemaVersion: 1,
      enabled: true,
      activeId: null,
    },
  );
  assert.deepEqual(
    parseForkIdentityPresetStateFile({ schemaVersion: 1, enabled: true, activeId: "concise" }),
    {
      schemaVersion: 1,
      enabled: true,
      activeId: "concise",
    },
  );
});

test("模板常量非空且骨架含四个小节与安全声明", () => {
  assert.match(
    FORK_IDENTITY_PRESET_DEFAULT_TEMPLATE,
    /^You are ZCode, an interactive coding agent\n/,
  );
  assert.match(FORK_IDENTITY_PRESET_DEFAULT_TEMPLATE, /# Harness/);
  for (const heading of ["# 角色", "# 沟通风格", "# 工作方式", "# 边界"]) {
    assert.ok(FORK_IDENTITY_PRESET_SKELETON_TEMPLATE.includes(heading));
  }
  assert.match(
    FORK_IDENTITY_PRESET_SKELETON_TEMPLATE,
    /^IMPORTANT: Assist with authorized security testing/m,
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec tsx --test packages/shared/test/forkIdentityPresetContract.test.ts`
Expected: FAIL — `SyntaxError: ... does not provide an export named 'isValidForkIdentityPresetId'`（模块尚不存在）

- [ ] **Step 3: 写实现**

创建 `packages/shared/src/fork/identity-preset-contract.ts`：

```ts
/**
 * 系统指令（fork）：用户自定义提示词的文件契约与模板常量。
 *
 * 三方共用：agent 侧（@zcode/core 的 fork 模块读盘）、宿主侧服务（写盘）、渲染层（编辑）。
 * 放这里而不是各写一份，是因为 id 规则、目录名、状态文件形态任何一处漂移，症状都是
 * 「UI 看得见、agent 读不到」。见 FEATURES.md 的 identity-preset 条目与
 * docs/features/identity-preset/design.md 第 5、8 节。
 */

export const FORK_IDENTITY_PRESET_CHANNEL = "fork-identity-preset";

/** 预设根目录名，相对 CLI storage root；与 `agents/`、`skills/`、`commands/` 同级，不用 `cli/` 后缀。 */
export const FORK_IDENTITY_PRESET_ROOT_NAME = "presets";
export const FORK_IDENTITY_PRESET_PROFILES_DIRNAME = "profiles";
export const FORK_IDENTITY_PRESET_STATE_FILENAME = "active.json";
export const FORK_IDENTITY_PRESET_STATE_SCHEMA_VERSION = 1;

/** 配置 id 与文件名 1:1；字符集收窄即可杜绝路径穿越，不需要额外的路径校验。 */
export const FORK_IDENTITY_PRESET_ID_PATTERN = /^[a-z0-9-]{1,50}$/;
export const FORK_IDENTITY_PRESET_NAME_MAX_LENGTH = 50;

export type ForkIdentityPresetTemplateId = "default" | "skeleton";

export interface ForkIdentityPresetSummary {
  id: string;
  name: string;
}

export interface ForkIdentityPresetProfile {
  id: string;
  name: string;
  content: string;
}

export interface ForkIdentityPresetState {
  enabled: boolean;
  activeId: string | null;
  /** enabled 为真但 activeId 指向不存在的配置；UI 据此提示「已回退系统默认」。 */
  activeMissing: boolean;
  /** 预设根目录绝对路径，便于用户排查「文件到底在哪」。 */
  root: string;
  profiles: ForkIdentityPresetSummary[];
}

export interface ForkIdentityPresetStateFile {
  schemaVersion: number;
  enabled: boolean;
  activeId: string | null;
}

export function isValidForkIdentityPresetId(value: string): boolean {
  return FORK_IDENTITY_PRESET_ID_PATTERN.test(value);
}

export function normalizeForkIdentityPresetName(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > FORK_IDENTITY_PRESET_NAME_MAX_LENGTH) {
    return null;
  }
  return normalized;
}

/**
 * 非 ASCII 名的区分后缀：31 进制滚动哈希取 32 位无符号，再转 base36。
 * 只需要「同一名字稳定、不同名字大概率不同」，不需要抗碰撞，故不上 crypto。
 */
function hashForkIdentityPresetName(value: string): string {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  }
  return hash.toString(36);
}

export function createForkIdentityPresetId(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "preset";
  }
  const ascii = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const hasNonAscii = [...trimmed].some((char) => char.codePointAt(0)! > 0x7f);
  if (!hasNonAscii && ascii.length > 0) {
    return ascii.slice(0, 50);
  }
  const suffix = hashForkIdentityPresetName(trimmed);
  const stem = (ascii.length > 0 ? ascii : "preset").slice(0, 50 - 1 - suffix.length).replace(/-+$/g, "");
  return `${stem}-${suffix}`;
}

> **已交付**：上面两块在 Task 1 的两轮修复后与 `packages/shared/src/fork/identity-preset-contract.ts` 的实际内容一致（提交 `6d0e3d7..c1bbb15`）。执行 Task 2+ 时以该文件为准，不要照抄更早版本的片段。
> 三条不变量由 `packages/shared/test/forkIdentityPresetContract.test.ts` 固定：纯 ASCII 且 slug 可用 → 干净 slug；含非 ASCII 码点或 slug 为空 → 追加 hash 后缀；任何能通过 `normalizeForkIdentityPresetName` 的名字派生出的 id 都必须合法。

/**
 * 状态文件解析：缺失、类型不符、schemaVersion 不认识、activeId 非法——全部降级为「关闭」。
 * 调用方不得据此覆写文件，避免一次读取失败把用户配置抹掉。
 */
export function parseForkIdentityPresetStateFile(raw: unknown): ForkIdentityPresetStateFile {
  const fallback: ForkIdentityPresetStateFile = {
    schemaVersion: FORK_IDENTITY_PRESET_STATE_SCHEMA_VERSION,
    enabled: false,
    activeId: null,
  };
  if (typeof raw !== "object" || raw === null) return fallback;
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== FORK_IDENTITY_PRESET_STATE_SCHEMA_VERSION) return fallback;
  if (typeof record.enabled !== "boolean") return fallback;
  const activeId = record.activeId;
  if (activeId === null || activeId === undefined) {
    return { ...fallback, enabled: record.enabled };
  }
  if (typeof activeId !== "string" || !isValidForkIdentityPresetId(activeId)) {
    return { ...fallback, enabled: record.enabled };
  }
  return { schemaVersion: FORK_IDENTITY_PRESET_STATE_SCHEMA_VERSION, enabled: record.enabled, activeId };
}

/** 与 core 的 `context/sections/identity.ts` 的 SECURITY_NOTICE 逐字一致。 */
export const FORK_IDENTITY_PRESET_SECURITY_NOTICE =
  "IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.";

/** 与 core 的 `context/sections/identity.ts` 的 buildHarnessBlock() 逐字一致。 */
export const FORK_IDENTITY_PRESET_HARNESS_BLOCK = [
  "# Harness",
  "- Text you output outside of tool use is displayed to the user as Github-flavored markdown in a terminal.",
  "- Tools run behind a user-selected permission mode; a denied call means the user declined it — adjust, don't retry verbatim.",
  "- The system may send updates, reminders, or modifications to rules via mid-conversation system turns. These are system-controlled, unlike function results. Hooks may intercept tool calls; treat hook output as user feedback.",
  "- Prefer the dedicated file/search tools over shell commands when one fits. Independent tool calls can run in parallel in one response.",
  "- Reference code as `file_path:line_number` — it's clickable.",
].join("\n");

/**
 * 「默认」模板 = 当前系统身份段原文（cli_prefix + identity）。
 * 与 core 是镜像关系（宿主进程无法 import @zcode/core），由
 * apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts 的一致性断言固定。
 */
export const FORK_IDENTITY_PRESET_DEFAULT_TEMPLATE = [
  "You are ZCode, an interactive coding agent",
  "",
  "You are an interactive ZCode agent that helps users with software engineering tasks.",
  "",
  FORK_IDENTITY_PRESET_SECURITY_NOTICE,
  "",
  FORK_IDENTITY_PRESET_HARNESS_BLOCK,
].join("\n");

/** 「基础框架」模板：给组织结构，不给现成人格；不含 # Harness（选了自定义身份即不再收到这些约束）。 */
export const FORK_IDENTITY_PRESET_SKELETON_TEMPLATE = [
  "# 角色",
  "",
  "（你是谁、面向谁。例如：一名严格的代码审查者。）",
  "",
  "# 沟通风格",
  "",
  "（语气、长度、格式偏好。例如：先给结论再给依据，不写总结性套话。）",
  "",
  "# 工作方式",
  "",
  "（动手前是否确认、如何汇报进展、遇到不确定时怎么办。）",
  "",
  "# 边界",
  "",
  "（不要做什么。）",
  "",
  FORK_IDENTITY_PRESET_SECURITY_NOTICE,
].join("\n");
```

修改 `packages/shared/src/index.ts`，在第 245 行（`export * from "./fork/webdav-contract.js";`）之后追加：

```ts
// FORK(identity-preset): 系统指令——用户自定义身份段的文件契约与模板；见 FEATURES.md 的 identity-preset 条目
export * from "./fork/identity-preset-contract.js";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec tsx --test packages/shared/test/forkIdentityPresetContract.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/fork/identity-preset-contract.ts packages/shared/src/index.ts packages/shared/test/forkIdentityPresetContract.test.ts
git commit -m "feat(identity-preset): 新增系统指令文件契约与模板常量"
```

---

## Task 2: 配置文件解析与序列化

**Files:**

- Create: `apps/zcode-cli/packages/core/src/fork/identity-preset/profile-file.ts`
- Test: `apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts`

**Interfaces:**

- Consumes: `@zcode/shared` 的 `normalizeForkIdentityPresetName`
- Produces:
  - `interface ParsedIdentityPresetFile { name: string; content: string }`
  - `parseIdentityPresetFile(text: string, fallbackName: string): ParsedIdentityPresetFile`
  - `serializeIdentityPresetFile(profile: { name: string; content: string }): string`

- [ ] **Step 1: 写失败的测试**

创建 `apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  parseIdentityPresetFile,
  serializeIdentityPresetFile,
} from "../src/fork/identity-preset/profile-file.js";

test("解析 frontmatter 的 name 与正文", () => {
  const parsed = parseIdentityPresetFile("---\nname: 极简风格\n---\n\n你是 ZCode。\n", "fallback");
  assert.equal(parsed.name, "极简风格");
  assert.equal(parsed.content, "你是 ZCode。");
});

test("缺 frontmatter 或 name 时回退文件名 stem", () => {
  assert.deepEqual(parseIdentityPresetFile("你是 ZCode。", "concise"), {
    name: "concise",
    content: "你是 ZCode。",
  });
  assert.deepEqual(parseIdentityPresetFile("---\nfoo: bar\n---\n\nbody", "concise"), {
    name: "concise",
    content: "body",
  });
});

test("name 两侧引号被剥离，正文首尾空白被裁剪", () => {
  const parsed = parseIdentityPresetFile(
    '---\nname: "quoted name"\n---\n\n\n  body  \n\n',
    "fallback",
  );
  assert.equal(parsed.name, "quoted name");
  assert.equal(parsed.content, "body");
});

test("序列化后再解析得到同一份内容（往返）", () => {
  const original = { name: "极简 风格", content: "# 角色\n\n只给结论。" };
  const roundTripped = parseIdentityPresetFile(serializeIdentityPresetFile(original), "fallback");
  assert.deepEqual(roundTripped, original);
});

test("序列化结果以 frontmatter 开头并以换行结尾", () => {
  const text = serializeIdentityPresetFile({ name: "x", content: "y" });
  assert.match(text, /^---\nname: x\n---\n\ny\n$/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec tsx --test apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts`
Expected: FAIL — `Cannot find module '../src/fork/identity-preset/profile-file.js'`

- [ ] **Step 3: 写实现**

创建 `apps/zcode-cli/packages/core/src/fork/identity-preset/profile-file.ts`：

```ts
/**
 * 系统指令（fork）：单个配置文件的 frontmatter 解析与序列化。
 *
 * 格式与 `~/.zcode/agents/*.md` 同构，但不复用那份带完整字段的 YAML 解析器：
 * 这里只需要一个 `name`，引入 YAML 解析器会让「用户手改出一个语法错误」变成整份配置读不出来。
 * 只认第一段 frontmatter 里的 `name:` 行，其余原样交回正文，坏输入退化为「用文件名当名字」。
 * 见 docs/features/identity-preset/design.md 第 5.2 节。
 */
import { normalizeForkIdentityPresetName } from "@zcode/shared";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const NAME_LINE_PATTERN = /^name:[ \t]*(.*)$/m;

export interface ParsedIdentityPresetFile {
  name: string;
  content: string;
}

export function parseIdentityPresetFile(
  text: string,
  fallbackName: string,
): ParsedIdentityPresetFile {
  const match = FRONTMATTER_PATTERN.exec(text);
  const body = (match ? text.slice(match[0].length) : text).trim();
  const rawName = match ? NAME_LINE_PATTERN.exec(match[1] ?? "")?.[1] : undefined;
  const name = rawName === undefined ? null : stripQuotes(rawName);
  return {
    name: normalizeForkIdentityPresetName(name ?? "") ?? fallbackName,
    content: body,
  };
}

export function serializeIdentityPresetFile(profile: { name: string; content: string }): string {
  return `---\nname: ${profile.name}\n---\n\n${profile.content}\n`;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && /^".*"$/.test(trimmed)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec tsx --test apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5: 提交**

```bash
git add apps/zcode-cli/packages/core/src/fork/identity-preset/profile-file.ts apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts
git commit -m "feat(identity-preset): 配置文件 frontmatter 解析与序列化"
```

---

## Task 3: 身份段构造、激活项解析与模板一致性

**Files:**

- Create: `apps/zcode-cli/packages/core/src/fork/identity-preset/identityManager.ts`
- Test: `apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts`（追加）

**Interfaces:**

- Consumes: `parseForkIdentityPresetStateFile`、`FORK_IDENTITY_PRESET_DEFAULT_TEMPLATE`（`@zcode/shared`）、`estimateTokens`（`../../context/utils.js`）、`ContextSection`（`../../context/types.js`）
- Produces:
  - `interface ResolvedIdentityPreset { id: string; name: string; content: string }`
  - `buildIdentityPresetSection(preset: ResolvedIdentityPreset): ContextSection`
  - `resolveActiveIdentityPreset(input: { enabled: boolean; activeId: string | null; profiles: Map<string, ResolvedIdentityPreset> }): ResolvedIdentityPreset | undefined`

- [ ] **Step 1: 写失败的测试**

在 `apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts` 追加：

```ts
import { FORK_IDENTITY_PRESET_DEFAULT_TEMPLATE } from "@zcode/shared";

import { buildCliPrefixSection } from "../src/context/sections/cli-prefix.js";
import { buildIdentitySection } from "../src/context/sections/identity.js";
import {
  buildIdentityPresetSection,
  resolveActiveIdentityPreset,
} from "../src/fork/identity-preset/identityManager.js";

test("身份段与 identity.ts 逐字段同构", () => {
  const section = buildIdentityPresetSection({ id: "a", name: "A", content: "自定义身份" });
  const reference = buildIdentitySection();
  assert.equal(section.name, reference.name);
  assert.equal(section.source, reference.source);
  assert.equal(section.injectionTarget, reference.injectionTarget);
  assert.equal(section.cacheHint, reference.cacheHint);
  assert.equal(section.content, "自定义身份");
  assert.equal(section.chars, "自定义身份".length);
  assert.equal(section.preview, "自定义身份");
});

test("「默认」模板与 cli_prefix + identity 的当前原文逐字节一致", () => {
  const current = [buildCliPrefixSection().content, buildIdentitySection().content].join("\n");
  assert.equal(FORK_IDENTITY_PRESET_DEFAULT_TEMPLATE, current);
});

test("激活项解析：关闭、悬空 id、命中", () => {
  const profiles = new Map([["concise", { id: "concise", name: "极简", content: "x" }]]);
  assert.equal(
    resolveActiveIdentityPreset({ enabled: false, activeId: "concise", profiles }),
    undefined,
  );
  assert.equal(resolveActiveIdentityPreset({ enabled: true, activeId: null, profiles }), undefined);
  assert.equal(
    resolveActiveIdentityPreset({ enabled: true, activeId: "missing", profiles }),
    undefined,
  );
  assert.deepEqual(resolveActiveIdentityPreset({ enabled: true, activeId: "concise", profiles }), {
    id: "concise",
    name: "极简",
    content: "x",
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec tsx --test apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts`
Expected: FAIL — `Cannot find module '../src/fork/identity-preset/identityManager.js'`

- [ ] **Step 3: 写实现**

创建 `apps/zcode-cli/packages/core/src/fork/identity-preset/identityManager.ts`：

```ts
/**
 * 系统指令（fork）：受控身份段的构造与激活项解析。
 *
 * 对外只做两件事：把用户配置变成与 `context/sections/identity.ts` 同构的 ContextSection，
 * 以及「开关 + 激活 id + 配置集合 → 生效的那一份」。解析细节（frontmatter、状态文件容错）
 * 分别归 profile-file.ts 与 shared 的契约。
 * 见 docs/features/identity-preset/design.md 第 6 节。
 */
import type { ContextSection } from "../../context/types.js";
import { estimateTokens } from "../../context/utils.js";

export interface ResolvedIdentityPreset {
  id: string;
  name: string;
  content: string;
}

export function buildIdentityPresetSection(preset: ResolvedIdentityPreset): ContextSection {
  const content = preset.content;
  return {
    name: "Agent Identity",
    // 沿用 `identity` 这个 source：下游（assembleSystemMessages 的缓存分层、context 用量
    // 统计、恢复快照）都按 source 分流，换一个新 source 会让这些地方各漏一路。
    source: "identity",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}

export function resolveActiveIdentityPreset(input: {
  enabled: boolean;
  activeId: string | null;
  profiles: ReadonlyMap<string, ResolvedIdentityPreset>;
}): ResolvedIdentityPreset | undefined {
  if (!input.enabled || input.activeId === null) return undefined;
  const preset = input.profiles.get(input.activeId);
  // 悬空 activeId 等同关闭：让会话回到系统默认，而不是让 agent 起不来。
  if (!preset || preset.content.trim().length === 0) return undefined;
  return preset;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec tsx --test apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts`
Expected: PASS（8 个用例）。**如果「默认模板逐字节一致」失败**，把报错里的 actual 字符串复制去修正 `FORK_IDENTITY_PRESET_DEFAULT_TEMPLATE` 的换行/空行，而不是放宽断言。

- [ ] **Step 5: 提交**

```bash
git add apps/zcode-cli/packages/core/src/fork/identity-preset/identityManager.ts apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts
git commit -m "feat(identity-preset): 身份段构造与激活项解析"
```

---

## Task 4: 只读文件端口

**Files:**

- Create: `apps/zcode-cli/packages/core/src/fork/identity-preset/file-port.ts`
- Test: `apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts`（追加）

**Interfaces:**

- Consumes: `parseIdentityPresetFile`（Task 2）、`resolveActiveIdentityPreset` / `ResolvedIdentityPreset`（Task 3）、`parseForkIdentityPresetStateFile` + 目录常量（`@zcode/shared`）
- Produces:
  - `interface IdentityPresetLoadOutcome { preset?: ResolvedIdentityPreset; diagnostic?: string }`
  - `interface IdentityPresetPort { loadActive(): Promise<IdentityPresetLoadOutcome> }`
  - `createFileIdentityPresetPort(input: { root: string }): IdentityPresetPort`

- [ ] **Step 1: 写失败的测试**

在 `apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts` 追加：

```ts
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileIdentityPresetPort } from "../src/fork/identity-preset/file-port.js";

async function writePresetRoot(input: {
  state?: unknown;
  profiles?: Record<string, string>;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "identity-preset-"));
  await mkdir(join(root, "profiles"), { recursive: true });
  if (input.state !== undefined) {
    await writeFile(join(root, "active.json"), JSON.stringify(input.state), "utf8");
  }
  for (const [id, text] of Object.entries(input.profiles ?? {})) {
    await writeFile(join(root, "profiles", `${id}.md`), text, "utf8");
  }
  return root;
}

test("端口读不到目录时静默降级为未启用", async () => {
  const root = join(tmpdir(), "identity-preset-does-not-exist");
  const outcome = await createFileIdentityPresetPort({ root }).loadActive();
  assert.equal(outcome.preset, undefined);
});

test("端口按 activeId 载入对应配置", async () => {
  const root = await writePresetRoot({
    state: { schemaVersion: 1, enabled: true, activeId: "concise" },
    profiles: { concise: "---\nname: 极简\n---\n\n只给结论。\n" },
  });
  const outcome = await createFileIdentityPresetPort({ root }).loadActive();
  assert.deepEqual(outcome.preset, { id: "concise", name: "极简", content: "只给结论。" });
});

test("activeId 悬空时返回诊断且不生效", async () => {
  const root = await writePresetRoot({
    state: { schemaVersion: 1, enabled: true, activeId: "missing" },
    profiles: { concise: "body" },
  });
  const outcome = await createFileIdentityPresetPort({ root }).loadActive();
  assert.equal(outcome.preset, undefined);
  assert.match(outcome.diagnostic ?? "", /missing/);
});

test("状态文件损坏时降级且不抛错", async () => {
  const root = await writePresetRoot({ profiles: { concise: "body" } });
  await writeFile(join(root, "active.json"), "{ not json", "utf8");
  const outcome = await createFileIdentityPresetPort({ root }).loadActive();
  assert.equal(outcome.preset, undefined);
  assert.match(outcome.diagnostic ?? "", /active\.json/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec tsx --test apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts`
Expected: FAIL — `Cannot find module '../src/fork/identity-preset/file-port.js'`

- [ ] **Step 3: 写实现**

创建 `apps/zcode-cli/packages/core/src/fork/identity-preset/file-port.ts`：

```ts
/**
 * 系统指令（fork）：只读文件端口。
 *
 * agent 进程直接读盘，与 `~/.zcode/AGENTS.md`、`MEMORY.md`、`~/.zcode/agents/*.md` 同模式；
 * 宿主侧服务是唯一写入方（第 2 期）。这里挂掉的正确表现是「回到系统默认继续干活」，
 * 所以任何异常都转成 diagnostic，绝不向上抛——一个坏掉的用户配置文件不该让会话起不来。
 * 见 docs/features/identity-preset/design.md 第 5、8 节。
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  FORK_IDENTITY_PRESET_PROFILE_EXTENSION,
  FORK_IDENTITY_PRESET_PROFILES_DIRNAME,
  FORK_IDENTITY_PRESET_STATE_FILENAME,
  isValidForkIdentityPresetId,
  parseForkIdentityPresetStateFile,
} from "@zcode/shared";

import { parseIdentityPresetFile } from "./profile-file.js";
import { resolveActiveIdentityPreset, type ResolvedIdentityPreset } from "./identityManager.js";

export interface IdentityPresetLoadOutcome {
  preset?: ResolvedIdentityPreset;
  /** 非致命诊断（目录不可读 / 状态文件损坏 / activeId 悬空），由 runtime 记 warn 日志。 */
  diagnostic?: string;
}

export interface IdentityPresetPort {
  loadActive(): Promise<IdentityPresetLoadOutcome>;
}

export function createFileIdentityPresetPort(input: { root: string }): IdentityPresetPort {
  return {
    loadActive: async () => loadActiveFromRoot(input.root),
  };
}

async function loadActiveFromRoot(root: string): Promise<IdentityPresetLoadOutcome> {
  const statePath = join(root, FORK_IDENTITY_PRESET_STATE_FILENAME);
  let stateText: string;
  try {
    stateText = await readFile(statePath, "utf8");
  } catch {
    // 目录或状态文件不存在 = 未启用；这是首次使用与「关了同步的机器」的正常状态。
    return {};
  }

  let raw: unknown;
  try {
    raw = JSON.parse(stateText);
  } catch {
    return { diagnostic: `${FORK_IDENTITY_PRESET_STATE_FILENAME} 不是合法 JSON，已回退系统默认` };
  }
  const state = parseForkIdentityPresetStateFile(raw);
  if (!state.enabled || state.activeId === null) {
    return {};
  }

  const profiles = await readProfiles(root, state.activeId);
  const preset = resolveActiveIdentityPreset({ ...state, profiles });
  if (!preset) {
    return { diagnostic: `激活的配置 ${state.activeId} 不存在或为空，已回退系统默认` };
  }
  return { preset };
}

async function readProfiles(
  root: string,
  activeId: string,
): Promise<Map<string, ResolvedIdentityPreset>> {
  const profiles = new Map<string, ResolvedIdentityPreset>();
  const dir = join(root, FORK_IDENTITY_PRESET_PROFILES_DIRNAME);
  let fileNames: string[];
  try {
    fileNames = await readdir(dir);
  } catch {
    return profiles;
  }
  for (const fileName of fileNames) {
    if (!fileName.endsWith(FORK_IDENTITY_PRESET_PROFILE_EXTENSION)) continue;
    const id = fileName.slice(0, -FORK_IDENTITY_PRESET_PROFILE_EXTENSION.length);
    if (!isValidForkIdentityPresetId(id)) continue;
    // 只读激活的那一份：列表类需求走宿主服务，agent 侧不需要为目录里每个文件付 IO。
    if (id !== activeId) continue;
    try {
      const text = await readFile(join(dir, fileName), "utf8");
      const parsed = parseIdentityPresetFile(text, id);
      profiles.set(id, { id, name: parsed.name, content: parsed.content });
    } catch {
      continue;
    }
  }
  return profiles;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec tsx --test apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts`
Expected: PASS（12 个用例）

- [ ] **Step 5: 提交**

```bash
git add apps/zcode-cli/packages/core/src/fork/identity-preset/file-port.ts apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts
git commit -m "feat(identity-preset): 只读文件端口与降级策略"
```

---

## Task 5: core 接线（builder 三段分流）

**Files:**

- Create: `apps/zcode-cli/packages/core/src/fork/identity-preset/index.ts`
- Modify: `apps/zcode-cli/packages/core/src/context/types.ts`、`apps/zcode-cli/packages/core/src/context/builder.ts`、`apps/zcode-cli/packages/core/src/runtime/types.ts`、`apps/zcode-cli/packages/core/src/runtime/methods/context.ts`、`apps/zcode-cli/packages/core/src/index.ts`
- Test: `apps/zcode-cli/packages/core/test/forkIdentityPresetContext.test.ts`

**Interfaces:**

- Consumes: `buildIdentityPresetSection` / `ResolvedIdentityPreset` / `IdentityPresetPort`（Task 3、4）
- Produces:
  - `ContextBuilderConfig.identityPreset?: ResolvedIdentityPreset`
  - `AgentRuntimeConfig.identityPresetPort?: IdentityPresetPort`、`AgentRuntimeConfig.identityPreset?: ResolvedIdentityPreset`
  - `@zcode/core` 公开导出 `./fork/identity-preset/index.js`

- [ ] **Step 1: 写失败的测试**

创建 `apps/zcode-cli/packages/core/test/forkIdentityPresetContext.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { createContextBuilder } from "../src/context/builder.js";
import type { ContextBuilderConfig } from "../src/context/types.js";

const ENV_INFO = {
  cwd: "/tmp/workspace",
  platform: "darwin",
  shell: "zsh",
  osVersion: "test",
  nodeVersion: "v24",
};

function build(config: Partial<ContextBuilderConfig> = {}) {
  return createContextBuilder({
    workingDirectory: "/tmp/workspace",
    envInfo: ENV_INFO,
    currentDate: "2026-09-28",
    ...config,
  }).build();
}

test("未启用自定义身份时系统提示词与现状一致", () => {
  const result = build();
  assert.equal(result.systemMessages.length, 3);
  assert.equal(result.systemMessages[0]?.content, "You are ZCode, an interactive coding agent");
  assert.match(String(result.systemMessages[1]?.content), /You are an interactive ZCode agent/);
});

test("启用后第 1 段消失，身份段换成用户内容，动态段保留", () => {
  const result = build({
    identityPreset: { id: "concise", name: "极简", content: "你是我的私人助理。" },
  });
  assert.equal(result.systemMessages.length, 2);
  assert.equal(result.systemMessages[0]?.content, "你是我的私人助理。");
  const dynamic = String(result.systemMessages[1]?.content);
  assert.match(dynamic, /# Environment/);
  assert.match(dynamic, /# Context management/);
  const all = result.systemMessages.map((message) => String(message.content)).join("\n");
  assert.doesNotMatch(all, /You are ZCode, an interactive coding agent/);
  assert.doesNotMatch(all, /You are an interactive ZCode agent/);
  assert.doesNotMatch(all, /# Harness/);
});

test("customSystemPrompt 在场时忽略自定义身份（宿主意图优先）", () => {
  const result = build({
    customSystemPrompt: "宿主注入的提示词",
    identityPreset: { id: "concise", name: "极简", content: "你是我的私人助理。" },
  });
  const all = result.systemMessages.map((message) => String(message.content)).join("\n");
  assert.match(all, /宿主注入的提示词/);
  // customSystemPrompt 的既有语义不变：cli_prefix 仍在，只是身份 body 被替换
  assert.match(all, /You are ZCode, an interactive coding agent/);
  assert.doesNotMatch(all, /你是我的私人助理/);
});

test("工作流子代理身份在场时忽略自定义身份", () => {
  const result = build({
    workflowActor: { name: "researcher" },
    identityPreset: { id: "concise", name: "极简", content: "你是我的私人助理。" },
  });
  const all = result.systemMessages.map((message) => String(message.content)).join("\n");
  assert.match(all, /subagent inside a dynamic workflow run/);
  assert.doesNotMatch(all, /你是我的私人助理/);
  assert.doesNotMatch(all, /You are ZCode, an interactive coding agent/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec tsx --test apps/zcode-cli/packages/core/test/forkIdentityPresetContext.test.ts`
Expected: FAIL — `identityPreset` 不是 `ContextBuilderConfig` 的已知属性（TS 类型错误 / 断言失败）

- [ ] **Step 3: 写实现**

3a. 创建 `apps/zcode-cli/packages/core/src/fork/identity-preset/index.ts`：

```ts
/**
 * 系统指令（fork）公开入口。
 * 见 FEATURES.md 的 identity-preset 条目与 docs/features/identity-preset/design.md。
 */
export * from "./profile-file.js";
export * from "./identityManager.js";
export * from "./file-port.js";
```

3b. 修改 `apps/zcode-cli/packages/core/src/context/types.ts`：在 `ContextBuilderConfig` 的 `customSystemPrompt?: string;` 之后插入

```ts
  // FORK(identity-preset): 用户自定义身份段；在场时替换 cli_prefix + identity 两段，
  // 动态段（环境/git/上下文管理/桌面契约）不受影响；customSystemPrompt 在场时让位
  identityPreset?: ResolvedIdentityPreset;
```

并在文件顶部的 import 区追加

```ts
// FORK(identity-preset): 自定义身份段的类型与构造在同包的 fork 目录，避免把契约塞进 contracts
import type { ResolvedIdentityPreset } from "../fork/identity-preset/identityManager.js";
```

3c. 修改 `apps/zcode-cli/packages/core/src/context/builder.ts`：

- import 区追加

```ts
// FORK(identity-preset): 用户自定义身份段
import { buildIdentityPresetSection } from "../fork/identity-preset/identityManager.js";
```

- 在 `const isWorkflowActor = workflowActor !== undefined;` 之后插入

```ts
// FORK-BEGIN(identity-preset)
// 工作流子代理的身份由契约提供；customSystemPrompt 是宿主程序化注入，优先级高于用户配置。
// 两者在场时都必须让 customIdentity 保持 undefined，否则「忽略自定义身份」会通过
// 「少了 cli_prefix」这一处泄漏出来（design.md 6.2）。
const customIdentity =
  isWorkflowActor || hasCustomSystemPrompt ? undefined : this.config.identityPreset;
// FORK-END(identity-preset)
```

- 第 1 段改为

```ts
// 1. CLI / product prefix. Keep this as the short leading identity block.
// 「You are ZCode, an interactive coding agent」对一个
// 只对脚本说话、可能连读文件工具都没有的子代理是错的身份，且走在正确身份段前面。
// FORK(identity-preset): 用户自定义身份段生效时连这一段一起换掉——用户要的是「身份完全由我决定」
if (!isWorkflowActor && !customIdentity) {
  sections.push(buildCliPrefixSection());
}
```

- 第 2 段改为

```ts
// 2. Stable agent behavior or custom prompt body
if (hasCustomSystemPrompt) {
  sections.push(
    createSection({
      name: "Custom System Prompt",
      source: "custom_system_prompt",
      injectionTarget: "system",
      cacheHint: "stable",
      content: customSystemPrompt ? `\n${customSystemPrompt}` : "",
    }),
  );
} else if (customIdentity) {
  // FORK(identity-preset): 用户自定义身份段；见 FEATURES.md 的 identity-preset 条目
  sections.push(buildIdentityPresetSection(customIdentity));
} else if (workflowActor !== undefined) {
  sections.push(buildWorkflowActorIdentitySection(workflowActor));
} else {
  sections.push(buildIdentitySection(activeOutputStyle));
}
```

3d. 修改 `apps/zcode-cli/packages/core/src/runtime/types.ts`：在 `contextSourcePort?: ContextSourcePort;` 之后插入

```ts
  // FORK-BEGIN(identity-preset)
  /** 用户自定义身份段端口；缺席即不启用（系统默认提示词）。只有 App 初始化时读取一次。 */
  identityPresetPort?: IdentityPresetPort;
  /** 初始化时解析出的有效自定义身份段，App 级冻结；见 docs/features/identity-preset/design.md 第 6.3 节 */
  identityPreset?: ResolvedIdentityPreset;
  // FORK-END(identity-preset)
```

并在该文件的类型导入区追加

```ts
// FORK(identity-preset): 自定义身份段的端口与结果类型
import type { IdentityPresetPort } from "../fork/identity-preset/file-port.js";
import type { ResolvedIdentityPreset } from "../fork/identity-preset/identityManager.js";
```

3e. 修改 `apps/zcode-cli/packages/core/src/runtime/methods/context.ts`：

- 在 `ensureContextInitialized` 里，`this.contextBuilder = this.createContextBuilderFromSnapshot(...)` **之前**插入

```ts
// FORK-BEGIN(identity-preset)
// 每个 App 只读一次并把结果冻结进 config：会话中途换提示词会改变 provider 的 prompt cache
// 前缀，破坏「前缀在会话内不可变」的既定不变量（design.md 6.3）。读取失败一律回退系统默认。
if (this.config.identityPresetPort) {
  const outcome = await this.config.identityPresetPort.loadActive();
  if (outcome.diagnostic) {
    this.logger?.warn("Identity preset load failed", {
      ...traceContextToLogContext(traceContext),
      event: "identity_preset.load.failed",
      module: "core.runtime",
      reason: outcome.diagnostic,
    });
  }
  this.config.identityPreset = outcome.preset;
}
// FORK-END(identity-preset)
```

- 在 `createContextBuilderFromSnapshot` 的 `contextConfig` 里，`customSystemPrompt: this.config.systemPrompt,` 之后插入

```ts
    // FORK(identity-preset): 自定义身份段随每个 model step 的 context 重建一起投影
    identityPreset: this.config.identityPreset,
```

3f. 修改 `apps/zcode-cli/packages/core/src/index.ts`：在 `// Context Builder` 区块的 `export * from "./context/index.js";` 之后插入

```ts
// FORK(identity-preset): 系统指令——用户自定义身份段；见 FEATURES.md 的 identity-preset 条目
export * from "./fork/identity-preset/index.js";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec tsx --test apps/zcode-cli/packages/core/test/forkIdentityPresetContext.test.ts`
Expected: PASS（4 个用例）

- [ ] **Step 5: 跑全量内核测试与类型检查**

```bash
pnpm exec tsx --test apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts apps/zcode-cli/packages/core/test/forkIdentityPresetContext.test.ts packages/shared/test/forkIdentityPresetContract.test.ts
pnpm typecheck
pnpm --dir apps/zcode-cli typecheck
pnpm lint
```

Expected: 全部通过。**若 `apps/zcode-cli typecheck` 或 `lint` 因工作区里他人施工的文件（`autoUpdater.ts` 等）失败**，只修本次改动相关的问题，并在交付说明里写明跳过的原因。

- [ ] **Step 6: 提交**

```bash
git add apps/zcode-cli/packages/core/src/fork/identity-preset/index.ts \
  apps/zcode-cli/packages/core/src/context/types.ts \
  apps/zcode-cli/packages/core/src/context/builder.ts \
  apps/zcode-cli/packages/core/src/runtime/types.ts \
  apps/zcode-cli/packages/core/src/runtime/methods/context.ts \
  apps/zcode-cli/packages/core/src/index.ts \
  apps/zcode-cli/packages/core/test/forkIdentityPresetContext.test.ts
git commit -m "feat(identity-preset): core 接线，自定义身份段替换 cli_prefix 与 identity"
```

---

## Task 6: bootstrap 端口装配

**Files:**

- Modify: `apps/zcode-cli/packages/bootstrap/src/app/create-app.ts`

**Interfaces:**

- Consumes: `createFileIdentityPresetPort`（由 `@zcode/core` 公开，Task 5）
- Produces: 运行中的 App 具备 `identityPresetPort`，指向 `<storageRoot>/presets`

- [ ] **Step 1: 接线**

在 `apps/zcode-cli/packages/bootstrap/src/app/create-app.ts` 的 `contextSourcePort:` 那一项之后插入

```ts
      // FORK-BEGIN(identity-preset)
      // 目录与 `agents/`、`skills/`、`commands/` 同级（storage root，默认 ~/.zcode），
      // 不是 cliStorageRoot；宿主侧服务写同一路径，两侧漂移的症状是「UI 看得见、agent 读不到」。
      identityPresetPort:
        options.identityPresetPort ??
        createFileIdentityPresetPort({
          root: join(storageRoot, FORK_IDENTITY_PRESET_ROOT_NAME),
        }),
      // FORK-END(identity-preset)
```

在同文件的 `@zcode/core` 导入里加上 `createFileIdentityPresetPort`，并从 `@zcode/shared` 导入 `FORK_IDENTITY_PRESET_ROOT_NAME`；`join` 已在该文件导入，无需新增。

- [ ] **Step 2: 验证 App 装配不破坏既有行为**

Run: `pnpm --dir apps/zcode-cli typecheck`
Expected: PASS

- [ ] **Step 3: 手工确认默认路径下「未启用」等价于现状**

CLI 入口是 `apps/zcode-cli/packages/cli/dist/zcode.cjs`（`@zcode/cli` 的 `bin`）。先在仓库根确认默认路径不存在：

```bash
ls ~/.zcode/presets 2>/dev/null || echo "目录不存在（预期）"
```

然后构建并跑一次无头 prompt（需要一个已配置的模型提供商）：

```bash
pnpm --dir apps/zcode-cli run cli:build
node apps/zcode-cli/packages/cli/dist/zcode.cjs --prompt "reply with the single word: ok" 2>&1 | tail -20
```

Expected（任一成立即通过本步，如实记录是哪一种）：

- 请求正常完成 → 日志里没有 `identity_preset.load.failed`；
- 因本机未配置模型提供商而失败 → 只要进程正常启动并走到模型请求阶段即视为通过。此时**端到端验证顺延到第 2 期**：桌面端有可用提供商，届时用真实会话核对系统提示词。

不要为了跑通这一步去改配置或引入提供商；本期的功能性验证由 Task 5 的 builder 集成测试承担。

- [ ] **Step 4: 提交**

```bash
git add apps/zcode-cli/packages/bootstrap/src/app/create-app.ts
git commit -m "feat(identity-preset): bootstrap 装配自定义身份段端口"
```

---

## Task 7: 文档回写与自查

**Files:**

- Create: `docs/features/identity-preset/implementation.md`
- Modify: `FEATURES.md`

- [ ] **Step 1: 写实现文档**

创建 `docs/features/identity-preset/implementation.md`，包含：落地位置（新文件清单）、关键改动、上游接线点与标记清单（文件 + 行号）、验证记录（命令与真实结果）、与设计的偏差（至少记录：端口方法名与返回形态从 `loadActive(): Promise<ResolvedIdentityPreset | undefined>` 细化为返回带 `diagnostic` 的 outcome）、以及「第 2、3 期未做」的明确声明。

- [ ] **Step 2: 登记 FEATURES.md**

在 `FEATURES.md` 的 `## 本地模式：去云账号 + WebDAV 配置同步 (local-mode)` 之后新增 `## 系统指令：用户自定义提示词 (identity-preset)` 条目，按文件头部规定的字段写全：状态、需求背景、修改内容、修改文件、上游改动标记、设计文档、实现文档、开发工作流、上游同步记录。本期状态写「第 1 期（内核）完成；第 2、3 期待实施」。

- [ ] **Step 3: 标记自查**

Run: `rg -n "FORK\(|FORK-BEGIN\(" --glob '!AGENTS.md' --glob '!FEATURES.md'`
Expected: 输出与实现文档里的接线清单一致；没有遗漏、没有多余。

- [ ] **Step 4: 全量检查**

```bash
pnpm typecheck
pnpm --dir apps/zcode-cli typecheck
pnpm lint
pnpm architecture:check --changed
pnpm fmt:check
```

Expected: 全部通过（`fmt:check` 若报本次新增文件，执行 `pnpm fmt` 后重新提交）。

- [ ] **Step 5: 提交**

```bash
git add docs/features/identity-preset/implementation.md FEATURES.md
git commit -m "docs(identity-preset): 回写第 1 期实现记录与功能索引"
```

---

## 本期完成的定义

- `pnpm exec tsx --test apps/zcode-cli/packages/core/test/forkIdentityPreset*.test.ts packages/shared/test/forkIdentityPresetContract.test.ts` 全绿（16 个用例）。
- 设计文档第 10 节验收场景 1、2、3、4 由测试覆盖并通过：
  - 场景 1 = 未启用时系统提示词不变（3 条 system 消息）；
  - 场景 2 = 启用后第一条 system 消息即用户内容，动态段仍在；
  - 场景 3 = 目录缺失 / 状态损坏 / activeId 悬空都回退系统默认；
  - 场景 4 = 工作流子代理身份不受影响。
- `~/.zcode/presets` 不存在时，应用行为与改动前一致。
- 上游接线全部带 `FORK(identity-preset)` 标记，`rg` 自查与实现文档一致。

## 后续计划

- **第 2 期（服务与设置页）**：`packages/services/src/fork/identityPreset.ts` 服务面、`packages/desktop/src/host/fork/identity-preset/**` 文件 CRUD 与 `active.json` 写入、访问层接线（`services/src/index.ts`、`services/src/accessor.ts`、`client/src/remoteServiceAccess.ts`、`desktop/src/host/index.ts`）、`packages/ui/src/fork/identity-preset/**` 设置栏目、i18n、test-ids，覆盖验收场景 5–10。第 2 期开始前另写 `implementation-plan-2.md`。
  - 附带修复（设计文档风险 6）：`packages/ui/src/lib/settingsNavigation.ts` 的 `isSettingsSectionId` 未包含 fork 上次加的 `configSync`，导致持久化的「上次所在栏目」无法恢复；本功能新增 `systemInstructions` 时一并补上，并在 `FEATURES.md` 的 `## 其他更新` 登记一行。
- **第 3 期（同步）**：`presets/` 纳入 WebDAV 备份包，覆盖验收场景 11–13，并在 `FEATURES.md` 的 local-mode 条目下加 `###` 功能增强记录。

### 第 2 期硬性要求（最终整包审查遗留，不得丢失）

以下由第 1 期最终审查判定为「第 2 期必须处理」，写进 `implementation-plan-2.md` 并逐条验收：

1. **写入方绝不覆盖已有配置**：`createForkIdentityPresetId` 派生出的 id 可能撞名（已知 `"a b"` 与 `"a-b"` 都得 `a-b`），第 2 期的 `createProfile` 必须先分配空闲 id（例如给派生函数加一个已占用集合参数）或以可读错误拒绝，**绝不能静默覆盖**——静默覆盖是数据丢失。
2. **序列化前归一化名称**：`serializeIdentityPresetFile` 自身不归一化，名称里含换行会破坏 frontmatter。
3. **Windows 保留设备名**：`nul.md` 之类是合法 id 但在 Windows 上不可写，必须呈现可读错误而不是原始 `EPERM`。
4. **正文长度上限**：预设正文会逐字进入每次模型请求，目前没有任何上限。
5. **原子写入**：`active.json` 与配置文件的写入走 temp + rename；读取侧无法区分「写了一半」与「用户改坏了」，半写的 `active.json` 会让每次会话启动都告警。
6. **设置页 e2e 必须显式断言冻结不变量**：不止「开关能用」，还要断言「一次会话只读一次，且请求体第一条 system 消息就是被激活的预设」。这是本功能唯一没有自动化守卫的核心不变量——若第 2 期推迟，优先补 `AgentRuntime` 测试夹具。

### 第 1 期最终审查的已接受残留（不修）

`describeUnhonoredState` 重新推导契约的四条规则（需契约侧返回可判别结果，超出本期）、`stripQuotes` 只剥双引号、端口测试用固定临时路径且不清理、`createFileIdentityPresetPort` 的 `root` 未校验、`ResolvedIdentityPreset` 与共享 profile 形状重复且无编译期绑定。
