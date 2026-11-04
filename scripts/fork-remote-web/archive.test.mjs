import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRemoteWebManifest, publishRemoteWebArchive } from "./archive.mjs";
import { createArchiveStorage, resolveCloudflareWebBuild } from "./build.mjs";
import { resolveRemoteFrontendVersion } from "../../packages/web/vite/remoteFrontendVersion.mjs";

test("Cloudflare uses the Server release's exact commit version without changing local builds", () => {
  assert.equal(resolveCloudflareWebBuild("3.17.162", {}), undefined);
  const plan = resolveCloudflareWebBuild("3.17.162", {
    WORKERS_CI: "1",
    WORKERS_CI_COMMIT_SHA: "abcdef0123456789abcdef0123456789abcdef01",
  });
  assert.equal(plan.version, "3.17.162-dev.abcdef01");
  assert.equal(plan.base, "/remote/v4/3.17.162-dev.abcdef01/");
  assert.equal(plan.route, "/remote/v4");
  assert.throws(() => resolveCloudflareWebBuild("3.17.162", { WORKERS_CI: "1" }), /commit/i);
  assert.equal(
    resolveCloudflareWebBuild("3.17.162", {
      WORKERS_CI_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
    }).version,
    "3.17.162-dev.01234567",
  );
  assert.equal(resolveRemoteFrontendVersion("3.17.162-dev.01234567"), "3.17.162-dev.01234567");
  assert.throws(() => resolveRemoteFrontendVersion("3.17.162-beta.01234567"), /version/i);
});

test("archive credentials fail before build; S3 uploads sign immutable conditions and body integrity", async () => {
  await assert.rejects(createArchiveStorage({}), /REMOTE_WEB_ARCHIVE_BUCKET/);
  const config = {
    REMOTE_WEB_ARCHIVE_BUCKET: "test-web-archive",
    CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  };
  await assert.rejects(createArchiveStorage(config), /R2_ACCESS_KEY_ID/);
  const calls = [];
  const storage = await createArchiveStorage(
    { ...config, R2_ACCESS_KEY_ID: "test-access-key", R2_SECRET_ACCESS_KEY: "test-only-secret" },
    async (request) => {
      calls.push(request);
      return new Response(null, { status: request.method === "PUT" ? 200 : 404 });
    },
  );
  const body = Buffer.from("archive object");
  assert.equal(
    await storage.create("blobs/test-hash", body, { contentType: "text/plain; charset=utf-8" }),
    true,
  );
  assert.equal(calls[0].headers.get("if-none-match"), "*");
  assert.equal(
    calls[0].headers.get("content-md5"),
    createHash("md5").update(body).digest("base64"),
  );
  assert.match(calls[0].headers.get("authorization"), /^AWS4-HMAC-SHA256 /);
  assert.equal(await calls[0].text(), body.toString());
  assert.equal(await storage.get("missing"), undefined);
});

test("archive deduplicates blobs, publishes manifest last and refuses changed release contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-web-archive-"));
  try {
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "index.html"), "<!doctype html><title>version-one</title>");
    await writeFile(join(root, "assets/main.js"), "console.info('one')");
    await writeFile(join(root, "assets/main.js.map"), "private source map");
    const manifest = await createRemoteWebManifest(root, "3.17.162-dev.abcdef01");
    assert.deepEqual(Object.keys(manifest.files), ["assets/main.js", "index.html"]);
    const index = manifest.files["index.html"];
    assert.equal(
      index.sha256,
      createHash("sha256")
        .update(await readFile(join(root, "index.html")))
        .digest("hex"),
    );
    const objects = new Map();
    const writes = [];
    const storage = {
      async get(key) {
        return objects.get(key);
      },
      async create(key, body) {
        if (objects.has(key)) return false;
        objects.set(key, Buffer.from(body));
        writes.push(key);
        return true;
      },
    };
    await publishRemoteWebArchive({ directory: root, manifest, storage, concurrency: 2 });
    assert.equal(writes.at(-1), `versions/${manifest.version}/manifest.json`);
    assert.equal(writes.length, 3);
    await publishRemoteWebArchive({ directory: root, manifest, storage, concurrency: 2 });
    assert.equal(writes.length, 3);
    const second = { ...manifest, version: "3.17.162-dev.12345678" };
    await publishRemoteWebArchive({ directory: root, manifest: second, storage, concurrency: 2 });
    assert.equal(writes.length, 4, "identical files share content-addressed objects");
    await writeFile(join(root, "assets/main.js"), "console.info('changed')");
    const changed = await createRemoteWebManifest(root, manifest.version);
    await assert.rejects(
      publishRemoteWebArchive({ directory: root, manifest: changed, storage }),
      /already.*different|immutable/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("changed local files and corrupt existing blobs cannot publish a complete version", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-web-integrity-"));
  try {
    await writeFile(join(root, "index.html"), "original html");
    const manifest = await createRemoteWebManifest(root, "3.17.162-dev.abcdef01");
    let published = false;
    const storage = {
      async get() {
        return undefined;
      },
      async create(key) {
        published ||= key.startsWith("versions/");
        return true;
      },
    };
    await writeFile(join(root, "index.html"), "changed html");
    await assert.rejects(
      publishRemoteWebArchive({ directory: root, manifest, storage }),
      /integrity|checksum/i,
    );
    assert.equal(published, false);
    await writeFile(join(root, "index.html"), "original html");
    const corrupt = {
      async get(key) {
        return key.startsWith("blobs/") ? Buffer.from("corrupt") : undefined;
      },
      async create() {
        return false;
      },
    };
    await assert.rejects(
      publishRemoteWebArchive({ directory: root, manifest, storage: corrupt }),
      /integrity|checksum/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
