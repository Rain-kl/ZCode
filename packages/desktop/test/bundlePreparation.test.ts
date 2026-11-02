import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createBundlePreparationPlan } from "../scripts/bundle.mjs";

describe("bundle preparation ownership", () => {
  for (const [skipPrepare, skipBuild, expected] of [
    [false, false, ["prepare:runtime-assets", "build:no-runtime-assets"]],
    [true, false, ["build:no-runtime-assets"]],
    [false, true, ["prepare:runtime-assets"]],
    [true, true, []],
  ] as const) {
    it(`prepare=${!skipPrepare}, build=${!skipBuild} performs no nested preparation`, () => {
      expect(createBundlePreparationPlan({ skipPrepare, skipBuild })).toEqual(expected);
    });
  }

  it("direct build still prepares runtime while the bundle app phase does not", async () => {
    const { scripts } = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(scripts.build).toBe("pnpm prepare:runtime-assets && pnpm run build:no-runtime-assets");
    expect(scripts["build:no-runtime-assets"]).toBe(
      "pnpm prepare:build-meta && node scripts/run-production-build.mjs",
    );
  });
});
