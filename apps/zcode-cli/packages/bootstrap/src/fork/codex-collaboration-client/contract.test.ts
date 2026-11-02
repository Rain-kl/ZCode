import { expect, it } from "vitest";
import { CollaborationIdentityMetadataSchema } from "@zcode/contracts";
it("rejects invented identity fields and requires the exact opaque child session", () => {
  const relation = {
    version: 1,
    agentId: "agent-opaque-a7",
    childSessionId: "session-random-f91",
    parentId: "root-agent",
    parentSessionId: "root-session",
    path: "/root/worker",
    generation: 2,
    toolCallId: "spawn-call-6",
    agentType: "general-purpose",
  };
  expect(CollaborationIdentityMetadataSchema.parse(relation).childSessionId).toBe(
    "session-random-f91",
  );
  expect(
    CollaborationIdentityMetadataSchema.safeParse({ ...relation, fabricatedSession: true }).success,
  ).toBe(false);
  expect(
    CollaborationIdentityMetadataSchema.safeParse({ ...relation, childSessionId: undefined })
      .success,
  ).toBe(false);
});
