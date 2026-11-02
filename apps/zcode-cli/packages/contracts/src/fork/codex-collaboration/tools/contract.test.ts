import { expect, it } from "vitest";
import { SpawnAgentInputSchema } from "./contract.js";
it("public boundary rejects model overrides on inherited full history", () => {
  expect(
    SpawnAgentInputSchema.safeParse({
      task_name: "worker",
      message: "work",
      model: "provider/model",
    }).success,
  ).toBe(false);
});
