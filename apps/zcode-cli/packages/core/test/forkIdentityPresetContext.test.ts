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
