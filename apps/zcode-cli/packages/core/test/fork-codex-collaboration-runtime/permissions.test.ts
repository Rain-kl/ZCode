import { expect, it } from "vitest";
import { PermissionService, defaultPermissionConfig } from "../../src/permission/service.js";
it("forks persistent permission policy without copying active session grants", () => {
  const parent = new PermissionService({
    ...defaultPermissionConfig,
    disallowedTools: new Set(["Write"]),
  });
  parent.grantSessionPermission([
    { behavior: "allow", rules: [{ toolName: "CreateWorkflow" }], type: "addRules" },
  ]);
  const capability = {
    alwaysAsk: true,
    readOnly: false,
    destructive: false,
    needsApproval: true,
    sideEffectScope: "session" as const,
    riskLevel: "low" as const,
  };
  const context = {
    toolName: "CreateWorkflow",
    input: {},
    mode: "yolo" as const,
    riskLevel: "low" as const,
  };
  expect(parent.checkPermission(context, capability).decision).toBe("allow");
  const child = parent.forkForChild();
  expect(child.checkPermission(context, capability).decision).toBe("ask");
  expect(child.checkPermission({ ...context, toolName: "Write", mode: "build" }).decision).toBe(
    "deny",
  );
});
