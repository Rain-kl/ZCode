import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanupFailedRelayStartup } from "../src/server-core/core.js";

test("Relay startup failure stops connector before HTTP and services", async () => {
  const calls: string[] = [];
  await cleanupFailedRelayStartup({
    stopConnector: () => {
      calls.push("connector");
    },
    closeHttp: async () => {
      calls.push("http");
    },
    disposeServices: async () => {
      calls.push("services");
    },
  });
  assert.deepEqual(calls, ["connector", "http", "services"]);
});

test("Relay startup cleanup continues after each resource reports an error", async () => {
  const calls: string[] = [];
  await cleanupFailedRelayStartup({
    stopConnector: () => {
      calls.push("connector");
      throw new Error("connector stop failed");
    },
    closeHttp: async () => {
      calls.push("http");
      throw new Error("http close failed");
    },
    disposeServices: async () => {
      calls.push("services");
      throw new Error("services dispose failed");
    },
  });
  assert.deepEqual(calls, ["connector", "http", "services"]);
});
