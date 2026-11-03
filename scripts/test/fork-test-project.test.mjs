import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
test("fork Vitest contracts are explicit and do not undo upstream engineering discovery", async () => {
  const config = await readFile(new URL("vitest.config.ts", root), "utf8");
  const manifest = JSON.parse(await readFile(new URL("scripts/fork-test-files.json", root), "utf8"));
  assert.ok(manifest.length > 0);
  assert.equal(new Set(manifest).size, manifest.length);
  assert.ok(manifest.includes("packages/ui/test/toolIdentity.test.ts"));
  assert.match(config, /name: "engineering"/);
  assert.match(config, /name: "fork-contracts"/);
  assert.match(config, /include: forkTestFiles/);
  assert.doesNotMatch(config, /include:\s*\[\s*"packages\/\*\/test/);
  for (const path of manifest) {
    assert.ok(!path.includes("*"), path);
    const source = await readFile(new URL(path, root), "utf8");
    assert.doesNotMatch(source, /from\s*["']node:test["']/, path);
  }
});
