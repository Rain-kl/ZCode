import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const installer = resolve("scripts/install-server.sh");

async function fixture(t, { os = "Linux", arch = "x86_64", dev = false, releaseVersion } = {}) {
  const root = await mkdtemp(join(tmpdir(), "zcode server installer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "tools");
  const home = join(root, "home");
  await mkdir(bin);
  await mkdir(home);
  const target = `${os === "Darwin" ? "darwin" : "linux"}-${arch === "aarch64" || arch === "arm64" ? "arm64" : "x64"}`;
  const version = releaseVersion ?? (dev ? "3.18.0-dev.12345678" : "3.18.0");
  const name = `zcode-server-${target}`;
  const bundle = join(root, name);
  await mkdir(join(bundle, "bin"), { recursive: true });
  await mkdir(join(bundle, "runtime"));
  await writeFile(
    join(bundle, "manifest.json"),
    JSON.stringify({ product: "zcode-server", appVersion: version, target }),
  );
  await writeFile(
    join(bundle, "bin/zcode"),
    '#!/bin/sh\nDIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\nexec "$DIR/runtime/node" "$DIR/runtime/server-cli.js" "$@"\n',
  );
  await writeFile(join(bundle, "runtime/node"), '#!/bin/sh\nprintf "%s\\n" "$@"\n');
  await writeFile(join(bundle, "runtime/server-cli.js"), "// fixture\n");
  await chmod(join(bundle, "bin/zcode"), 0o755);
  await chmod(join(bundle, "runtime/node"), 0o755);
  const archive = join(root, `${name}.tar.gz`);
  await exec("tar", ["-czf", archive, "-C", root, name], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  const bytes = await readFile(archive);
  const entry = {
    target,
    version,
    fileName: `${name}.tar.gz`,
    urls: [`${name}.tar.gz`],
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const descriptor = { schemaVersion: 1, version, archives: [entry] };
  const descriptorPath = join(root, "descriptor.json");
  const save = () => writeFile(descriptorPath, JSON.stringify(descriptor));
  await save();
  const latest = join(root, "latest.json");
  await writeFile(
    latest,
    JSON.stringify({ tag_name: `v${version}`, prerelease: false, draft: false }),
  );
  const devIndex = join(root, "dev.yml");
  await writeFile(devIndex, `version: ${version}\nfiles:\n`);
  const base = "https://github.com/Rain-kl/ZCode/releases/download";
  const routes = {
    "https://api.github.com/repos/Rain-kl/ZCode/releases/latest": latest,
    [`${base}/canary-build/dev.yml`]: devIndex,
    [`${base}/server-v${version}/source-server-release.json`]: descriptorPath,
    [`${base}/server-v${version}/${name}.tar.gz`]: archive,
  };
  const log = join(root, "requests.log");
  await writeFile(
    join(bin, "curl"),
    `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);const url=args.find(x=>x.startsWith('https://'));fs.appendFileSync(process.env.REQUEST_LOG,url+'\\n');const file=JSON.parse(process.env.ROUTES)[url];if(!file){console.error('HTTP 404: '+url);process.exit(22)}const out=args.indexOf('--output');fs.copyFileSync(file,args[out+1]);\n`,
  );
  await writeFile(
    join(bin, "uname"),
    `#!/bin/sh\ncase "$1" in -s) echo '${os}';; -m) echo '${arch}';; esac\n`,
  );
  await chmod(join(bin, "curl"), 0o755);
  await chmod(join(bin, "uname"), 0o755);
  const env = {
    ...process.env,
    HOME: home,
    PATH: `${bin}:${process.env.PATH}`,
    ROUTES: JSON.stringify(routes),
    REQUEST_LOG: log,
    ZCODE_SERVER_INSTALL_DIR: join(home, "install root"),
    ZCODE_SERVER_BIN_DIR: join(home, "bin dir"),
  };
  const command = join(env.ZCODE_SERVER_BIN_DIR, "zcode");
  const run = (args = dev ? ["dev"] : []) => exec("sh", [installer, ...args], { env });
  return {
    root,
    home,
    bundle,
    archive,
    entry,
    descriptor,
    save,
    env,
    command,
    run,
    log,
    routes,
    version,
  };
}

for (const [os, arch] of [
  ["Linux", "x86_64"],
  ["Linux", "aarch64"],
  ["Darwin", "x86_64"],
  ["Darwin", "arm64"],
]) {
  test(`installs stable ${os}/${arch} and forwards arguments from a PATH command`, async (t) => {
    const f = await fixture(t, { os, arch });
    const result = await f.run();
    assert.match(result.stdout, /3\.18\.0/);
    const invoked = await exec(f.command, ["server", "connect", "two words"], { env: f.env });
    assert.match(invoked.stdout, /runtime\/server-cli.js\nserver\nconnect\ntwo words\n$/);
    assert.match(await readFile(f.log, "utf8"), /releases\/latest/);
    assert.equal((await lstat(f.command)).isSymbolicLink(), true);
    const before = await readlink(f.command);
    await f.run();
    assert.equal(await readlink(f.command), before);
  });
}

test("dev pins canary's complete version to an immutable Server release", async (t) => {
  const f = await fixture(t, { dev: true });
  await f.run();
  const requests = await readFile(f.log, "utf8");
  assert.match(requests, /canary-build\/dev.yml/);
  assert.match(requests, /server-v3\.18\.0-dev\.12345678\/source-server-release.json/);
  assert.doesNotMatch(requests, /releases\/latest/);
});

test("accepts the documented piped sh -s -- dev invocation", async (t) => {
  const f = await fixture(t, { dev: true });
  const pending = exec("sh", ["-s", "--", "dev"], { env: f.env });
  pending.child.stdin.end(await readFile(installer));
  const result = await pending;
  assert.match(result.stdout, /3\.18\.0-dev\.12345678 installed/);
});

test("upgrading switches the command and retains the previous release", async (t) => {
  const old = await fixture(t);
  await old.run();
  const previous = await readlink(old.command);
  const next = await fixture(t, { releaseVersion: "3.18.1" });
  next.env.ZCODE_SERVER_INSTALL_DIR = old.env.ZCODE_SERVER_INSTALL_DIR;
  next.env.ZCODE_SERVER_BIN_DIR = old.env.ZCODE_SERVER_BIN_DIR;
  await next.run();
  assert.notEqual(await readlink(old.command), previous);
  assert.match(await readFile(previous, "utf8"), /3\.18\.0/);
  assert.match(await readFile(await readlink(old.command), "utf8"), /3\.18\.1/);
});

for (const failure of ["sha", "size", "schema", "version", "manifest", "download", "traversal"]) {
  test(`${failure} failure preserves the installed command`, async (t) => {
    const f = await fixture(t);
    await f.run();
    const before = await readlink(f.command);
    if (failure === "sha") f.entry.sha256 = "0".repeat(64);
    if (failure === "size") f.entry.sizeBytes++;
    if (failure === "schema") f.descriptor.schemaVersion = 2;
    if (failure === "version") f.descriptor.version = "../invalid";
    if (failure === "download") f.env.ROUTES = "{}";
    if (failure === "manifest" || failure === "traversal") {
      if (failure === "manifest")
        await writeFile(join(f.bundle, "manifest.json"), JSON.stringify({ product: "wrong" }));
      if (failure === "traversal") {
        await exec("ln", ["-s", "../../escaped", join(f.bundle, "escape")]);
      }
      await exec("tar", ["-czf", f.archive, "-C", f.root, `zcode-server-${f.entry.target}`], {
        env: { ...process.env, COPYFILE_DISABLE: "1" },
      });
      const bytes = await readFile(f.archive);
      f.entry.sizeBytes = bytes.length;
      f.entry.sha256 = createHash("sha256").update(bytes).digest("hex");
    }
    await f.save();
    await assert.rejects(f.run(), /Error|error|failed|mismatch|Invalid|Unsafe/);
    assert.equal(await readlink(f.command), before);
  });
}

test("does not overwrite an unrelated zcode command", async (t) => {
  const f = await fixture(t);
  await mkdir(f.env.ZCODE_SERVER_BIN_DIR, { recursive: true });
  await writeFile(f.command, "other installation");
  await assert.rejects(f.run(), /Refusing to replace/);
  assert.equal(await readFile(f.command, "utf8"), "other installation");
});

test("unknown arguments and unsupported platforms fail before download", async (t) => {
  const f = await fixture(t, { os: "FreeBSD" });
  await assert.rejects(f.run(["typo"]), /Usage/);
  await assert.rejects(f.run(), /Unsupported/);
  await assert.rejects(readFile(f.log), { code: "ENOENT" });
});

test("missing stable companion reports its URL and does not fall back to dev", async (t) => {
  const f = await fixture(t);
  delete f.routes[
    `https://github.com/Rain-kl/ZCode/releases/download/server-v${f.version}/source-server-release.json`
  ];
  f.env.ROUTES = JSON.stringify(f.routes);
  await assert.rejects(f.run(), /server-v3\.18\.0\/source-server-release.json/);
  assert.doesNotMatch(await readFile(f.log, "utf8"), /canary-build/);
});
