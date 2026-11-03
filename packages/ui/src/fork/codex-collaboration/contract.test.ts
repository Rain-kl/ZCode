import { expect, it } from "vitest";
import { collaborationActionName } from "./contract.js";
it("recognizes six current actions without recovering legacy aliases", () => {
  expect(collaborationActionName("wait_agent")).toBe("wait_agent");
  expect(collaborationActionName("SendMessage")).toBeUndefined();
  expect(collaborationActionName("Agent")).toBeUndefined();
});
