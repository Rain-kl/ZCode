import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = parse(
  await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8"),
);
const { jobs } = workflow;
const sourceServerWorkflow = parse(
  await readFile(
    new URL("../../.github/workflows/source-server-release.yml", import.meta.url),
    "utf8",
  ),
);
const sourceServerJobs = sourceServerWorkflow.jobs;
const gates = ["resolve", "verify", "unit-tests", "build-macos", "build-windows"];

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
  assert.match(jobs.verify.if, /needs\.resolve\.outputs\.prerelease != 'true'/);
  assert.match(jobs["unit-tests"].if, /needs\.resolve\.outputs\.prerelease != 'true'/);
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
});

test("publication requires builds and stable-only test gates", () => {
  assert.deepEqual(jobs.publish.needs, gates);
  const condition = jobs.publish.if;
  assert.match(condition, /!cancelled\(\)/);
  function permits(results, cancelled = false) {
    const expression = condition
      .replace(/^\$\{\{\s*|\s*\}\}$/g, "")
      .replace(/cancelled\(\)/g, JSON.stringify(cancelled))
      .replace(/needs\.resolve\.outputs\.prerelease/g, JSON.stringify(results.prerelease))
      .replace(/needs\.([\w-]+)\.result/g, (_, gate) => JSON.stringify(results[gate]));
    return Function(`"use strict"; return (${expression});`)();
  }
  const success = {
    ...Object.fromEntries(gates.map((gate) => [gate, "success"])),
    prerelease: "false",
  };
  assert.equal(permits(success), true);
  assert.equal(permits(success, true), false);
  assert.equal(
    permits({
      ...success,
      verify: "skipped",
      "unit-tests": "skipped",
      prerelease: "true",
    }),
    true,
  );
  for (const gate of ["verify", "unit-tests", "build-macos", "build-windows"]) {
    for (const result of ["failure", "skipped", "cancelled"]) {
      assert.equal(permits({ ...success, [gate]: result }), false, `${gate}: ${result}`);
    }
  }
  for (const gate of ["build-macos", "build-windows"]) {
    assert.equal(
      permits({
        ...success,
        verify: "skipped",
        "unit-tests": "skipped",
        prerelease: "true",
        [gate]: "failure",
      }),
      false,
      `canary ${gate}: failure`,
    );
  }
});

test("four full-suite shards retain CLI, report and Electron prerequisites and report all failures", () => {
  const job = jobs["unit-tests"];
  assert.deepEqual(job.strategy.matrix.shard, [1, 2, 3, 4]);
  assert.equal(job.strategy["fail-fast"], false);
  const commands = job.steps.filter((step) => step.run).map((step) => step.run);
  const unitCommand = "pnpm test:unit --shard=${{ matrix.shard }}/${{ strategy.job-total }}";
  assert.ok(commands.includes(unitCommand));
  assert.ok(!commands.some((command) => /--passWithNoTests|--changed|--project/.test(command)));
  for (const prerequisite of [
    'pnpm --dir apps/zcode-cli -r --filter "@zcode/core..." --filter "@zcode/adapters" run build',
    "pnpm --filter @zcode/e2e-report build:node",
    "pnpm --filter @zcode/desktop rebuild electron",
  ]) {
    assert.ok(
      commands.indexOf(prerequisite) >= 0 &&
        commands.indexOf(prerequisite) < commands.indexOf(unitCommand),
      `missing build prerequisite before unit tests: ${prerequisite}`,
    );
  }
  const verify = jobs.verify.steps.filter((step) => step.run).map((step) => step.run);
  assert.ok(verify.includes("pnpm test:unit:fork"));
  assert.ok(
    verify.includes(
      "node --test scripts/test/release-workflow.test.mjs scripts/test/release-sharding.test.mjs scripts/test/source-server-release.test.mjs scripts/test/server-installer.test.mjs",
    ),
  );
  assert.ok(!verify.includes("pnpm test:unit"));
});

test("Desktop publish is independent from Source Server and builders use identical version outputs", () => {
  for (const name of ["build-macos", "build-windows"]) {
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
  assert.doesNotMatch(JSON.stringify(workflow), /build-source-server|source-server-release\.mjs/);
  assert.deepEqual(sourceServerJobs["build-and-publish"].needs, ["resolve"]);
  assert.match(
    sourceServerJobs["build-and-publish"].steps.map((step) => step.run ?? "").join("\n"),
    /source-server-release\.mjs publish/,
  );
  assert.notEqual(workflow.concurrency.group, sourceServerWorkflow.concurrency.group);
});

test("Source Server installation retries only transient failures and preserves final diagnostics", async (t) => {
  const step = sourceServerJobs["build-and-publish"].steps.find(
    (step) => step.name === "Install dependencies",
  );
  assert.equal(step.if, "steps.reuse.outputs.reused != 'true'");
  const root = await mkdtemp(join(tmpdir(), "source-server-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pnpm = join(root, "pnpm");
  const sleep = join(root, "sleep");
  await writeFile(
    pnpm,
    `#!/usr/bin/env bash
set -eu
count=$(cat "$TEST_INSTALL_COUNTER")
count=$((count + 1))
echo "$count" > "$TEST_INSTALL_COUNTER"
case "$TEST_INSTALL_MODE" in
  transient)
    if [ "$count" -gt 1 ]; then test ! -e node_modules/stale-marker; exit 0; fi
    mkdir -p node_modules; echo stale > node_modules/stale-marker
    echo 'ERR_PNPM_ENOENT temporary esbuild rename'; exit 33 ;;
  network)
    if [ "$count" -gt 1 ]; then test ! -e node_modules/stale-marker; exit 0; fi
    mkdir -p node_modules; echo stale > node_modules/stale-marker
    echo 'EAI_AGAIN registry lookup'; exit 34 ;;
  exhausted) echo 'ERR_PNPM_ENOENT temporary esbuild rename'; exit 33 ;;
  config) echo 'ERR_PNPM_OUTDATED_LOCKFILE immutable lock mismatch'; exit 42 ;;
esac
exit 99
`,
  );
  await writeFile(sleep, "#!/usr/bin/env bash\nexit 0\n");
  await chmod(pnpm, 0o755);
  await chmod(sleep, 0o755);
  for (const [mode, status, attempts] of [
    ["transient", 0, 2],
    ["network", 0, 2],
    ["exhausted", 33, 3],
    ["config", 42, 1],
  ]) {
    await t.test(mode, async () => {
      const counter = join(root, "attempts");
      await writeFile(counter, "0\n");
      const result = spawnSync("bash", ["-c", step.run], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH}`,
          TEST_INSTALL_COUNTER: counter,
          TEST_INSTALL_MODE: mode,
        },
      });
      assert.ifError(result.error);
      assert.equal(result.status, status, `${mode}: ${result.stdout}\n${result.stderr}`);
      assert.equal(Number(await readFile(counter, "utf8")), attempts);
      if (status !== 0) {
        assert.match(result.stdout, /::error title=pnpm install failed::/);
        assert.match(result.stdout, mode === "config" ? /OUTDATED_LOCKFILE/ : /esbuild rename/);
      }
    });
  }
});

test("unit test install cleans node_modules after a transient linker failure", async (t) => {
  const step = jobs["unit-tests"].steps.find((step) => step.name === "Install dependencies");
  const root = await mkdtemp(join(tmpdir(), "unit-test-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pnpm = join(root, "pnpm");
  const sleep = join(root, "sleep");
  await writeFile(
    pnpm,
    `#!/usr/bin/env bash
set -eu
count=$(cat "$TEST_INSTALL_COUNTER")
count=$((count + 1))
echo "$count" > "$TEST_INSTALL_COUNTER"
echo "$*" >> "$TEST_INSTALL_ARGS"
if [ "$count" -eq 1 ]; then
  echo 'ERR_PNPM_ENOENT temporary esbuild rename'
  exit 33
fi
`,
  );
  await writeFile(sleep, "#!/usr/bin/env bash\nexit 0\n");
  await chmod(pnpm, 0o755);
  await chmod(sleep, 0o755);
  const counter = join(root, "attempts");
  const args = join(root, "args");
  await writeFile(counter, "0\n");
  await writeFile(args, "");
  const result = spawnSync("bash", ["-c", step.run], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${root}:${process.env.PATH}`,
      TEST_INSTALL_COUNTER: counter,
      TEST_INSTALL_ARGS: args,
    },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const invocations = (await readFile(args, "utf8")).trim().split("\n");
  assert.equal(invocations.length, 2);
  assert.doesNotMatch(invocations[0], /--force/);
  assert.doesNotMatch(invocations[1], /--force/);
});

test("all dependency install retries remove node_modules after the first attempt", () => {
  for (const name of ["verify", "unit-tests", "build-macos", "build-windows"]) {
    const step = jobs[name].steps.find((step) => step.name === "Install dependencies");
    assert.match(step?.run ?? "", /rm -rf node_modules/, name);
    assert.doesNotMatch(step?.run ?? "", /args\+=\(--force\)/, name);
  }
  const sourceServerInstall = sourceServerJobs["build-and-publish"].steps.find(
    (step) => step.name === "Install dependencies",
  );
  assert.match(sourceServerInstall?.run ?? "", /rm -rf node_modules/);
  assert.doesNotMatch(sourceServerInstall?.run ?? "", /args\+=\(--force\)/);
});
