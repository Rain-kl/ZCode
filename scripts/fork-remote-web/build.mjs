import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRemoteFrontendVersion } from "../../packages/web/vite/remoteFrontendVersion.mjs";
import { createRemoteWebManifest, publishRemoteWebArchive } from "./archive.mjs";

export function resolveCloudflareWebBuild(packageVersion, env) {
  if (!env.WORKERS_CI && !env.WORKERS_CI_COMMIT_SHA) return undefined;
  const commit = env.WORKERS_CI_COMMIT_SHA;
  if (!/^[a-f0-9]{40}$/i.test(commit ?? ""))
    throw new Error("Cloudflare Web build requires WORKERS_CI_COMMIT_SHA with the full commit SHA");
  // 与 release-version.mjs 的 dev 通道完全一致：基底 x.y.z + 前八位提交。
  const version = resolveRemoteFrontendVersion(
    `${packageVersion.split("-")[0]}-dev.${commit.slice(0, 8).toLowerCase()}`,
  );
  return { version, base: `/remote/v4/${encodeURIComponent(version)}/`, route: "/remote/v4" };
}

export async function runWebBuild(webRoot, env = process.env, arguments_ = []) {
  const { version } = JSON.parse(await readFile(resolve(webRoot, "../../package.json"), "utf8"));
  const plan = resolveCloudflareWebBuild(version, env);
  // 在编译前检查归档配置，不能把可运行的最新页面误当成已保留的旧版支持。
  const storage = plan ? await createArchiveStorage(env) : undefined;
  await new Promise((done, reject) => {
    const child = spawn(
      process.execPath,
      [
        resolve(webRoot, "../../node_modules/vite/bin/vite.js"),
        "build",
        ...arguments_,
        ...(plan ? ["--base", plan.base] : []),
      ],
      {
        cwd: webRoot,
        stdio: "inherit",
        env: {
          ...env,
          ...(plan
            ? {
                WEB_REMOTE_FRONTEND_VERSION: plan.version,
                VITE_WEB_REMOTE_CONTROL_ROUTE_PATH: plan.route,
                ZCODE_COMMIT: env.WORKERS_CI_COMMIT_SHA,
              }
            : {}),
        },
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0 ? done() : reject(new Error(`Web build failed: code=${code}, signal=${signal}`)),
    );
  });
  if (!plan) return;
  const directory = resolve(webRoot, "dist");
  const manifest = await createRemoteWebManifest(directory, plan.version);
  await publishRemoteWebArchive({ directory, manifest, storage });
  await writeFile(resolve(directory, "fork-remote-web-manifest.json"), JSON.stringify(manifest));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runWebBuild(
    fileURLToPath(new URL("../../packages/web", import.meta.url)),
    process.env,
    process.argv.slice(2),
  );
}

export async function createArchiveStorage(env, fetcher = fetch) {
  if (!env.REMOTE_WEB_ARCHIVE_BUCKET || !env.CLOUDFLARE_ACCOUNT_ID)
    throw new Error(
      "Cloudflare Web archive requires build variables REMOTE_WEB_ARCHIVE_BUCKET and CLOUDFLARE_ACCOUNT_ID",
    );
  let accessKeyId = env.R2_ACCESS_KEY_ID;
  let secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  if (!accessKeyId && !secretAccessKey && env.CLOUDFLARE_API_TOKEN) {
    const response = await fetcher("https://api.cloudflare.com/client/v4/user/tokens/verify", {
      headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json();
    if (
      !response.ok ||
      result.success !== true ||
      result.result?.status !== "active" ||
      typeof result.result.id !== "string"
    )
      throw new Error(
        `Cloudflare Web archive user token verification failed: HTTP ${response.status}`,
      );
    accessKeyId = result.result.id;
    secretAccessKey = createHash("sha256").update(env.CLOUDFLARE_API_TOKEN).digest("hex");
  }
  if (!accessKeyId || !secretAccessKey)
    throw new Error(
      "Cloudflare Web archive requires build secrets R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY, or an R2-enabled user CLOUDFLARE_API_TOKEN",
    );
  const { AwsClient } = await import("aws4fetch");
  const client = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: "s3",
    region: "auto",
    retries: 3,
  });
  const base = `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/${encodeURIComponent(env.REMOTE_WEB_ARCHIVE_BUCKET)}/`;
  const request = async (key, init = {}) => {
    const url = base + key.split("/").map(encodeURIComponent).join("/");
    const response = await fetcher(
      await client.sign(url, { ...init, redirect: "error", signal: AbortSignal.timeout(60_000) }),
    );
    if (![200, 201, 204, 404, 412].includes(response.status)) {
      await response.body?.cancel();
      throw new Error(
        `R2 Web archive ${init.method ?? "GET"} ${key} failed: HTTP ${response.status}`,
      );
    }
    return response;
  };
  return {
    async get(key) {
      const response = await request(key);
      if (response.status === 404) {
        await response.body?.cancel();
        return undefined;
      }
      if (!response.ok)
        throw new Error(`R2 Web archive GET ${key} failed: HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    },
    async create(key, body, metadata = {}) {
      const response = await request(key, {
        method: "PUT",
        body,
        headers: {
          "if-none-match": "*",
          "content-type": metadata.contentType ?? "application/octet-stream",
          "content-md5": createHash("md5").update(body).digest("base64"),
        },
      });
      await response.body?.cancel();
      if (response.status === 412) return false;
      if (!response.ok)
        throw new Error(`R2 Web archive PUT ${key} failed: HTTP ${response.status}`);
      return true;
    },
  };
}
