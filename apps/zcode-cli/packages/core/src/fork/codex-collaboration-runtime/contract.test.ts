import { expect, it } from "vitest";
import { COLLABORATION_SESSION_ENTRY } from "./contract.js";
it("keeps the durable root-entry key stable for cold readers", () => {
  expect(COLLABORATION_SESSION_ENTRY).toBe("codex_collaboration");
});
