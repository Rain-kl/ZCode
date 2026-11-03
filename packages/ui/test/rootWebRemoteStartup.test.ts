import { describe, expect, it } from "vitest";
import { shouldRestoreOAuthAtRootStartup } from "../src/lib/rootStartupGate.js";

describe("self-hosted web remote root startup", () => {
  it("does not gate the Relay-authenticated workspace on official OAuth restore", () => {
    expect(shouldRestoreOAuthAtRootStartup({ isWebRemoteControlRoot: true })).toBe(false);
    expect(shouldRestoreOAuthAtRootStartup({ isWebRemoteControlRoot: false })).toBe(true);
  });
});
