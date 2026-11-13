import { expect, it, vi } from "vitest";
import { createSessionId, type ModelRequest, type McpPort } from "@zcode/contracts";
import { createTestAgentRuntime } from "../../tests/test-agent-runtime.js";
import { createTestModelFactory } from "../../tests/test-runtime-model.js";
import { createTestSessionEventStore } from "../../tests/test-event-store.js";
import { createRecordingSubagentSessionStore } from "../../tests/subagent-test-store.js";
import { roots, tool, done } from "./fixture.js";
import { PermissionService, defaultPermissionConfig } from "../../src/permission/service.js";
it("forks persistent permission policy without copying active session grants", () => {
  const parent = new PermissionService({
    ...defaultPermissionConfig,
    disallowedTools: new Set(["Write"]),
  });
  parent.grantSessionPermission([
    { behavior: "allow", rules: [{ toolName: "CreateWorkflow" }], type: "addRules" },
  ]);
  const capability = {
    alwaysAsk: true,
    readOnly: false,
    destructive: false,
    needsApproval: true,
    sideEffectScope: "session" as const,
    riskLevel: "low" as const,
  };
  const context = {
    toolName: "CreateWorkflow",
    input: {},
    mode: "yolo" as const,
    riskLevel: "low" as const,
  };
  expect(parent.checkPermission(context, capability).decision).toBe("allow");
  const child = parent.forkForChild();
  expect(child.checkPermission(context, capability).decision).toBe("ask");
  expect(child.checkPermission({ ...context, toolName: "Write", mode: "build" }).decision).toBe(
    "deny",
  );
});
it.each(["all", "none"] as const)(
  "keeps explicit profile tools within parent permissions for fork %s",
  async (fork_turns) => {
    const requests: ModelRequest[] = [];
    const runtime = createTestAgentRuntime(
      createSessionId(),
      {
        mode: "yolo",
        memory: { enabled: false },
        toolAllowlist: ["spawn_agent", "Read"],
        subagents: {
          profiles: [
            {
              name: "writer",
              source: "user",
              description: "Restricted writer",
              systemPrompt: "Inspect",
              tools: ["Write", "Read"],
            },
          ],
        },
      },
      {
        eventStore: createTestSessionEventStore(),
        sessionStore: createRecordingSubagentSessionStore(),
        modelFactory: createTestModelFactory({
          generateText: async (request, observation) => {
            if (observation.invocationContext?.traceContext?.sessionId === runtime.sessionId)
              return done;
            requests.push(request);
            return done;
          },
        }),
      },
    );
    roots.push(runtime);
    expect(
      (
        await tool(runtime, "spawn_agent", {
          task_name: "worker",
          message: "inspect",
          agent_type: "writer",
          fork_turns,
        })
      ).success,
    ).toBe(true);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].tools?.map((entry) => entry.name)).toEqual(["Read"]);
  },
);
it.each(["mcp", "mcp__safe__*"])(
  "expands profile selector %s only within parent MCP permissions and preserves deny",
  async (selector) => {
    const requests: ModelRequest[] = [];
    const snapshot = {
      statuses: {
        safe: {
          status: "connected" as const,
          transport: "stdio" as const,
          toolCount: 2,
          updatedAt: "now",
        },
      },
      tools: ["read", "write"].map((toolName) => ({
        serverName: "safe",
        toolName,
        inputSchema: { type: "object" },
      })),
    };
    const port: McpPort = {
      connectConfiguredServers: async () => snapshot,
      connectServer: async () => snapshot.statuses.safe,
      disconnectServer: async () => {},
      status: async () => snapshot.statuses,
      listTools: async () => snapshot.tools,
      callTool: async () => ({ content: [] }),
      close: async () => {},
    };
    const runtime = createTestAgentRuntime(
      createSessionId(),
      {
        mode: "yolo",
        memory: { enabled: false },
        toolAllowlist: ["spawn_agent", "Read", "ToolSearch", "DeferredToolCall", "mcp__safe__read"],
        toolSearch: { mode: "local" },
        subagents: {
          profiles: [
            {
              name: "reader",
              source: "user",
              description: "Reader",
              systemPrompt: "Inspect",
              tools: [selector, "Read"],
              disallowedTools: ["Read"],
            },
          ],
        },
      },
      {
        mcpPort: port,
        eventStore: createTestSessionEventStore(),
        sessionStore: createRecordingSubagentSessionStore(),
        modelFactory: createTestModelFactory({
          generateText: async (request, observation) => {
            if (observation.invocationContext?.traceContext?.sessionId === runtime.sessionId)
              return done;
            requests.push(request);
            return done;
          },
        }),
      },
    );
    roots.push(runtime);
    expect(
      (
        await tool(runtime, "spawn_agent", {
          task_name: "worker",
          message: "inspect",
          agent_type: "reader",
          fork_turns: "none",
        })
      ).success,
    ).toBe(true);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].tools?.map((entry) => entry.name)).toEqual(["mcp__safe__read"]);
  },
);
