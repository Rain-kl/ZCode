import type { Fetcher } from "@cloudflare/workers-types";
import {
  isRemoteWebAssetPath,
  isRemoteWebVersion,
  parseRemoteWebManifest,
  REMOTE_WEB_MANIFEST_PATH,
  REMOTE_WEB_VERSION_PREFIX,
  type ForkRemoteRelayEnv,
  type RemoteWebAsset,
  type RemoteWebManifest,
} from "./contract.js";

const currentManifests = new WeakMap<Fetcher, Promise<RemoteWebManifest | null>>();

function failure(request: Request, status: number, message: string) {
  return new Response(request.method === "HEAD" ? null : message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

async function currentManifest(request: Request, assets: Fetcher) {
  let pending = currentManifests.get(assets);
  if (!pending) {
    pending = (async () => {
      const response = await assets.fetch(
        new Request(new URL(REMOTE_WEB_MANIFEST_PATH, request.url)),
      );
      // 只允许明确 404 进入本地旧入口；坏清单不能伪装成缺失后静默选择最新页面。
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok)
        throw new Error(`Current version manifest fetch failed: HTTP ${response.status}`);
      return parseRemoteWebManifest(await response.json());
    })();
    currentManifests.set(assets, pending);
    pending.catch(() => currentManifests.delete(assets));
  }
  return pending;
}

async function checksum(body: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function headers(asset: RemoteWebAsset, entry: boolean) {
  return {
    "content-type": asset.contentType,
    "content-length": String(asset.size),
    "cache-control": entry ? "no-store" : "public, max-age=31536000, immutable",
    etag: `"${asset.sha256}"`,
    "x-content-type-options": "nosniff",
  };
}

/** ASSETS 保留当前发布；R2 清单唯一决定历史版本的完整性，缺失从不回退到最新。 */
export async function serveRemoteWebAssets(
  request: Request,
  env: ForkRemoteRelayEnv,
): Promise<Response> {
  if (!env.ASSETS) return failure(request, 503, "Remote Web assets are unavailable");
  const url = new URL(request.url);
  try {
    const current = await currentManifest(request, env.ASSETS);
    if (!current) {
      const path = url.pathname.replace(/\/+$/, "");
      return env.ASSETS.fetch(
        path === "/remote/v4" ? new Request(new URL("/index.html", url), request) : request,
      );
    }
    const entry = url.pathname.replace(/\/+$/, "") === "/remote/v4";
    const versionPath =
      !entry && url.pathname.startsWith(REMOTE_WEB_VERSION_PREFIX)
        ? url.pathname.slice(REMOTE_WEB_VERSION_PREFIX.length)
        : undefined;
    if (!entry && versionPath === undefined) return env.ASSETS.fetch(request);
    if (request.method !== "GET" && request.method !== "HEAD")
      return failure(request, 405, "Remote Web assets require GET or HEAD");
    const separator = versionPath?.indexOf("/") ?? -1;
    const version = entry
      ? (url.searchParams.get("app_version") ?? current.version)
      : decodeURIComponent(separator >= 0 ? versionPath!.slice(0, separator) : versionPath!);
    const path = entry ? "index.html" : versionPath!.slice(separator + 1);
    if (!isRemoteWebVersion(version) || !isRemoteWebAssetPath(path) || (!entry && separator < 0))
      return failure(request, 400, "Invalid remote Web version or asset path");
    let manifest = current.version === version ? current : undefined;
    if (!manifest && env.REMOTE_WEB_ARCHIVE) {
      const object = await env.REMOTE_WEB_ARCHIVE.get(`versions/${version}/manifest.json`);
      if (object) manifest = parseRemoteWebManifest(JSON.parse(await object.text()));
      if (manifest && manifest.version !== version)
        throw new Error(
          `Archive version manifest mismatch: expected ${version}, received ${manifest.version}`,
        );
    }
    if (!manifest) return failure(request, 404, `Remote Web version unavailable: ${version}`);
    const asset = Object.hasOwn(manifest.files, path) ? manifest.files[path] : undefined;
    if (!asset) return failure(request, 404, `Remote Web asset unavailable: ${version}/${path}`);
    if (manifest === current) {
      const response = await env.ASSETS.fetch(new Request(new URL(`/${path}`, request.url)));
      if (!response.ok)
        throw new Error(
          `Current version asset fetch failed: ${version}/${path}, HTTP ${response.status}`,
        );
      const body = await response.arrayBuffer();
      if (body.byteLength !== asset.size || (await checksum(body)) !== asset.sha256)
        throw new Error(`Current version asset integrity mismatch: ${version}/${path}`);
      return new Response(request.method === "HEAD" ? null : body, {
        headers: headers(asset, entry),
      });
    }
    const object = await env.REMOTE_WEB_ARCHIVE!.get(`blobs/${asset.sha256}`);
    // 发布器的单对象 PUT 带 Content-MD5；R2 实际 ETag 与清单比对，流式发送仍能核实完整性。
    if (!object || object.size !== asset.size || object.etag !== asset.md5) {
      await object?.body.cancel();
      throw new Error(`Archived version asset integrity mismatch: ${version}/${path}`);
    }
    if (request.method === "HEAD") await object.body.cancel();
    return new Response(
      request.method === "HEAD" ? null : (object.body as unknown as ReadableStream),
      {
        headers: headers(asset, entry),
      },
    );
  } catch (error) {
    return failure(
      request,
      503,
      `Remote Web version unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
