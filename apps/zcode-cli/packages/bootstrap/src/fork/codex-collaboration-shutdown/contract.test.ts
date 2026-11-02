import { expect, it } from "vitest";
import { cleanupProtocolRuntime, ProtocolRuntimeResources } from "./module.js";
import { cleanupProtocolRuntime as protocolCleanup } from "../../zcode-protocol/runtime-cleanup.js";
import { ProtocolRuntimeResources as ProtocolResources } from "../../zcode-protocol/runtime-resources.js";

it("keeps both protocol entrypoints wired to the same resource owner and cleanup implementation", () => {
  expect(protocolCleanup).toBe(cleanupProtocolRuntime);
  expect(ProtocolResources).toBe(ProtocolRuntimeResources);
});
