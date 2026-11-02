import { expect, it } from "vitest";
import { CollaborationError } from "./contract.js";
import { parseCollaborationSnapshot } from "./module.js";

it("exports structured errors with the underlying driver cause", () => {
  const cause = new Error("session entry unavailable");
  const error = new CollaborationError(
    "STORAGE_FAILED",
    "Root entry save failed",
    { phase: "write" },
    { cause },
  );
  expect(error).toMatchObject({ code: "STORAGE_FAILED", context: { phase: "write" }, cause });
});
it("rejects incompatible snapshot versions at the public persistence boundary", () => {
  expect(() => parseCollaborationSnapshot({ version: 2 }, "root-session")).toThrow(
    CollaborationError,
  );
});
