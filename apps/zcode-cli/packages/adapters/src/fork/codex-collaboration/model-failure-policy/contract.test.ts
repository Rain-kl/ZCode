import { expect, it } from "vitest";
import { exampleExhaustedWorkflowPolicy } from "./contract.example.js";
it("preserves the workflow's retry classification before exhaustion", () =>
  expect(exampleExhaustedWorkflowPolicy()).toEqual({ decision: "retry" }));
