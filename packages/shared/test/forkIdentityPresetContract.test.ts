import assert from "node:assert/strict";
import test from "node:test";

import {
  FORK_IDENTITY_PRESET_DEFAULT_TEMPLATE,
  FORK_IDENTITY_PRESET_PROFILE_EXTENSION,
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

test("含非 ASCII 字符的名带 hash 后缀，不因共同 ASCII 部分撞 id", () => {
  const jijian = createForkIdentityPresetId("极简Style");
  const wanzheng = createForkIdentityPresetId("完整Style");
  assert.notEqual(jijian, wanzheng);
  // 有 ASCII 部分时仍以 slug 开头，人还能看出是哪个配置
  assert.match(jijian, /^style-[a-z0-9]+$/);
  assert.match(wanzheng, /^style-[a-z0-9]+$/);
  // 纯 ASCII 名保持干净 slug，不带后缀
  assert.equal(createForkIdentityPresetId("Style"), "style");
  assert.notEqual(createForkIdentityPresetId("极简风格"), createForkIdentityPresetId("完整风格"));
});

test("派生 id 恒满足 id 规则（含 50 字符上限）", () => {
  const samples = [
    "Concise Style",
    "my-style-2",
    "Style",
    "极简Style",
    "极简风格",
    "a".repeat(50),
    `${"极".repeat(10)}${"a".repeat(60)}`,
    "极简 style with spaces",
    "   ",
    "!!!",
    "---",
    "...",
    "@#$%",
    " - ",
  ];
  const derived = new Map<string, string>();
  for (const name of samples) {
    const id = createForkIdentityPresetId(name);
    assert.ok(isValidForkIdentityPresetId(id), `${JSON.stringify(name)} 派生出的 id 非法: ${id}`);
    // 纯符号名 slug 化后为空，曾塌成同一个非法 id（"profiles/.md"），这里钉住「各名字各 id」
    const previous = derived.get(id);
    assert.equal(
      previous,
      undefined,
      `${JSON.stringify(name)} 与 ${JSON.stringify(previous)} 派生出同一个 id: ${id}`,
    );
    derived.set(id, name);
  }
});

test("文件名后缀由契约固定，避免各处硬编码 .md", () => {
  assert.equal(FORK_IDENTITY_PRESET_PROFILE_EXTENSION, ".md");
  const id = createForkIdentityPresetId("Concise Style");
  assert.equal(`${id}${FORK_IDENTITY_PRESET_PROFILE_EXTENSION}`, "concise-style.md");
});

test("normalizeForkIdentityPresetName 拒绝空名与超长名", () => {
  assert.equal(normalizeForkIdentityPresetName("  极简 风格 "), "极简 风格");
  assert.equal(normalizeForkIdentityPresetName("   "), null);
  assert.equal(normalizeForkIdentityPresetName("x".repeat(51)), null);
});

test("状态文件解析对缺失与损坏一律降级为关闭", () => {
  const fallback = {
    schemaVersion: 1,
    enabled: false,
    activeId: null,
    injectDynamic: true,
    injectSkills: true,
  };
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
      injectDynamic: true,
      injectSkills: true,
    },
  );
  assert.deepEqual(
    parseForkIdentityPresetStateFile({ schemaVersion: 1, enabled: true, activeId: "" }),
    {
      schemaVersion: 1,
      enabled: true,
      activeId: null,
      injectDynamic: true,
      injectSkills: true,
    },
  );
  assert.deepEqual(
    parseForkIdentityPresetStateFile({ schemaVersion: 1, enabled: false, activeId: "concise" }),
    {
      schemaVersion: 1,
      enabled: false,
      activeId: "concise",
      injectDynamic: true,
      injectSkills: true,
    },
  );
  assert.deepEqual(
    parseForkIdentityPresetStateFile({ schemaVersion: 1, enabled: true, activeId: "concise" }),
    {
      schemaVersion: 1,
      enabled: true,
      activeId: "concise",
      injectDynamic: true,
      injectSkills: true,
    },
  );
});

test("skills 清单开关：缺省注入，显式 false 才关，非布尔值回落缺省", () => {
  const parsed = (extra: Record<string, unknown>) =>
    parseForkIdentityPresetStateFile({
      schemaVersion: 1,
      enabled: true,
      activeId: "concise",
      ...extra,
    }).injectSkills;
  assert.equal(parsed({}), true);
  assert.equal(parsed({ injectSkills: false }), false);
  assert.equal(parsed({ injectSkills: "no" }), true);
});

test("动态段开关：缺省注入，显式 false 才关，非布尔值回落缺省", () => {
  // 旧状态文件没有这个字段——不能因此把它判成「不认识」，也不能默认关掉动态段。
  assert.equal(
    parseForkIdentityPresetStateFile({ schemaVersion: 1, enabled: true, activeId: "concise" })
      .injectDynamic,
    true,
  );
  assert.equal(
    parseForkIdentityPresetStateFile({
      schemaVersion: 1,
      enabled: true,
      activeId: "concise",
      injectDynamic: false,
    }).injectDynamic,
    false,
  );
  assert.equal(
    parseForkIdentityPresetStateFile({
      schemaVersion: 1,
      enabled: true,
      activeId: "concise",
      injectDynamic: "yes",
    }).injectDynamic,
    true,
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
