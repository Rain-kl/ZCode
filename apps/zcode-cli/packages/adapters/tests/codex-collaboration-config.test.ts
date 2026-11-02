import { expect, it } from "vitest";
import { ConfigScope } from "@zcode/contracts";
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
