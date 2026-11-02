import { expect, it } from "vitest";
import * as contracts from "../../src/index.js";

it("does not export retired model tool protocols from the public contracts boundary", () => {
  for (const name of [
    "AgentInputSchema",
    "AgentOutputSchema",
    "SendMessageInputSchema",
    "SendMessageOutputSchema",
    "RespondToCoordinatorInputSchema",
    "RESPOND_TO_COORDINATOR_TOOL_NAME",
  ]) {
    expect(name in contracts, name).toBe(false);
  }
});
