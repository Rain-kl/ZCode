import { expect, it } from "vitest";
import {
  projectSessionSubagents,
  paginateEndedSubagents,
} from "../src/zcode-protocol/subagent-session-query.js";
import type { CollaborationChildFact } from "../src/fork/codex-collaboration-client/contract.js";
const child: CollaborationChildFact = {
  version: 1,
  agentId: "agent-opaque-a7",
  childSessionId: "session-random-f91",
  parentId: "root-agent",
  parentSessionId: "root-session",
  path: "/root/worker",
  generation: 2,
  toolCallId: "spawn-call-6",
  parentToolCallId: "spawn-call-6",
  agentType: "worker",
  status: "running",
  summaryText: "work",
};
it("uses canonical state, exact child identity and original anchor", () => {
  const view = projectSessionSubagents({ revision: 5, children: [child] });
  expect(view.running).toMatchObject([
    {
      childSessionId: child.childSessionId,
      agentId: child.agentId,
      toolCallId: "spawn-call-6",
      status: "running",
    },
  ]);
  expect(view.ended).toEqual([]);
  expect(
    projectSessionSubagents({ revision: 6, children: [{ ...child, status: "cancelled" }] }).ended,
  ).toMatchObject([{ status: "cancelled" }]);
});
it("paginates ended children with stable opaque cursor", () => {
  const ended = Array.from({ length: 25 }, (_, index) => ({
    childSessionId: `child-${String(index).padStart(2, "0")}`,
    subagentType: "worker",
    title: "work",
    status: "success" as const,
    endedAt: 100 - index,
  }));
  const first = paginateEndedSubagents(ended, { limit: 20 });
  const second = paginateEndedSubagents(ended, { limit: 20, cursor: first.nextCursor });
  expect(first.items).toHaveLength(20);
  expect(second.items).toEqual(ended.slice(20));
});
