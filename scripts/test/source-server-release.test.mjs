import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  verifySourceServerRelease,
  publishSourceServerRelease,
  reuseSourceServerRelease,
  sourceServerReleaseTag,
} from "../ci/source-server-release.mjs";

const exec = promisify(execFile);
const version = "3.17.162-dev.12345678";
const targets = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"];
async function fixture(t, releaseVersion = version) {
  const root = await mkdtemp(join(tmpdir(), "source-server-ci-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, "assets");
  await mkdir(dir);
  const archives = [];
  for (const target of targets) {
    const name = `zcode-server-${target}`;
    await mkdir(join(root, name));
    await writeFile(
      join(root, name, "manifest.json"),
      JSON.stringify({
        product: "zcode-server",
        appVersion: releaseVersion,
        target,
      }),
    );
    await mkdir(join(root, name, "runtime/provider"), { recursive: true });
    await writeFile(
      join(root, name, "runtime/provider/zcode-builtin.json"),
      '{"fixture":true}\n',
    );
    await exec("tar", ["-czf", join(dir, `${name}.tar.gz`), "-C", root, name]);
    const bytes = await readFile(join(dir, `${name}.tar.gz`));
    archives.push({
      target,
      version: releaseVersion,
      fileName: `${name}.tar.gz`,
      urls: [`${name}.tar.gz`],
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.length,
    });
  }
  const descriptor = { schemaVersion: 1, version: releaseVersion, archives };
  const save = () =>
    writeFile(
      join(dir, "source-server-release.json"),
      JSON.stringify(descriptor),
    );
  await save();
  return { root, dir, descriptor, save };
}

test("verify accepts all four content-verified targets", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await verifySourceServerRelease(f.dir, version)).archives.length,
    4,
  );
});

test("dev uses one mutable release tag while stable keeps a version tag", () => {
  assert.equal(sourceServerReleaseTag(version), "server-canary-build");
  assert.equal(sourceServerReleaseTag("3.17.162"), "server-v3.17.162");
});

for (const failure of [
  "version",
  "target",
  "size",
  "sha",
  "missing",
  "manifest",
  "provider",
]) {
  test(`verify rejects ${failure} before publication`, async (t) => {
    const f = await fixture(t);
    const archive = f.descriptor.archives[0];
    if (failure === "version") f.descriptor.version = "0.0.0";
    if (failure === "target") archive.target = "darwin-arm64";
    if (failure === "size") archive.sizeBytes++;
    if (failure === "sha") archive.sha256 = "0".repeat(64);
    if (failure === "missing") await rm(join(f.dir, archive.fileName));
    if (failure === "manifest" || failure === "provider") {
      if (failure === "provider")
        await rm(
          join(
            f.root,
            "zcode-server-linux-x64/runtime/provider/zcode-builtin.json",
          ),
        );
      else
        await writeFile(
          join(f.root, "zcode-server-linux-x64/manifest.json"),
          JSON.stringify({
            product: "zcode-server",
            appVersion: "0.0.0",
            target: "linux-x64",
          }),
        );
      await exec("tar", [
        "-czf",
        join(f.dir, archive.fileName),
        "-C",
        f.root,
        "zcode-server-linux-x64",
      ]);
      const bytes = await readFile(join(f.dir, archive.fileName));
      archive.sha256 = createHash("sha256").update(bytes).digest("hex");
      archive.sizeBytes = bytes.length;
    }
    await f.save();
    await assert.rejects(verifySourceServerRelease(f.dir, version));
  });
}

test("publishes dev to the fixed canary release and removes historical dev releases", async (t) => {
  const f = await fixture(t);
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    if (args[0] === "api") return JSON.stringify({ draft: false });
    if (args[0] === "release" && args[1] === "list") {
      return "server-v3.17.162-dev.oldold12\nserver-v3.17.162\n";
    }
    return "";
  };
  await publishSourceServerRelease(
    { dir: f.dir, version, repo: "Rain-kl/ZCode", commit: "12345678" },
    run,
  );
  assert.deepEqual(calls[1].slice(0, 4), [
    "release",
    "delete",
    "server-canary-build",
    "--repo",
  ]);
  const create = calls.find((args) => args[1] === "create");
  assert.ok(create.includes("--draft"));
  assert.ok(create.includes("server-canary-build"));
  assert.ok(create.includes("--verify-tag"));
  const moveTag = calls.find(
    (args) =>
      args[0] === "api" &&
      args.includes("repos/Rain-kl/ZCode/git/refs/tags/server-canary-build"),
  );
  assert.ok(moveTag);
  assert.ok(moveTag.includes("sha=12345678"));
  assert.ok(moveTag.includes("force=true"));
  assert.ok(create.includes("--latest=false"));
  assert.equal(calls.filter((args) => args[1] === "upload").length, 2);
  const descriptorUpload = calls.find(
    (args) =>
      args[1] === "upload" &&
      args.some((arg) => arg.endsWith("source-server-release.json")),
  );
  assert.ok(descriptorUpload);
  assert.ok(
    calls.some((args) => args[1] === "edit" && args.includes("--draft=false")),
  );
  assert.ok(
    calls.some(
      (args) =>
        args[1] === "delete" &&
        args.includes("server-v3.17.162-dev.oldold12") &&
        args.includes("--cleanup-tag"),
    ),
  );
});

test("a stable public release is verified without overwriting or moving its tag", async (t) => {
  const stableVersion = "3.17.162";
  const f = await fixture(t, stableVersion);
  const calls = [];
  await publishSourceServerRelease(
    {
      dir: f.dir,
      version: stableVersion,
      repo: "Rain-kl/ZCode",
      commit: "12345678",
    },
    async (args) => {
      calls.push(args);
      if (args[0] === "api") return JSON.stringify({ draft: false });
      if (args[1] === "download")
        await cp(f.dir, args[args.indexOf("--dir") + 1], { recursive: true });
      return "";
    },
  );
  assert.deepEqual(
    calls.map((args) => args[1]),
    ["repos/Rain-kl/ZCode/releases/tags/server-v3.17.162", "download"],
  );
});

test("GitHub authorization failures never fall back to creating a release", async (t) => {
  const f = await fixture(t);
  let count = 0;
  await assert.rejects(
    publishSourceServerRelease(
      { dir: f.dir, version, repo: "Rain-kl/ZCode", commit: "12345678" },
      async () => {
        count++;
        throw new Error("gh: Forbidden (HTTP 403)");
      },
    ),
    /403/,
  );
  assert.equal(count, 1);
});

test("CI rerun reuses an already published archive instead of rebuilding timestamp-dependent tarballs", async (t) => {
  const f = await fixture(t);
  const destination = join(f.root, "reused");
  const calls = [];
  assert.equal(
    await reuseSourceServerRelease(
      { dir: destination, version, repo: "Rain-kl/ZCode" },
      async (args) => {
        calls.push(args);
        if (args[0] === "api") return JSON.stringify({ draft: false });
        await cp(f.dir, destination, { recursive: true });
        return "";
      },
    ),
    true,
  );
  assert.equal(calls.length, 2);
  assert.equal(
    await reuseSourceServerRelease(
      { dir: destination, version, repo: "Rain-kl/ZCode" },
      async () => JSON.stringify({ draft: true }),
    ),
    false,
  );
});

test("a different dev version is not reused from the fixed canary release", async (t) => {
  const old = await fixture(t, "3.17.162-dev.aaaaaaaa");
  const destination = join(old.root, "reused-new-version");
  assert.equal(
    await reuseSourceServerRelease(
      { dir: destination, version, repo: "Rain-kl/ZCode" },
      async (args) => {
        if (args[0] === "api") return JSON.stringify({ draft: false });
        await cp(old.dir, destination, { recursive: true });
        return "";
      },
    ),
    false,
  );
  await assert.rejects(
    readFile(join(destination, "source-server-release.json")),
  );
});

test("an existing public release with different verified content fails closed", async (t) => {
  const stableVersion = "3.17.162";
  const f = await fixture(t, stableVersion);
  const existingDir = join(f.root, "existing");
  await cp(f.dir, existingDir, { recursive: true });
  await writeFile(
    join(f.root, "zcode-server-linux-x64/extra.txt"),
    "different build",
  );
  const archive = f.descriptor.archives[0];
  await exec("tar", [
    "-czf",
    join(f.dir, archive.fileName),
    "-C",
    f.root,
    "zcode-server-linux-x64",
  ]);
  const bytes = await readFile(join(f.dir, archive.fileName));
  archive.sha256 = createHash("sha256").update(bytes).digest("hex");
  archive.sizeBytes = bytes.length;
  await f.save();
  await assert.rejects(
    publishSourceServerRelease(
      {
        dir: f.dir,
        version: stableVersion,
        repo: "Rain-kl/ZCode",
        commit: "12345678",
      },
      async (args) => {
        if (args[0] === "api") return JSON.stringify({ draft: false });
        assert.equal(args[1], "download");
        await cp(existingDir, args[args.indexOf("--dir") + 1], {
          recursive: true,
        });
        return "";
      },
    ),
    /Refusing to replace published/,
  );
});

test("Source Server has an independent workflow and cleanup preserves only current channel tags", async () => {
  const desktopWorkflow = await readFile(
    new URL("../../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const serverWorkflow = await readFile(
    new URL(
      "../../.github/workflows/source-server-release.yml",
      import.meta.url,
    ),
    "utf8",
  );
  const cleanup = await readFile(
    new URL(
      "../../.github/workflows/cleanup-prerelease-tags.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(
    desktopWorkflow,
    /build-source-server:|source-server-release\.mjs publish/,
  );
  assert.match(serverWorkflow, /source-server-release\.mjs publish/);
  assert.match(serverWorkflow, /group: source-server-release-/);
  assert.match(desktopWorkflow, /group: desktop-release-/);
  assert.match(desktopWorkflow, /git\/refs\/tags\/\$\{pointer_tag\}/);
  assert.match(cleanup, /server-canary-build/);
  const guard = cleanup.match(/is_dev_channel_tag\(\) \{[^}]+\}/u);
  assert.ok(guard, "cleanup retention guard is required");
  await exec("bash", [
    "-c",
    `${guard[0]}\nis_dev_channel_tag canary-build && is_dev_channel_tag server-canary-build && is_dev_channel_tag server-v3.17.162 && ! is_dev_channel_tag server-v3.17.162-dev.12345678 && ! is_dev_channel_tag dev-old && ! is_dev_channel_tag v0.1.0-beta`,
  ]);
});
