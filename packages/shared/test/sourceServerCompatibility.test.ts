import { describe, expect, it } from "vitest";
import {
  createCompatibilityManifest,
  evaluateSourceServerCompatibility,
  isSourceServerReleaseVersionAccepted,
  shouldEnforceSourceServerVersionCompatibility,
} from "../src/source-server/compatibility.js";

describe("Source Server compatibility channel policy", () => {
  it("does not enforce minimum versions for a development controller", () => {
    const controller = createCompatibilityManifest(
      "3.17.162-dev.c1ea55a4",
      "3.17.162-dev.c1ea55a4",
    );
    const server = createCompatibilityManifest(
      "3.17.162-dev.cb9b2489",
      "3.17.162-dev.cb9b2489",
    );

    expect(shouldEnforceSourceServerVersionCompatibility(controller)).toBe(
      false,
    );
    expect(
      isSourceServerReleaseVersionAccepted(
        controller.productVersion,
        server.productVersion,
      ),
    ).toBe(true);
    expect(
      isSourceServerReleaseVersionAccepted(
        controller.productVersion,
        "3.17.162",
      ),
    ).toBe(false);
    expect(evaluateSourceServerCompatibility(controller, server)).toEqual({
      compatible: true,
      updateAvailable: false,
      newerEndpoint: "equal",
      newerVersion: server.productVersion,
      olderVersion: server.productVersion,
      requiredMinimumVersion: server.minCompatibleVersion,
    });
  });

  it("keeps the existing minimum-version gate for stable controllers", () => {
    const controller = createCompatibilityManifest("3.17.162", "3.17.162");
    const server = createCompatibilityManifest("3.17.120", "3.17.120");

    expect(shouldEnforceSourceServerVersionCompatibility(controller)).toBe(
      true,
    );
    expect(
      isSourceServerReleaseVersionAccepted(
        controller.productVersion,
        "3.17.162",
      ),
    ).toBe(true);
    expect(
      isSourceServerReleaseVersionAccepted(
        controller.productVersion,
        "3.17.163",
      ),
    ).toBe(false);
    expect(evaluateSourceServerCompatibility(controller, server)).toMatchObject(
      {
        compatible: false,
        upgradeTarget: "server",
        olderVersion: "3.17.120",
        requiredMinimumVersion: "3.17.162",
      },
    );
  });
});
