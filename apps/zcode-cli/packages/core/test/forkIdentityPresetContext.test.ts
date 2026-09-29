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

test("空白正文的自定义身份按未启用处理（公开配置边界也要守）", () => {
  // ContextBuilderConfig 是公开 API，直接调用方绕过端口，所以这里钉住 builder 自己的守卫：
  // 放行空白正文会让 cli_prefix 与身份段一起消失，agent 一个身份都不剩。
  const result = build({
    identityPreset: { id: "blank", name: "空白", content: "   " },
  });
  assert.equal(result.systemMessages.length, 3);
  assert.equal(result.systemMessages[0]?.content, "You are ZCode, an interactive coding agent");
});

test("关闭动态段注入后，system 提示词只剩身份段", () => {
  const result = build({
    identityPreset: {
      id: "pure",
      name: "纯提示词",
      content: "你是我的私人助理。",
      injectDynamic: false,
    },
  });

  // 第①条（cli_prefix）已被替换、第③条整段不发出 → 只剩 stable 那一条。
  assert.equal(result.systemMessages.length, 1);
  const only = String(result.systemMessages[0]?.content);
  assert.equal(only, "你是我的私人助理。");
  assert.doesNotMatch(only, /# Environment/);
  assert.doesNotMatch(only, /# Context management/);
  assert.doesNotMatch(only, /You are ZCode, an interactive coding agent/);
});

test("skills 清单开关：关闭后不再注入 skills_listing 附件", () => {
  // 清单是独立的 meta-user 消息；这条开关只控制它，不影响身份段与动态段。
  const skills = {
    skills: [{ name: "demo-skill", description: "示例技能", path: "/tmp/demo/SKILL.md" }],
    diagnostics: [],
    totalDiscovered: 1,
  };
  const withListing = build({
    skills,
    guidanceToolNames: ["Skill"],
    identityPreset: {
      id: "a",
      name: "A",
      content: "你是我的私人助理。",
      injectDynamic: true,
      injectSkills: true,
    },
  });
  assert.deepEqual(
    withListing.metaUserAttachments.map((attachment) => attachment.source),
    // context_prefix（当前日期那段）与本开关无关，始终在。
    ["skills_listing", "context_prefix"],
  );

  const withoutListing = build({
    skills,
    guidanceToolNames: ["Skill"],
    identityPreset: {
      id: "a",
      name: "A",
      content: "你是我的私人助理。",
      injectDynamic: true,
      injectSkills: false,
    },
  });
  assert.deepEqual(
    withoutListing.metaUserAttachments.map((attachment) => attachment.source),
    ["context_prefix"],
  );
});

test("关闭动态段注入后，当前日期也不再注入（AGENTS.md 照旧）", () => {
  const base = {
    identityPreset: {
      id: "a",
      name: "A",
      content: "你是我的私人助理。",
      injectDynamic: false,
      injectSkills: true,
    },
  };
  const withoutInstructions = build(base);
  // 工作区没有指令时，context_prefix 整条消失（它只装日期与 agentsMd）。
  assert.deepEqual(withoutInstructions.metaUserAttachments, []);

  const withInstructions = build({
    ...base,
    userInstructions: {
      filePath: "/tmp/ws/AGENTS.md",
      fileName: "AGENTS.md",
      content: "项目规则",
      bytesRead: 12,
      sizeBytes: 12,
      truncated: false,
    },
  });
  const sources = withInstructions.metaUserAttachments.map((attachment) => attachment.source);
  assert.deepEqual(sources, ["context_prefix"]);
  const body = withInstructions.metaUserAttachments[0]?.content ?? "";
  assert.match(body, /项目规则/);
  assert.doesNotMatch(body, /# currentDate/);
});

test("关闭动态段后，AGENTS.md 块不再套 ZCode 的头/尾说明", () => {
  const instructions = {
    filePath: "/tmp/ws/AGENTS.md",
    fileName: "AGENTS.md",
    content: "项目规则",
    bytesRead: 12,
    sizeBytes: 12,
    truncated: false,
  };
  const preset = {
    id: "a",
    name: "A",
    content: "你是我的私人助理。",
    injectSkills: true,
  };

  const off = build({
    identityPreset: { ...preset, injectDynamic: false },
    userInstructions: instructions,
  });
  const offBody = off.metaUserAttachments[0]?.content ?? "";
  assert.match(offBody, /项目规则/);
  assert.doesNotMatch(offBody, /As you answer the user's questions/);
  assert.doesNotMatch(offBody, /this context may or may not be relevant/);

  // 开启动态段时保持上游行为：头/尾说明仍在。
  const on = build({
    identityPreset: { ...preset, injectDynamic: true },
    userInstructions: instructions,
  });
  const onBody = on.metaUserAttachments[0]?.content ?? "";
  assert.match(onBody, /As you answer the user's questions/);
  assert.match(onBody, /this context may or may not be relevant/);
});
