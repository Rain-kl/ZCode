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
const builds = ["build-macos", "build-windows", "build-android"];
const checks = ["verify", "unit-tests", "android-tests"];
const gates = ["resolve", ...checks, ...builds];

test("builds and all tests start after resolve on both channels", () => {
  for (const name of [...checks, ...builds]) {
    assert.deepEqual(jobs[name].needs, ["resolve"], name);
    assert.doesNotMatch(jobs[name].if ?? "", /prerelease/u, name);
    assert.ok(!jobs[name]["continue-on-error"], name);
  }
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
});

function permits(job, results, cancelled = false) {
  const expression = job.if
    .replace(/^\$\{\{\s*|\s*\}\}$/g, "")
    .replace(/cancelled\(\)/g, JSON.stringify(cancelled))
    .replace(/needs\.resolve\.outputs\.prerelease/g, JSON.stringify(results.prerelease))
    .replace(/needs\.([\w-]+)\.result/g, (_, gate) => JSON.stringify(results[gate]));
  return Function(`"use strict"; return (${expression});`)();
}

test("canary publication waits only for builds and keeps failed tests visible", () => {
  const job = jobs["publish-canary"];
  assert.ok(job);
  assert.deepEqual(job.needs, ["resolve", ...builds]);
  const success = { ...Object.fromEntries(gates.map((gate) => [gate, "success"])), prerelease: "true" };
  assert.equal(permits(job, success), true);
  assert.equal(permits(job, success, true), false);
  assert.equal(permits(job, { ...success, prerelease: "false" }), false);
  for (const gate of checks) {
    for (const result of ["failure", "cancelled", "in_progress"]) {
      assert.equal(permits(job, { ...success, [gate]: result }), true, `${gate}: ${result}`);
    }
  }
  for (const gate of ["resolve", ...builds]) {
    for (const result of ["failure", "skipped", "cancelled"]) {
      assert.equal(permits(job, { ...success, [gate]: result }), false, `${gate}: ${result}`);
    }
  }
  assert.deepEqual(jobs["test-summary"].needs, checks);
  assert.equal(jobs["test-summary"].if, "${{ always() }}");
});

test("stable publication requires every build and test and shares the publisher", () => {
  assert.deepEqual(jobs.publish.needs, gates);
  assert.equal(jobs.publish.uses, jobs["publish-canary"].uses);
  const success = { ...Object.fromEntries(gates.map((gate) => [gate, "success"])), prerelease: "false" };
  assert.equal(permits(jobs.publish, success), true);
  assert.equal(permits(jobs.publish, success, true), false);
  assert.equal(permits(jobs.publish, { ...success, prerelease: "true" }), false);
  for (const gate of gates) {
    for (const result of ["failure", "skipped", "cancelled"]) {
      assert.equal(permits(jobs.publish, { ...success, [gate]: result }), false, `${gate}: ${result}`);
    }
  }
});

test("both channels pass the same version and commit to the reusable publisher", async () => {
  const publisher = parse(await readFile(new URL("../../.github/workflows/publish-release.yml", import.meta.url), "utf8"));
  const inputs = publisher.on.workflow_call.inputs;
  for (const name of ["publish", "publish-canary"]) {
    assert.equal(jobs[name].uses, "./.github/workflows/publish-release.yml");
    for (const input of ["version", "release_tag", "prerelease", "commit"]) {
      assert.deepEqual(inputs[input], { required: true, type: "string" });
      assert.equal(jobs[name].with[input], `\${{ needs.resolve.outputs.${input} }}`);
    }
  }
});

test("test summary records success and failure without hiding a failed check", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-test-summary-"));
  try {
    const step = jobs["test-summary"].steps.find((item) => item.name === "Summarize checks");
    for (const result of ["success", "failure", "cancelled"]) {
      const summary = join(dir, `${result}.md`);
      const results = Object.fromEntries(checks.map((name) => [name, { result: "success" }]));
      results["unit-tests"].result = result;
      const output = spawnSync("bash", ["-e", "-c", step.run], {
        env: { ...process.env, CHECK_RESULTS: JSON.stringify(results), GITHUB_STEP_SUMMARY: summary },
        encoding: "utf8",
      });
      assert.equal(output.status, result === "success" ? 0 : 1, output.stderr);
      assert.ok((await readFile(summary, "utf8")).includes(`| unit-tests | ${result} |`));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
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

test("release installs use a pinned supported toolchain and workspace-owned patches", async () => {
  const root = new URL("../../", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const workspace = parse(await readFile(new URL("pnpm-workspace.yaml", root), "utf8"));
  const nodeVersion = (await readFile(new URL(".nvmrc", root), "utf8")).trim();
  assert.equal(manifest.packageManager, "pnpm@11.28.9");
  const cliManifest = JSON.parse(
    await readFile(new URL("apps/zcode-cli/package.json", root), "utf8"),
  );
  assert.equal(cliManifest.packageManager, manifest.packageManager);
  assert.equal(nodeVersion, cliManifest.engines.node);
  assert.equal(workspace.nodeLinker, "hoisted");
  assert.equal(workspace.verifyDepsBeforeRun, false);
  assert.equal(workspace.allowBuilds.sharp, true);
  assert.equal(workspace.allowBuilds.workerd, true);
  const cliWorkspace = parse(
    await readFile(new URL("apps/zcode-cli/pnpm-workspace.yaml", root), "utf8"),
  );
  assert.equal(cliWorkspace.verifyDepsBeforeRun, false);
  assert.equal(cliWorkspace.nodeLinker, "hoisted");
  assert.equal(
    workspace.patchedDependencies["wdio-electron-service@9.2.1"],
    "patches/wdio-electron-service@9.2.1.patch",
  );
  assert.equal(workspace.overrides.react, "19.2.7");
});
