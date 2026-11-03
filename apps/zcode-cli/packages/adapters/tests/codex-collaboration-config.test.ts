import { expect, it } from "vitest";
import { ConfigScope, ConfigKey, DefaultRuntimeConfig } from "@zcode/contracts";
import { ZCodeConfigFileSchema, parseConfigFileToRuntimePatchWithDiagnostics } from "../src/config/schema.js";
import { createConfigPort } from "../src/config/index.js";
import { mergeConfigs, createPrioritizedConfig } from "../src/config/config-merger.js";
it("preserves normalized delegation mode when a later config changes only capacity", () => {
  const config = mergeConfigs(
    createPrioritizedConfig(
      { subagents: { delegationMode: "proactive", maxTotalAgents: 6 } },
      ConfigScope.User,
    ),
    createPrioritizedConfig({ subagents: { maxDepth: 2 } }, ConfigScope.Project),
  );
  const port = createConfigPort(config);
  expect(port.getAll().subagents).toEqual({
    delegationMode: "proactive",
    maxTotalAgents: 6,
    maxDepth: 2,
    maxLoadedChildren: 3,
  });
});
it("removes the retired feature key from public configuration and rejects untyped set/get/merge", () => {
  expect(Object.hasOwn(ConfigKey, "FeatureSubagent")).toBe(false);
  expect(DefaultRuntimeConfig.features).not.toHaveProperty("subagent");
  const port = createConfigPort();
  expect(port.getAll().features).not.toHaveProperty("subagent");
  expect(() => Reflect.apply(port.set, port, ["features.subagent", false])).toThrow(/Unknown config key: features\.subagent/);
  expect(() => Reflect.apply(port.get, port, ["features.subagent"])).toThrow(/Unknown config key: features\.subagent/);
  expect(() => Reflect.apply(port.merge, port, [{ features: { subagent: false } }, ConfigScope.User])).toThrow(/subagent/);
  expect(() => Reflect.apply(port.merge, port, [{ subagents: { maxDepth: 9 }, features: { compact: false, subagent: false } }, ConfigScope.User])).toThrow(/subagent/);
  expect(port.getAll().features.compact).toBe(true);
  expect(port.getAll().subagents).toEqual({ delegationMode: "explicit", maxTotalAgents: 4, maxDepth: 1, maxLoadedChildren: 3 });
});
it("rejects the retired feature in direct file parsing instead of silently stripping it", () => {
  expect(ZCodeConfigFileSchema.safeParse({ features: { subagent: false } }).success).toBe(false);
  expect(() => parseConfigFileToRuntimePatchWithDiagnostics({ features: { subagent: true } })).toThrow(/subagent/);
  expect(ZCodeConfigFileSchema.parse({ features: { compact: false }, subagents: { maxTotalAgents: 5 } })).toMatchObject({ features: { compact: false }, subagents: { maxTotalAgents: 5 } });
});
