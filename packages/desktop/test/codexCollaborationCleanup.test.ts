import assert from "node:assert/strict";
import test from "node:test";
import { attemptAllCleanup } from "./e2e/helpers/attempt-all-cleanup.js";

test("provider gate failure still attempts later gates, Stop, mocks and data cleanup", async () => {
  const providerError = new Error("provider unavailable");
  const stopError = new Error("stop rejected");
  const calls: string[] = [];
  const step = (name: string, failure?: Error) => async () => {
    calls.push(name);
    if (failure) throw failure;
  };
  await assert.rejects(
    attemptAllCleanup([
      () => attemptAllCleanup([step("gate-1", providerError), step("gate-2")]),
      step("stop", stopError),
      step("mocks"),
      step("data"),
    ]),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      assert.ok(error.errors[0] instanceof AggregateError);
      assert.equal(error.errors[0].errors[0], providerError);
      assert.equal(error.errors[1], stopError);
      return true;
    },
  );
  assert.deepEqual(calls, ["gate-1", "gate-2", "stop", "mocks", "data"]);
});
