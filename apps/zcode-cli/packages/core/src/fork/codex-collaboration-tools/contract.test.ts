import { expect, it } from "vitest";
import { createCollaborationToolEntries } from "./module.js";
it("public entry exposes exactly six new tool adapters", () => {
  expect(createCollaborationToolEntries().map((entry) => entry.metadata.name)).toEqual([
    "spawn_agent",
    "send_message",
    "followup_task",
    "interrupt_agent",
    "list_agents",
    "wait_agent",
  ]);
});
