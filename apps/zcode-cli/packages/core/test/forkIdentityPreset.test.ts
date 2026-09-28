import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FORK_IDENTITY_PRESET_DEFAULT_TEMPLATE } from "@zcode/shared";

import { buildCliPrefixSection } from "../src/context/sections/cli-prefix.js";
import { buildIdentitySection } from "../src/context/sections/identity.js";
import { createFileIdentityPresetPort } from "../src/fork/identity-preset/file-port.js";
import {
  buildIdentityPresetSection,
  resolveActiveIdentityPreset,
} from "../src/fork/identity-preset/identityManager.js";
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

test("空 frontmatter 只吃掉分隔符，未闭合 frontmatter 仍整体当正文", () => {
  // 空 frontmatter 若不被识别，`---` 两行会原样进入系统提示词正文。
  assert.deepEqual(parseIdentityPresetFile("---\n---\n\nbody", "fallback"), {
    name: "fallback",
    content: "body",
  });
  // 未闭合（只有一个 ---）不是 frontmatter，整份内容按正文交回，不能把用户正文里的 --- 当分隔符吞掉。
  assert.deepEqual(parseIdentityPresetFile("---\nname: x\n\nbody", "fallback"), {
    name: "fallback",
    content: "---\nname: x\n\nbody",
  });
  // 正文里出现的 name: 行不得被当作元信息。
  assert.deepEqual(parseIdentityPresetFile("---\n---\n\n# 角色\nname: sneaky", "fallback"), {
    name: "fallback",
    content: "# 角色\nname: sneaky",
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
  // 「目录/文件不存在」是首次使用的常态，不能靠诊断把它当成故障。
  assert.equal(outcome.diagnostic, undefined);
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

test("schemaVersion 不认识时降级并留下诊断", async () => {
  const root = await writePresetRoot({
    state: { schemaVersion: 99, enabled: true, activeId: "concise" },
    profiles: { concise: "body" },
  });
  const outcome = await createFileIdentityPresetPort({ root }).loadActive();
  assert.equal(outcome.preset, undefined);
  assert.ok((outcome.diagnostic ?? "").length > 0);
  assert.match(outcome.diagnostic ?? "", /active\.json/);
});

test("enabled 非布尔值时降级并留下诊断", async () => {
  const root = await writePresetRoot({
    state: { schemaVersion: 1, enabled: "yes", activeId: "concise" },
    profiles: { concise: "body" },
  });
  const outcome = await createFileIdentityPresetPort({ root }).loadActive();
  assert.equal(outcome.preset, undefined);
  assert.ok((outcome.diagnostic ?? "").length > 0);
});

test("activeId 不符合 id 规则时降级并留下诊断", async () => {
  const root = await writePresetRoot({
    state: { schemaVersion: 1, enabled: true, activeId: "Not Valid" },
    profiles: { concise: "body" },
  });
  const outcome = await createFileIdentityPresetPort({ root }).loadActive();
  assert.equal(outcome.preset, undefined);
  assert.ok((outcome.diagnostic ?? "").length > 0);
});

test("用户主动关闭时不产生诊断（与文件损坏区分）", async () => {
  const root = await writePresetRoot({
    state: { schemaVersion: 1, enabled: false, activeId: null },
    profiles: { concise: "body" },
  });
  const outcome = await createFileIdentityPresetPort({ root }).loadActive();
  assert.equal(outcome.preset, undefined);
  assert.equal(outcome.diagnostic, undefined);
});

test("profiles 路径不可读时诊断说明目录问题，而非谎报配置不存在", async () => {
  const root = await mkdtemp(join(tmpdir(), "identity-preset-"));
  // 用普通文件占用 profiles 路径：readdir 必以 ENOTDIR 失败，可移植地模拟「目录读不到」，
  // 而不依赖 chmod（在 Windows 与 CI 上不可靠）。
  await writeFile(join(root, "profiles"), "", "utf8");
  await writeFile(
    join(root, "active.json"),
    JSON.stringify({ schemaVersion: 1, enabled: true, activeId: "concise" }),
    "utf8",
  );
  const outcome = await createFileIdentityPresetPort({ root }).loadActive();
  assert.equal(outcome.preset, undefined);
  const diagnostic = outcome.diagnostic ?? "";
  assert.ok(diagnostic.length > 0);
  assert.match(diagnostic, /profiles/);
  assert.doesNotMatch(diagnostic, /不存在或为空/);
});
