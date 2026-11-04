import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseRemoteWebManifest } from "../../packages/fork-remote-relay/src/contract.ts";

const mime = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  ico: "image/x-icon",
  webp: "image/webp",
  avif: "image/avif",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  wasm: "application/wasm",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  bcmap: "application/octet-stream",
};
const digest = (body, algorithm) => createHash(algorithm).update(body).digest("hex");
const canonical = (manifest) => JSON.stringify(parseRemoteWebManifest(manifest));

export async function createRemoteWebManifest(directory, version) {
  const files = Object.create(null);
  async function walk(prefix = "") {
    for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path);
      else if (
        entry.isFile() &&
        !path.endsWith(".map") &&
        path !== "fork-remote-web-manifest.json"
      ) {
        const body = await readFile(join(directory, path));
        files[path] = {
          size: body.length,
          sha256: digest(body, "sha256"),
          md5: digest(body, "md5"),
          contentType: mime[path.split(".").at(-1)] ?? "application/octet-stream",
        };
      } else if (!entry.isFile()) throw new Error(`Unsupported Web asset entry: ${path}`);
    }
  }
  await walk();
  return parseRemoteWebManifest({ schemaVersion: 1, version, files });
}

function verify(body, asset, path) {
  if (
    !body ||
    body.length !== asset.size ||
    digest(body, "sha256") !== asset.sha256 ||
    digest(body, "md5") !== asset.md5
  )
    throw new Error(`Remote Web asset integrity mismatch: ${path}`);
}

/** R2 是归档唯一所有者；清单最后 create-once 发布，失败上传不会产生可用版本。 */
export async function publishRemoteWebArchive({
  directory,
  manifest: input,
  storage,
  concurrency = 8,
}) {
  const manifest = parseRemoteWebManifest(input);
  const manifestKey = `versions/${manifest.version}/manifest.json`;
  const expected = canonical(manifest);
  const existing = await storage.get(manifestKey);
  if (existing) {
    if (canonical(JSON.parse(existing.toString("utf8"))) !== expected)
      throw new Error(
        `Immutable Web release already exists with different contents: ${manifest.version}`,
      );
  }
  const entries = Object.entries(manifest.files);
  let cursor = 0;
  let failed;
  await Promise.all(
    Array.from(
      { length: Math.min(entries.length, Math.max(1, Math.min(16, concurrency))) },
      async () => {
        while (!failed && cursor < entries.length) {
          const [path, asset] = entries[cursor++];
          try {
            const body = await readFile(join(directory, path));
            verify(body, asset, path);
            const key = `blobs/${asset.sha256}`;
            const previous = await storage.get(key);
            if (previous) verify(previous, asset, key);
            else if (!(await storage.create(key, body, asset)))
              verify(await storage.get(key), asset, key);
          } catch (error) {
            failed = error;
          }
        }
      },
    ),
  );
  if (failed) throw failed;
  if (
    !existing &&
    !(await storage.create(manifestKey, Buffer.from(expected), { contentType: "application/json" }))
  ) {
    const winner = await storage.get(manifestKey);
    if (!winner || canonical(JSON.parse(winner.toString("utf8"))) !== expected)
      throw new Error(`Immutable Web release publication conflict: ${manifest.version}`);
  }
}
