/**
 * WebDAV 客户端：MKCOL / PROPFIND / GET / PUT / DELETE + Basic Auth。
 *
 * 只依赖注入的 fetch（host 侧传入既有网络 transport，从而复用代理与自定义 CA 配置），
 * 不直接使用全局 fetch；PROPFIND 解析与请求构造都是纯逻辑，可被单测与假服务端覆盖。
 * 见 docs/features/local-mode/design.md 第 6.1 节。
 */
import { FORK_WEBDAV_DEFAULT_DIRECTORY, type ForkWebdavBackup } from "@zcode/shared";
import { isBackupKey } from "./backup-archive.js";

/** 最小 fetch 形态：undici 的 fetch 与测试假件都满足。 */
export interface WebdavFetchResponse {
  status: number;
  ok: boolean;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type WebdavFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: Uint8Array;
  },
) => Promise<WebdavFetchResponse>;

export class WebdavRequestError extends Error {
  constructor(
    readonly method: string,
    readonly url: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WebdavRequestError";
  }
}

/**
 * 连接层失败：**没有拿到 HTTP 响应**（TLS 被重置、DNS 失败、代理不可达…）。
 *
 * 与 WebdavRequestError（有状态码，说明服务端答了）分开，因为两者的排查方向完全不同：
 * 前者查网络/代理，后者查地址/凭据/权限。原始原因挂在 `cause` 上，
 * 由 error-message.ts 展开成可读消息。
 */
export class WebdavTransportError extends Error {
  constructor(
    readonly method: string,
    readonly url: string,
    cause: unknown,
  ) {
    super(`WebDAV ${method} ${url} 请求失败：未收到 HTTP 响应`, { cause });
    this.name = "WebdavTransportError";
  }
}

export interface WebdavClientOptions {
  baseUrl: string;
  directory: string;
  username: string;
  password: string;
  fetchImpl: WebdavFetch;
}

export interface WebdavClient {
  ensureDirectory(): Promise<void>;
  testConnection(): Promise<void>;
  listBackups(): Promise<ForkWebdavBackup[]>;
  getObject(key: string): Promise<Buffer>;
  putObject(key: string, body: Buffer): Promise<void>;
  deleteObject(key: string): Promise<void>;
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:"><d:prop>
<d:getcontentlength/><d:getlastmodified/><d:resourcetype/>
</d:prop></d:propfind>`;

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

export interface PropfindEntry {
  href: string;
  size: number;
  lastModified: string | null;
}

/**
 * 解析 PROPFIND 响应：命名空间前缀无关（`d:` / `D:` / 无前缀）。
 * 只提取 href / getcontentlength / getlastmodified，够列表与保留策略使用。
 */
export function parsePropfindEntries(xml: string): PropfindEntry[] {
  const entries: PropfindEntry[] = [];
  const responsePattern =
    /<(?:[A-Za-z0-9_-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?response>/g;
  for (const match of xml.matchAll(responsePattern)) {
    const block = match[1] ?? "";
    const href = /<(?:[A-Za-z0-9_-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?href>/.exec(
      block,
    )?.[1];
    if (!href) {
      continue;
    }
    const sizeText =
      /<(?:[A-Za-z0-9_-]+:)?getcontentlength\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?getcontentlength>/.exec(
        block,
      )?.[1];
    const modifiedText =
      /<(?:[A-Za-z0-9_-]+:)?getlastmodified\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?getlastmodified>/.exec(
        block,
      )?.[1];
    const size = Number.parseInt((sizeText ?? "").trim(), 10);
    entries.push({
      href: decodeXmlEntities(href.trim()),
      size: Number.isFinite(size) ? size : 0,
      lastModified: modifiedText ? decodeXmlEntities(modifiedText.trim()) : null,
    });
  }
  return entries;
}

/** 取 URL 路径最后一段（去查询串），得到备份包文件名；目录 href（以 `/` 结尾）不是对象。 */
export function resolveBackupKeyFromHref(href: string): string {
  const withoutQuery = href.split("?")[0] ?? "";
  if (withoutQuery.endsWith("/")) {
    return "";
  }
  const segments = withoutQuery.split("/").filter(Boolean);
  return decodeURIComponent(segments.at(-1) ?? "");
}

function normalizeDirectory(directory: string): string {
  const trimmed = (directory ?? "").trim() || FORK_WEBDAV_DEFAULT_DIRECTORY;
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

export function createWebdavClient(options: WebdavClientOptions): WebdavClient {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
  const directory = normalizeDirectory(options.directory);
  const authorization = `Basic ${Buffer.from(
    `${options.username}:${options.password}`,
    "utf8",
  ).toString("base64")}`;

  const objectUrl = (key = "") => `${baseUrl}${directory}${key}`;

  async function request(
    method: string,
    url: string,
    body?: Uint8Array,
    extraHeaders: Record<string, string> = {},
  ): Promise<WebdavFetchResponse> {
    const headers: Record<string, string> = {
      authorization,
      ...extraHeaders,
    };
    if (body) {
      headers["content-length"] = String(body.byteLength);
    }
    // 用 try/catch（而不是 .catch()）同时兜住「返回 rejected promise」与「同步抛出」两种情况：
    // 假实现/包装层可能同步抛，.catch() 接不住。
    // undici 在这里抛的是 `TypeError: fetch failed`，真正原因在 cause 上；
    // 补上方法与 URL 后再往上抛，否则调用方只能看到一句没有上下文的 "fetch failed"。
    let response: WebdavFetchResponse;
    try {
      response = await options.fetchImpl(url, { method, headers, body });
    } catch (error) {
      throw new WebdavTransportError(method, url, error);
    }
    if (!response.ok && response.status !== 207) {
      throw new WebdavRequestError(
        method,
        url,
        response.status,
        `WebDAV ${method} ${url} 失败: HTTP ${response.status}`,
      );
    }
    return response;
  }

  return {
    async ensureDirectory() {
      try {
        // 201 = 已创建；405 = 已存在。两者都算成功。
        await request("MKCOL", objectUrl());
      } catch (error) {
        if (error instanceof WebdavRequestError && error.status === 405) {
          return;
        }
        throw error;
      }
    },

    async testConnection() {
      await request("PROPFIND", objectUrl(), undefined, { depth: "0" });
    },

    async listBackups() {
      const response = await request("PROPFIND", objectUrl(), undefined, {
        depth: "1",
        "content-type": 'application/xml; charset="utf-8"',
      });
      const text = await response.text();
      return parsePropfindEntries(text)
        .map((entry) => ({ entry, key: resolveBackupKeyFromHref(entry.href) }))
        .filter(({ key }) => isBackupKey(key))
        .map(({ entry, key }) => ({
          key,
          size: entry.size,
          lastModified: entry.lastModified,
          createdAt: entry.lastModified ?? "",
        }));
    },

    async getObject(key) {
      const response = await request("GET", objectUrl(key));
      return Buffer.from(await response.arrayBuffer());
    },

    async putObject(key, body) {
      await request("PUT", objectUrl(key), body, { "content-type": "application/zip" });
    },

    async deleteObject(key) {
      await request("DELETE", objectUrl(key));
    },
  };
}

/** PROPFIND 请求体（客户端内部使用；导出便于假服务端复用同一份语义）。 */
export const WEBDAV_PROPFIND_BODY = PROPFIND_BODY;
