import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";
import {
  WebdavRequestError,
  createWebdavClient,
  parsePropfindEntries,
  resolveBackupKeyFromHref,
  type WebdavFetch,
} from "../src/host/fork/webdav/webdav-client.js";
import { buildBackupZip } from "../src/host/fork/webdav/backup-archive.js";

/** 快照条目是文本：这里造与 production 清单层一致的 JSON 文本。 */
function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

test("PROPFIND 解析：命名空间前缀无关、忽略目录项、URL 解码", () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/zcode/</D:href>
    <D:propstat><D:prop><D:getlastmodified>Mon, 28 Sep 2026 06:30:05 GMT</D:getlastmodified></D:prop></D:propstat>
  </D:response>
  <D:response>
    <D:href>/zcode/zcode-20260928-143005.zip</D:href>
    <D:propstat><D:prop>
      <D:getcontentlength>2048</D:getcontentlength>
      <D:getlastmodified>Mon, 28 Sep 2026 06:30:05 GMT</D:getlastmodified>
    </D:prop></D:propstat>
  </D:response>
  <response>
    <href>/zcode/%E5%A4%87%E4%BB%BD%20a.zip</href>
    <propstat><prop><getcontentlength>not-a-number</getcontentlength></prop></propstat>
  </response>
</D:multistatus>`;

  const entries = parsePropfindEntries(xml);
  assert.equal(entries.length, 3);
  assert.equal(entries[1]?.size, 2048);
  assert.equal(entries[1]?.lastModified, "Mon, 28 Sep 2026 06:30:05 GMT");
  assert.equal(resolveBackupKeyFromHref(entries[1]!.href), "zcode-20260928-143005.zip");
  assert.equal(resolveBackupKeyFromHref("/zcode/"), "");
  assert.equal(resolveBackupKeyFromHref("/zcode/a%20b.zip?x=1"), "a b.zip");
  assert.equal(entries[2]?.size, 0);
});

interface FakeServerState {
  files: Map<string, Buffer>;
  directoryExists: boolean;
  requireAuth?: string;
}

async function startFakeWebdav(state: FakeServerState): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
  requests: string[];
}> {
  const requests: string[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const method = request.method ?? "GET";
    const url = request.url ?? "/";
    requests.push(`${method} ${url}`);
    if (state.requireAuth && request.headers.authorization !== state.requireAuth) {
      response.writeHead(401).end("unauthorized");
      return;
    }
    const key = decodeURIComponent(url.replace(/^\/+/, ""));

    if (method === "MKCOL") {
      if (state.directoryExists) {
        response.writeHead(405).end();
        return;
      }
      state.directoryExists = true;
      response.writeHead(201).end();
      return;
    }
    if (!state.directoryExists) {
      response.writeHead(404).end();
      return;
    }
    if (method === "PROPFIND") {
      const items = [...state.files.entries()]
        .map(
          ([name, body]) =>
            `<D:response><D:href>/zcode/${name}</D:href><D:propstat><D:prop>` +
            `<D:getcontentlength>${body.byteLength}</D:getcontentlength>` +
            `<D:getlastmodified>Mon, 28 Sep 2026 06:30:05 GMT</D:getlastmodified>` +
            `</D:prop></D:propstat></D:response>`,
        )
        .join("");
      response
        .writeHead(207, { "content-type": "application/xml" })
        .end(
          `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response>` +
            `<D:href>/zcode/</D:href></D:response>${items}</D:multistatus>`,
        );
      return;
    }
    if (method === "PUT") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        state.files.set(key, Buffer.concat(chunks));
        response.writeHead(201).end();
      });
      return;
    }
    if (method === "GET") {
      const body = state.files.get(key);
      if (!body) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/zip" }).end(body);
      return;
    }
    if (method === "DELETE") {
      if (!state.files.delete(key)) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(204).end();
      return;
    }
    response.writeHead(405).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("假服务端启动失败");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
    requests,
  };
}

function createNodeFetch(): WebdavFetch {
  return async (url, init) => {
    const response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body ? Buffer.from(init.body) : undefined,
    });
    return {
      status: response.status,
      ok: response.ok,
      text: () => response.text(),
      arrayBuffer: () => response.arrayBuffer(),
    };
  };
}

test("客户端对一个假 WebDAV 服务完成目录创建、上传、列表、下载、删除", async () => {
  const state: FakeServerState = { files: new Map(), directoryExists: false };
  const server = await startFakeWebdav(state);
  const client = createWebdavClient({
    baseUrl: server.baseUrl,
    directory: "/zcode/",
    username: "user",
    password: "pass",
    fetchImpl: createNodeFetch(),
  });

  try {
    await client.ensureDirectory();
    // 重复创建目录不应报错（服务端回 405）。
    await client.ensureDirectory();
    assert.equal(state.directoryExists, true);

    const archive = await buildBackupZip({
      manifest: {
        schemaVersion: 1,
        createdAt: "2026-09-28T06:30:05.000Z",
        appVersion: "3.14.3",
        contentHash: "hash-1",
        source: "test-machine",
      },
      files: {
        "setting.json": jsonText({ locale: "zh-CN" }),
        "provider_config.json": jsonText({}),
      },
    });
    await client.putObject("zcode-20260928-143005.zip", archive);
    // 同目录的非备份对象不应出现在列表里。
    await client.putObject("notes.txt", Buffer.from("hello"));

    const backups = await client.listBackups();
    assert.deepEqual(
      backups.map((backup) => backup.key),
      ["zcode-20260928-143005.zip"],
    );
    assert.equal(backups[0]?.size, archive.byteLength);

    const downloaded = await client.getObject("zcode-20260928-143005.zip");
    assert.deepEqual(downloaded, archive);

    await client.deleteObject("zcode-20260928-143005.zip");
    assert.deepEqual(await client.listBackups(), []);
  } finally {
    await server.close();
  }
});

test("鉴权失败与缺对象分别抛 WebdavRequestError", async () => {
  const state: FakeServerState = {
    files: new Map(),
    directoryExists: true,
    requireAuth: "Basic dXNlcjpwYXNz",
  };
  const server = await startFakeWebdav(state);
  const unauthorized = createWebdavClient({
    baseUrl: server.baseUrl,
    directory: "/zcode/",
    username: "user",
    password: "wrong",
    fetchImpl: createNodeFetch(),
  });
  const authorized = createWebdavClient({
    baseUrl: server.baseUrl,
    directory: "/zcode/",
    username: "user",
    password: "pass",
    fetchImpl: createNodeFetch(),
  });

  try {
    await assert.rejects(
      () => unauthorized.testConnection(),
      (error: unknown) => error instanceof WebdavRequestError && error.status === 401,
    );
    await authorized.testConnection();
    await assert.rejects(
      () => authorized.getObject("zcode-20260928-143005.zip"),
      (error: unknown) => error instanceof WebdavRequestError && error.status === 404,
    );
  } finally {
    await server.close();
  }
});
