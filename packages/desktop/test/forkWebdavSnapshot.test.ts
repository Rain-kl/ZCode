import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildBackupZip, readBackupZip } from "../src/host/fork/webdav/backup-archive.js";
import {
  createDefaultForkWebdavState,
  readForkWebdavState,
  writeForkWebdavState,
} from "../src/host/fork/webdav/state-store.js";
import {
  FORK_WEBDAV_SYNC_MANIFEST,
  FORK_WEBDAV_SYNCED_SETTING_KEYS,
  type ForkSyncEntry,
} from "../src/host/fork/webdav-sync/manifest.js";
import {
  createManifestSnapshotApplier,
  createManifestSnapshotPort,
  pickKeys,
} from "../src/host/fork/webdav-sync/snapshot.js";

/** 快照条目是文本：这里造与 production 清单层一致的 JSON 文本。 */
function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseJson(text: string | undefined): unknown {
  return JSON.parse(text ?? "null");
}

/** 清单里的 base 在真实宿主会解析成两个目录；单测统一指向临时目录即可。 */
const stubSettingService = {
  get: async (): Promise<unknown> => ({}),
  update: async (): Promise<unknown> => undefined,
};

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "fork-webdav-test-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("状态文件：缺失或损坏都回落默认值，写入后可读回", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "nested", "fork-webdav.json");
    const defaults = await readForkWebdavState(filePath, "mac-a");
    assert.deepEqual(defaults, createDefaultForkWebdavState("mac-a"));

    await writeFile(filePath, "{ not json", "utf8").catch(async () => {
      await writeForkWebdavState(filePath, createDefaultForkWebdavState("mac-a"));
      await writeFile(filePath, "{ not json", "utf8");
    });
    assert.deepEqual(
      await readForkWebdavState(filePath, "mac-a"),
      createDefaultForkWebdavState("mac-a"),
    );

    const state = {
      ...createDefaultForkWebdavState("mac-a"),
      url: "https://dav.example.com/remote.php/dav/files/ryan",
      username: "ryan",
      autoSync: false,
      retentionLimit: 5,
      lastUploadedHash: "hash-1",
      pendingConflict: true,
    };
    await writeForkWebdavState(filePath, state);
    assert.deepEqual(await readForkWebdavState(filePath, "mac-a"), state);
    // 原子写不应留下临时文件
    const entries = await readFile(filePath, "utf8");
    assert.match(entries, /"url": "https:\/\/dav\.example\.com/);
  });
});

test("快照投影只包含白名单字段，远端多余键不会写回本地", () => {
  // 读快照与写回本地走同一个 pickKeys：两个方向都不许漏出白名单外的键。
  const picked = pickKeys(
    {
      locale: "zh-CN",
      memoryEnabled: true,
      recentProjects: ["/secret/path"],
      dataBaseDir: "/custom",
      providerFamilyDomain: "zai",
    },
    FORK_WEBDAV_SYNCED_SETTING_KEYS,
  );
  assert.deepEqual(picked, { locale: "zh-CN", memoryEnabled: true });

  const patch = pickKeys(
    {
      locale: "en-US",
      httpProxy: "http://proxy",
      unknownFutureKey: 1,
    },
    FORK_WEBDAV_SYNCED_SETTING_KEYS,
  );
  assert.deepEqual(patch, { locale: "en-US" });
});

test("本地快照读取：provider_config 缺失按空对象，哈希稳定", async () => {
  await withTempDir(async (dir) => {
    const providerConfigPath = join(dir, "provider_config.json");
    const settingsStore: Record<string, unknown> = {
      locale: "zh-CN",
      dataBaseDir: "/custom",
      memoryEnabled: false,
    };
    const port = createManifestSnapshotPort({
      resolveBase: () => dir,
      settingService: {
        get: async () => settingsStore,
        update: async () => undefined,
      },
    });

    const first = await port.read();
    assert.deepEqual(parseJson(first.files["setting.json"]), {
      locale: "zh-CN",
      memoryEnabled: false,
    });
    assert.deepEqual(parseJson(first.files["provider_config.json"]), {});

    const second = await port.read();
    assert.equal(first.contentHash, second.contentHash);

    await writeFile(providerConfigPath, JSON.stringify({ providers: [{ id: "a" }] }), "utf8");
    const third = await port.read();
    assert.notEqual(third.contentHash, first.contentHash);
    assert.deepEqual(parseJson(third.files["provider_config.json"]), { providers: [{ id: "a" }] });
  });
});

test("应用远端快照：只写白名单设置并原子覆盖 provider_config", async () => {
  await withTempDir(async (dir) => {
    const providerConfigPath = join(dir, "provider_config.json");
    const patches: Array<Record<string, unknown>> = [];
    const applier = createManifestSnapshotApplier({
      resolveBase: () => dir,
      settingService: {
        get: async () => ({}),
        update: async (patch) => {
          patches.push(patch);
          return undefined;
        },
      },
    });

    await applier.apply({
      files: {
        "setting.json": jsonText({ locale: "en-US", recentProjects: ["/x"] }),
        "provider_config.json": jsonText({ providers: [{ id: "b" }] }),
      },
      contentHash: "hash-2",
    });

    assert.deepEqual(patches, [{ locale: "en-US" }]);
    assert.deepEqual(JSON.parse(await readFile(providerConfigPath, "utf8")), {
      providers: [{ id: "b" }],
    });
    // 快照里完全缺席的资源保持本地不动：这份快照没有 presets 条目，就不该凭空造出目录。
    assert.equal(existsSync(join(dir, "presets")), false);
  });
});

test("扩展点：清单加一行即可同步新资源，webdav/ 引擎目录零改动", async () => {
  await withTempDir(async (dir) => {
    const sourceRoot = join(dir, "source");
    const targetRoot = join(dir, "target");

    // 生产清单里没有这个资源：新增同步范围只声明一行（复用既有 IO 形状），
    // 契约、打包、解包、哈希与 webdav/ 下的同步引擎都不需要改。
    const customEntry: ForkSyncEntry = {
      archiveName: "mcp_servers.json",
      source: { type: "file-json", base: "appConfigDir", path: "mcp_servers.json" },
    };
    assert.deepEqual(
      FORK_WEBDAV_SYNC_MANIFEST.map((entry) => entry.archiveName),
      [
        "setting.json",
        "tool-groups.json",
        "provider_config.json",
        "presets/active.json",
        "presets/profiles",
        "agents",
        "commands",
        "cli-fork/settings.json",
      ],
    );
    assert.equal(
      FORK_WEBDAV_SYNC_MANIFEST.some((entry) => entry.archiveName === customEntry.archiveName),
      false,
    );

    const servers = { servers: [{ id: "s1", command: "npx" }] };
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(join(sourceRoot, "mcp_servers.json"), jsonText(servers), "utf8");

    const port = createManifestSnapshotPort({
      manifest: [customEntry],
      resolveBase: () => sourceRoot,
      settingService: stubSettingService,
    });
    const snapshot = await port.read();
    assert.deepEqual(Object.keys(snapshot.files), ["mcp_servers.json"]);

    // 走一遍真实容器（打包 → 解包），新增资源经通用映射原样到达另一台机器。
    const zip = await buildBackupZip({
      manifest: {
        schemaVersion: 1,
        createdAt: "2026-09-29T01:00:00.000Z",
        appVersion: "3.14.3",
        contentHash: snapshot.contentHash,
        source: "test-machine",
      },
      files: snapshot.files,
    });
    const restored = await readBackupZip(zip);

    const applier = createManifestSnapshotApplier({
      manifest: [customEntry],
      resolveBase: () => targetRoot,
      settingService: stubSettingService,
    });
    await applier.apply({ files: restored.files, contentHash: restored.manifest.contentHash });

    assert.deepEqual(
      JSON.parse(await readFile(join(targetRoot, "mcp_servers.json"), "utf8")),
      servers,
    );
  });
});

test("递归目录条目：子目录文件一起往返，非声明扩展名不入包", async () => {
  await withTempDir(async (dir) => {
    const sourceRoot = join(dir, "source");
    const targetRoot = join(dir, "target");
    // 加载器递归扫描子目录，所以同步条目也必须声明 recursive——否则嵌套文件会被静默漏掉。
    const entry: ForkSyncEntry = {
      archiveName: "agents",
      source: {
        type: "directory",
        base: "storageRoot",
        path: "agents",
        fileExtensions: [".md"],
        recursive: true,
      },
    };
    await mkdir(join(sourceRoot, "agents", "team"), { recursive: true });
    await writeFile(join(sourceRoot, "agents", "flat.md"), "flat", "utf8");
    await writeFile(join(sourceRoot, "agents", "team", "nested.md"), "nested", "utf8");
    await writeFile(join(sourceRoot, "agents", "notes.txt"), "skip", "utf8");

    const snapshot = await createManifestSnapshotPort({
      manifest: [entry],
      resolveBase: () => sourceRoot,
      settingService: stubSettingService,
    }).read();
    assert.deepEqual(Object.keys(snapshot.files).sort(), [
      "agents/flat.md",
      "agents/team/nested.md",
    ]);

    await createManifestSnapshotApplier({
      manifest: [entry],
      resolveBase: () => targetRoot,
      settingService: stubSettingService,
    }).apply(snapshot);

    assert.equal(await readFile(join(targetRoot, "agents", "team", "nested.md"), "utf8"), "nested");
    assert.equal(existsSync(join(targetRoot, "agents", "notes.txt")), false);
  });
});

test("递归目录条目不因递归而放行越界路径", async () => {
  await withTempDir(async (dir) => {
    const targetRoot = join(dir, "target");
    const entry: ForkSyncEntry = {
      archiveName: "commands",
      source: {
        type: "directory",
        base: "storageRoot",
        path: "commands",
        fileExtensions: [".md"],
        recursive: true,
      },
    };

    await createManifestSnapshotApplier({
      manifest: [entry],
      resolveBase: () => targetRoot,
      settingService: stubSettingService,
    }).apply({
      files: {
        "commands/ok.md": "ok",
        "commands/../escaped.md": "escaped",
        "commands/./dot.md": "dot",
      },
      contentHash: "h",
    });

    assert.equal(await readFile(join(targetRoot, "commands", "ok.md"), "utf8"), "ok");
    assert.equal(existsSync(join(targetRoot, "escaped.md")), false);
    assert.equal(existsSync(join(targetRoot, "commands", "dot.md")), false);
  });
});
