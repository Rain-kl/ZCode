import "../../src/fork/codex-collaboration-tools/contract.test.js";
import { describe, expect, it, vi } from "vitest";
import { createSessionId, type CollaborationToolPort } from "@zcode/contracts";
import { createToolRegistry } from "../../src/tool/registry.js";
import { registerBuiltInTools } from "../../src/tool/handlers/index.js";
import { createToolExecutor } from "../../src/tool/executor.js";
import { PermissionService, defaultPermissionConfig } from "../../src/permission/service.js";
import { createInMemoryHookRunner } from "../../src/hooks/index.js";
import { buildToolExposure } from "../../src/tool/search/exposure.js";
import { createTestRuntimeModel } from "../../tests/test-runtime-model.js";
import { searchTools } from "../../src/tool/search/search.js";
import {
  buildCollaborationRole,
  mapCollaborationStatus,
} from "../../src/fork/codex-collaboration-tools/module.js";
import { resolveForkToolModeToolNames } from "../../src/fork/tool-modes/mode-tools.js";

function port(): CollaborationToolPort {
  return {
    spawn: vi.fn(async () => ({ task_name: "/root/worker" })),
    send: vi.fn(async () => ({})),
    followup: vi.fn(async () => ({})),
    interrupt: vi.fn(async () => ({ previous_status: "running" as const })),
    list: vi.fn(async () => ({
      agents: [{ agent_name: "/root", agent_status: "running" as const }],
    })),
    wait: vi.fn(async () => ({ message: "Wait completed.", timed_out: false })),
  };
}
function registry() {
  const tools = createToolRegistry();
  registerBuiltInTools(tools, { includeCollaboration: true });
  return tools;
}
describe("six collaboration tool entries", () => {
  it.each([
    { label: "present", options: { includeCollaboration: true }, available: true },
    { label: "absent", options: {}, available: false },
    {
      label: "excluded by allowlist",
      options: { includeCollaboration: true, allowedTools: ["EnterPlanMode", "Read"] },
      available: false,
    },
    {
      label: "disallowed by permission",
      options: { includeCollaboration: true, disallowedTools: ["spawn_agent"] },
      available: false,
    },
    {
      label: "disallowed by permission rule",
      options: { includeCollaboration: true, disallowedTools: ["spawn_agent(*)"] },
      available: false,
    },
  ])("plan-mode guidance reflects spawn $label", ({ options, available }) => {
    const tools = createToolRegistry();
    registerBuiltInTools(tools, options);
    const description = tools
      .toContracts()
      .find((tool) => tool.name === "EnterPlanMode")?.description;
    expect(description).toBeDefined();
    expect(tools.has("spawn_agent")).toBe(available);
    expect(description?.includes("spawn_agent")).toBe(available);
    if (!available) expect(description).toContain("explore directly using Glob, Grep, and Read");
  });
  it("keeps collaboration directly callable with ToolSearch enabled", () => {
    const tools = registry();
    const exposure = buildToolExposure({
      registry: tools,
      tools: tools.toContracts(),
      entries: [],
      mode: "local",
      model: createTestRuntimeModel({
        generateText: async () => ({ text: "", finishReason: "stop", usage: {} }),
      }),
    });
    for (const name of [
      "spawn_agent",
      "send_message",
      "followup_task",
      "interrupt_agent",
      "list_agents",
      "wait_agent",
    ]) {
      expect(
        exposure.tools.some((tool) => tool.name === name),
        name,
      ).toBe(true);
      expect(exposure.context.catalog.find((tool) => tool.name === name)?.deferred).toBe(false);
    }
  });
  it("keeps all six tools resident when ToolSearch is unavailable in basic mode", () => {
    const tools = createToolRegistry();
    registerBuiltInTools(tools, {
      includeCollaboration: true,
      allowedTools: resolveForkToolModeToolNames("basic"),
    });
    const exposure = buildToolExposure({
      registry: tools,
      tools: tools.toContracts(),
      entries: [],
      mode: "local",
      model: createTestRuntimeModel({
        generateText: async () => ({ text: "", finishReason: "stop", usage: {} }),
      }),
    });
    expect(exposure.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "spawn_agent",
        "send_message",
        "followup_task",
        "interrupt_agent",
        "list_agents",
        "wait_agent",
      ]),
    );
  });
  it("removes all four legacy tools from execution and discovery", () => {
    const tools = registry();
    registerBuiltInTools(tools, { includeCollaboration: true, silentDuplicateWarnings: true });
    const names = tools.toContracts().map((tool) => tool.name);
    for (const legacy of ["Agent", "Task", "SendMessage", "RespondToCoordinator"]) {
      expect(tools.has(legacy), legacy).toBe(false);
      expect(names).not.toContain(legacy);
      expect(
        searchTools(
          `select:${legacy}`,
          buildToolExposure({
            registry: tools,
            tools: tools.toContracts(),
            entries: [],
            model: createTestRuntimeModel({
              generateText: async () => ({ text: "", finishReason: "stop", usage: {} }),
            }),
            mode: "local",
          }).context.catalog,
          10,
        ),
      ).toEqual([]);
    }
    expect(names).toEqual(
      expect.arrayContaining([
        "spawn_agent",
        "send_message",
        "followup_task",
        "interrupt_agent",
        "list_agents",
        "wait_agent",
      ]),
    );
  });
  it("executes through permission, hooks, schemas and caller context", async () => {
    const linked = port();
    const pre = vi.fn(async () => ({}));
    const post = vi.fn(async () => ({}));
    const executor = createToolExecutor({
      registry: registry(),
      collaborationPort: linked,
      sessionId: createSessionId("collaboration-tools"),
      emitEvent: async () => {},
      permissionService: new PermissionService(defaultPermissionConfig),
      hookRunner: createInMemoryHookRunner({
        hooks: [
          { event: "PreToolUse", matcher: "spawn_agent", callback: pre },
          { event: "PostToolUse", matcher: "spawn_agent", callback: post },
        ],
      }),
    });
    const call = {
      id: "spawn-call",
      name: "spawn_agent",
      input: { task_name: "worker", message: "inspect" },
    };
    const result = await executor.execute(call);
    expect(result.success).toBe(true);
    expect(result.modelContent).toBe('{"task_name":"/root/worker"}');
    expect(linked.spawn).toHaveBeenCalledWith(
      { ...call.input, fork_turns: "all" },
      expect.objectContaining({ toolCallId: "spawn-call", signal: expect.any(AbortSignal) }),
    );
    expect(pre).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledOnce();
    const send = await executor.execute({
      id: "send",
      name: "send_message",
      input: { target: "worker", message: "progress" },
    });
    expect(send.success).toBe(true);
    expect(send.modelContent).toBe("");
    const legacy = await executor.execute({ id: "legacy", name: "Agent", input: {} });
    expect(legacy.success).toBe(false);
  });
  it("maps root state supplied by runtime instead of controller idle", () => {
    expect(mapCollaborationStatus({ status: "idle" }, "running")).toBe("running");
    expect(mapCollaborationStatus({ status: "idle" })).toEqual({ completed: null });
    expect(mapCollaborationStatus({ status: "errored", lastError: "request failed" })).toEqual({
      errored: "request failed",
    });
  });
  it("routes remaining methods with trace and signal through the executor", async () => {
    const linked = port();
    const executor = createToolExecutor({
      registry: registry(),
      collaborationPort: linked,
      sessionId: createSessionId("routes"),
      emitEvent: async () => {},
      permissionService: new PermissionService(defaultPermissionConfig),
    });
    for (const [name, method, input] of [
      ["followup_task", "followup", { target: "worker", message: "continue" }],
      ["interrupt_agent", "interrupt", { target: "worker" }],
      ["list_agents", "list", {}],
      ["wait_agent", "wait", { timeout_ms: 0 }],
    ] as const) {
      const result = await executor.execute({ id: name, name, input });
      expect(result.success, name).toBe(true);
      expect(linked[method]).toHaveBeenCalledOnce();
      expect(linked[method]).toHaveBeenCalledWith(
        input,
        expect.objectContaining({ toolCallId: name, signal: expect.any(AbortSignal) }),
      );
    }
  });
  it("denied permission cannot reach the port and malformed outputs fail", async () => {
    const linked = port();
    const denied = createToolExecutor({
      registry: registry(),
      collaborationPort: linked,
      sessionId: createSessionId("deny"),
      emitEvent: async () => {},
      permissionService: new PermissionService({
        ...defaultPermissionConfig,
        disallowedTools: new Set(["spawn_agent"]),
      }),
    });
    const call = {
      id: "blocked",
      name: "spawn_agent",
      input: { task_name: "worker", message: "work" },
    };
    expect((await denied.execute(call)).success).toBe(false);
    expect(linked.spawn).not.toHaveBeenCalled();
    vi.mocked(linked.spawn).mockResolvedValueOnce({ task_name: "" });
    const invalid = createToolExecutor({
      registry: registry(),
      collaborationPort: linked,
      sessionId: createSessionId("invalid"),
      emitEvent: async () => {},
      permissionService: new PermissionService(defaultPermissionConfig),
    });
    expect((await invalid.execute(call)).success).toBe(false);
  });
  it("does not promise spawn past the actual depth/tool permission", () => {
    const role = buildCollaborationRole({
      path: "/root/worker",
      config: { maxDepth: 1 },
      toolNames: ["send_message", "list_agents", "wait_agent"],
    });
    expect(role).toContain("/root/worker");
    expect(role).not.toContain("spawn_agent");
    expect(role).toContain("send_message");
    expect(role).not.toContain("functions.exec");
    expect(role).toContain("Do not spawn sub-agents unless");
    const root = buildCollaborationRole({
      path: "/root",
      config: { delegationMode: "proactive" },
      toolNames: ["spawn_agent", "wait_agent"],
    });
    expect(root).toContain("Proactive multi-agent delegation is active");
    expect(root).toContain("4 available concurrency slots");
    expect(root).toContain("fork_turns");
  });
});
