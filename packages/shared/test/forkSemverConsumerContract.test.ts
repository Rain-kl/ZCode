import assert from "node:assert/strict";
import test from "node:test";
import { compareSemverVersions } from "../src/index.js";

test("upstream data-sync and Source lifecycle retain the pure version comparator", () => {
  assert.equal(compareSemverVersions("v3.17.1", "3.17.0"), 1);
  assert.equal(compareSemverVersions("3.17.1-beta.2", "3.17.1-beta.10"), -1);
  assert.equal(compareSemverVersions("3.17.1-beta", "3.17.1"), -1);
  assert.equal(compareSemverVersions("3.17", "3.17.0+build"), 0);
  assert.equal(compareSemverVersions("unknown", "3.17.0"), null);
});
