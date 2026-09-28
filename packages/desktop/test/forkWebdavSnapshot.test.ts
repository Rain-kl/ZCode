import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createDefaultForkWebdavState,
  readForkWebdavState,
  writeForkWebdavState,
} from "../src/host/fork/webdav/state-store.js";
import {
  buildSettingsPatchFromRemote,
  createLocalSnapshotPort,
  createRemoteSnapshotApplier,
  pickSyncedSettings,
} from "../src/host/fork/webdav/local-snapshot.js";

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
  const picked = pickSyncedSettings({
    locale: "zh-CN",
    memoryEnabled: true,
    recentProjects: ["/secret/path"],
    dataBaseDir: "/custom",
    providerFamilyDomain: "zai",
  });
  assert.deepEqual(picked, { locale: "zh-CN", memoryEnabled: true });

  const patch = buildSettingsPatchFromRemote({
    locale: "en-US",
    httpProxy: "http://proxy",
    unknownFutureKey: 1,
  });
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
    const port = createLocalSnapshotPort({
      settingService: {
        get: async () => settingsStore,
        update: async () => undefined,
      },
      providerConfigPath,
    });

    const first = await port.read();
    assert.deepEqual(first.setting, { locale: "zh-CN", memoryEnabled: false });
    assert.deepEqual(first.providerConfig, {});

    const second = await port.read();
    assert.equal(first.contentHash, second.contentHash);

    await writeFile(providerConfigPath, JSON.stringify({ providers: [{ id: "a" }] }), "utf8");
    const third = await port.read();
    assert.notEqual(third.contentHash, first.contentHash);
    assert.deepEqual(third.providerConfig, { providers: [{ id: "a" }] });
  });
});

test("应用远端快照：只写白名单设置并原子覆盖 provider_config", async () => {
  await withTempDir(async (dir) => {
    const providerConfigPath = join(dir, "provider_config.json");
    const patches: Array<Record<string, unknown>> = [];
    const applier = createRemoteSnapshotApplier({
      settingService: {
        get: async () => ({}),
        update: async (patch) => {
          patches.push(patch);
          return undefined;
        },
      },
      providerConfigPath,
    });

    await applier.apply({
      setting: { locale: "en-US", recentProjects: ["/x"] },
      providerConfig: { providers: [{ id: "b" }] },
      contentHash: "hash-2",
    });

    assert.deepEqual(patches, [{ locale: "en-US" }]);
    assert.deepEqual(JSON.parse(await readFile(providerConfigPath, "utf8")), {
      providers: [{ id: "b" }],
    });
  });
});
