import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = parse(
  await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8"),
);
const { jobs } = workflow;
const gates = [
  "resolve",
  "verify",
  "unit-tests",
  "build-macos",
  "build-windows",
  "build-source-server",
];

test("builds and complete test gates start after resolve without waiting for each other", () => {
  for (const name of gates.slice(1)) {
    assert.deepEqual(jobs[name].needs, ["resolve"], name);
    assert.ok(!jobs[name]["continue-on-error"], name);
    for (const step of jobs[name].steps) {
      if (step.name !== "Third-party inventory check (advisory)") {
        assert.ok(!step["continue-on-error"], `${name}: ${step.name}`);
      }
    }
  }
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
});

test("publication explicitly waits for every gate and rejects failure, skip and cancellation", () => {
  assert.deepEqual(jobs.publish.needs, gates);
  const condition = jobs.publish.if;
  assert.match(condition, /!cancelled\(\)/);
  for (const gate of gates) {
    assert.ok(condition.includes(`needs.${gate}.result == 'success'`), gate);
  }
  function permits(results, cancelled = false) {
    const expression = condition
      .replace(/^\$\{\{\s*|\s*\}\}$/g, "")
      .replace(/cancelled\(\)/g, JSON.stringify(cancelled))
      .replace(/needs\.([\w-]+)\.result/g, (_, gate) => JSON.stringify(results[gate]));
    return Function(`"use strict"; return (${expression});`)();
  }
  const success = Object.fromEntries(gates.map((gate) => [gate, "success"]));
  assert.equal(permits(success), true);
  assert.equal(permits(success, true), false);
  for (const gate of gates) {
    for (const result of ["failure", "skipped", "cancelled"]) {
      assert.equal(permits({ ...success, [gate]: result }), false, `${gate}: ${result}`);
    }
  }
});

test("four full-suite shards retain CLI and Electron prerequisites and report all failures", () => {
  const job = jobs["unit-tests"];
  assert.deepEqual(job.strategy.matrix.shard, [1, 2, 3, 4]);
  assert.equal(job.strategy["fail-fast"], false);
  const commands = job.steps.filter((step) => step.run).map((step) => step.run);
  const unitCommand = "pnpm test:unit --shard=${{ matrix.shard }}/${{ strategy.job-total }}";
  assert.ok(commands.includes(unitCommand));
  assert.ok(!commands.some((command) => /--passWithNoTests|--changed|--project/.test(command)));
  for (const prerequisite of [
    'pnpm --dir apps/zcode-cli -r --filter "@zcode/core..." --filter "@zcode/adapters" run build',
    "pnpm --filter @zcode/desktop rebuild electron",
  ]) {
    assert.ok(
      commands.indexOf(prerequisite) >= 0 &&
        commands.indexOf(prerequisite) < commands.indexOf(unitCommand),
    );
  }
  const verify = jobs.verify.steps.filter((step) => step.run).map((step) => step.run);
  assert.ok(verify.includes("pnpm test:unit:fork"));
  assert.ok(
    verify.includes(
      "node --test scripts/test/release-workflow.test.mjs scripts/test/release-sharding.test.mjs scripts/test/source-server-release.test.mjs",
    ),
  );
  assert.ok(!verify.includes("pnpm test:unit"));
});

test("only publish may write Releases; builders use identical version and SHA outputs", () => {
  for (const name of ["build-macos", "build-windows", "build-source-server"]) {
    const job = jobs[name];
    assert.match(job.if, /needs\.resolve\.result == 'success'/);
    assert.doesNotMatch(job.if, /needs\.(verify|unit-tests)/);
    const commands = job.steps
      .filter((step) => step.run)
      .map((step) => step.run)
      .join("\n");
    assert.ok(
      commands.includes(
        'release-version.mjs apply --version "${{ needs.resolve.outputs.version }}"',
      ),
    );
    assert.doesNotMatch(
      commands,
      /gh release (create|edit|upload)|source-server-release\.mjs publish/,
    );
    assert.equal(job.steps.find((step) => step.name === "Checkout repository").with, undefined);
  }
});
