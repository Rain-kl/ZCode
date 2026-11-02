import "../../src/fork/codex-collaboration/tools/contract.test.js";
import { describe, expect, it } from "vitest";
import {
  CollaborationConfigSchema,
  CollaborationToolSchemas,
  SpawnAgentInputSchema,
  WaitAgentInputSchema,
} from "../../src/fork/codex-collaboration/tools/contract.js";

describe("Codex collaboration tool contracts", () => {
  it("exports exactly the six strict model tools", () => {
    expect(Object.keys(CollaborationToolSchemas)).toEqual([
      "spawn_agent",
      "send_message",
      "followup_task",
      "interrupt_agent",
      "list_agents",
      "wait_agent",
    ]);
    for (const spec of Object.values(CollaborationToolSchemas)) {
      expect(spec.input.safeParse({ callerId: "spoofed" }).success).toBe(false);
      expect(spec.output.safeParse({ unexpected: true }).success).toBe(false);
    }
  });
  it("defaults full history and rejects overrides unless none is explicit", () => {
    const task = { task_name: "worker_1", message: "inspect" };
    expect(SpawnAgentInputSchema.parse(task).fork_turns).toBe("all");
    for (const override of [{ model: "test/model" }, { reasoning_effort: "high" }]) {
      expect(SpawnAgentInputSchema.safeParse({ ...task, ...override }).success).toBe(false);
      expect(
        SpawnAgentInputSchema.safeParse({ ...task, fork_turns: "all", ...override }).success,
      ).toBe(false);
      expect(
        SpawnAgentInputSchema.safeParse({ ...task, fork_turns: "none", ...override }).success,
      ).toBe(true);
    }
    expect(SpawnAgentInputSchema.safeParse({ ...task, task_name: "../root" }).success).toBe(false);
    expect(SpawnAgentInputSchema.safeParse({ ...task, message: " " }).success).toBe(false);
  });
  it("bounds waits and keeps defaults in the shared configuration", () => {
    expect(WaitAgentInputSchema.parse({})).toEqual({ timeout_ms: 30_000 });
    expect(WaitAgentInputSchema.parse({ timeout_ms: 0 })).toEqual({ timeout_ms: 0 });
    expect(CollaborationConfigSchema.safeParse({ maxDepth: 0 }).success).toBe(false);
    expect(WaitAgentInputSchema.parse({ timeout_ms: 1 })).toEqual({ timeout_ms: 1 });
    expect(WaitAgentInputSchema.safeParse({ timeout_ms: 3_600_001 }).success).toBe(false);
    expect(CollaborationConfigSchema.parse({})).toEqual({
      delegationMode: "explicit",
      maxTotalAgents: 4,
      maxDepth: 1,
      maxLoadedChildren: 3,
    });
    expect(
      CollaborationConfigSchema.parse({ delegationMode: "proactive", maxDepth: 2 }).maxDepth,
    ).toBe(2);
    expect(CollaborationConfigSchema.safeParse({ maxTotalAgents: 0 }).success).toBe(false);
    expect(CollaborationConfigSchema.safeParse({ unknown: true }).success).toBe(false);
  });
  it("uses Codex status unions and private-identity-free outputs", () => {
    expect(
      CollaborationToolSchemas.spawn_agent.output.parse({ task_name: "/root/worker" }),
    ).toEqual({ task_name: "/root/worker" });
    expect(
      CollaborationToolSchemas.spawn_agent.output.safeParse({
        task_name: "/root/worker",
        agentId: "private",
      }).success,
    ).toBe(false);
    const output = CollaborationToolSchemas.list_agents.output;
    for (const agent_status of [
      "running",
      "pending_init",
      "interrupted",
      { completed: null },
      { completed: "done" },
      { errored: "network" },
    ]) {
      expect(output.safeParse({ agents: [{ agent_name: "/root", agent_status }] }).success).toBe(
        true,
      );
    }
    expect(
      output.safeParse({ agents: [{ agent_name: "/root", agent_status: "idle" }] }).success,
    ).toBe(false);
  });
});
