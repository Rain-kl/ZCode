import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { serveRemoteWebAssets } from "../src/webAssets.js";
import { parseRemoteWebManifest, type ForkRemoteRelayEnv } from "../src/contract.js";

const current = "3.17.162-dev.12345678";
const old = "3.17.162-dev.abcdef01";
function asset(body: string, contentType: string) {
  return {
    size: Buffer.byteLength(body),
    contentType,
    sha256: createHash("sha256").update(body).digest("hex"),
    md5: createHash("md5").update(body).digest("hex"),
  };
}
const currentHtml =
  "<!doctype html><script src='/remote/v4/3.17.162-dev.12345678/assets/main.js'></script>";
const oldHtml = "<!doctype html><title>old-version-marker</title>";
const js = "console.info('current')";
const manifest = (version: string, html: string) =>
  parseRemoteWebManifest({
    schemaVersion: 1,
    version,
    files: {
      "index.html": asset(html, "text/html; charset=utf-8"),
      "assets/main.js": asset(js, "text/javascript; charset=utf-8"),
    },
  });

function environment() {
  const previous = manifest(old, oldHtml);
  return {
    ASSETS: {
      async fetch(request: Request) {
        const path = new URL(request.url).pathname;
        if (path === "/fork-remote-web-manifest.json")
          return Response.json(manifest(current, currentHtml));
        if (path === "/index.html") return new Response(currentHtml);
        if (path === "/assets/main.js") return new Response(js);
        return new Response("<!doctype html>fallback must never escape", {
          headers: { "content-type": "text/html" },
        });
      },
    },
    REMOTE_WEB_ARCHIVE: {
      async get(key: string) {
        const text =
          key === `versions/${old}/manifest.json`
            ? JSON.stringify(previous)
            : key === `blobs/${previous.files["index.html"].sha256}`
              ? oldHtml
              : key === `blobs/${previous.files["assets/main.js"].sha256}`
                ? js
                : undefined;
        if (!text) return null;
        return {
          size: Buffer.byteLength(text),
          etag: createHash("md5").update(text).digest("hex"),
          async arrayBuffer() {
            return Buffer.from(text);
          },
          async text() {
            return text;
          },
          body: new Response(text).body,
        };
      },
    },
  } as unknown as ForkRemoteRelayEnv;
}

test("local assets without a version manifest retain the remote SPA entry", async () => {
  const env = {
    ASSETS: {
      async fetch(request: Request) {
        return new URL(request.url).pathname === "/index.html"
          ? new Response("local-spa")
          : new Response(null, { status: 404 });
      },
    },
  } as unknown as ForkRemoteRelayEnv;
  const response = await serveRemoteWebAssets(new Request("https://relay.test/remote/v4"), env);
  assert.equal(await response.text(), "local-spa");
});

test("exact current and archived versions resolve independently, including resources and HEAD", async () => {
  const env = environment();
  const request = (path: string, method = "GET") =>
    serveRemoteWebAssets(new Request(`https://relay.test${path}`, { method }), env);
  assert.equal(await (await request("/remote/v4")).text(), currentHtml);
  const previous = await request(`/remote/v4?app_version=${old}`);
  assert.equal(await previous.text(), oldHtml);
  const resource = await request(`/remote/v4/${old}/assets/main.js`);
  assert.equal(await resource.text(), js);
  assert.match(resource.headers.get("content-type") ?? "", /^text\/javascript/);
  assert.match(resource.headers.get("cache-control") ?? "", /immutable/);
  const head = await request(`/remote/v4/${old}/assets/main.js`, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(head.headers.get("content-length"), String(Buffer.byteLength(js)));
});

test("missing versions and missing resources fail explicitly without SPA fallback", async () => {
  const env = environment();
  const missing = await serveRemoteWebAssets(
    new Request("https://relay.test/remote/v4?app_version=3.0.0"),
    env,
  );
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /version.*unavailable/i);
  const absent = await serveRemoteWebAssets(
    new Request(`https://relay.test/remote/v4/${current}/assets/missing.js`),
    env,
  );
  assert.equal(absent.status, 404);
  assert.doesNotMatch(await absent.text(), /fallback/);
  const invalid = await serveRemoteWebAssets(
    new Request("https://relay.test/remote/v4?app_version=../bad"),
    env,
  );
  assert.equal(invalid.status, 400);
});

test("corrupt manifests and file contents fail closed", async () => {
  assert.throws(
    () => parseRemoteWebManifest({ ...manifest(current, currentHtml), version: current + "\n" }),
    /manifest/i,
  );
  const env = environment();
  env.ASSETS = {
    async fetch() {
      return Response.json({ schemaVersion: 1, version: current, files: {} });
    },
  } as never;
  assert.equal(
    (await serveRemoteWebAssets(new Request("https://relay.test/remote/v4"), env)).status,
    503,
  );
  const corrupt = environment();
  const fetch = corrupt.ASSETS!.fetch.bind(corrupt.ASSETS);
  corrupt.ASSETS = {
    async fetch(request: Request) {
      return new URL(request.url).pathname === "/index.html"
        ? new Response("corrupt HTML")
        : fetch(request);
    },
  } as never;
  assert.equal(
    (await serveRemoteWebAssets(new Request("https://relay.test/remote/v4"), corrupt)).status,
    503,
  );
  assert.throws(
    () =>
      parseRemoteWebManifest({
        ...manifest(current, currentHtml),
        files: { "../index.html": asset("bad", "text/html; charset=utf-8") },
      }),
    /manifest/i,
  );
});
