import assert from "node:assert/strict";
import test from "node:test";
import { buildBackupZip, normalizeContentHash } from "../src/host/fork/webdav/backup-archive.js";
import {
  createSyncEngine,
  isRemoteNewerThanLocalSync,
  type ForkWebdavRemotePort,
} from "../src/host/fork/webdav/sync-engine.js";
import {
  createDefaultForkWebdavState,
  type ForkWebdavState,
} from "../src/host/fork/webdav/state-store.js";
import type { LocalSnapshot } from "../src/host/fork/webdav/local-snapshot.js";

interface Harness {
  engine: ReturnType<typeof createSyncEngine>;
  remoteFiles: Map<string, Buffer>;
  putOrder: string[];
  deletedKeys: string[];
  appliedSnapshots: LocalSnapshot[];
  setLocal: (setting: Record<string, unknown>) => void;
  getState: () => ForkWebdavState;
  logs: string[];
  breakPut: () => void;
}

function createHarness(options?: {
  autoSync?: boolean;
  retentionLimit?: number;
  lastSyncAt?: string | null;
  lastUploadedHash?: string | null;
}): Harness {
  const remoteFiles = new Map<string, Buffer>();
  const putOrder: string[] = [];
  const deletedKeys: string[] = [];
  const appliedSnapshots: LocalSnapshot[] = [];
  const logs: string[] = [];
  let setting: Record<string, unknown> = { locale: "zh-CN" };
  const providerConfig: Record<string, unknown> = {};
  let putShouldFail = false;

  let state: ForkWebdavState = {
    ...createDefaultForkWebdavState("test-machine"),
    url: "https://dav.example.com/",
    username: "user",
    autoSync: options?.autoSync ?? true,
    retentionLimit: options?.retentionLimit ?? 20,
    lastSyncAt: options?.lastSyncAt ?? null,
    lastUploadedHash: options?.lastUploadedHash ?? null,
  };

  const remote: ForkWebdavRemotePort = {
    async listBackups() {
      return [...remoteFiles.keys()].map((key) => ({
        key,
        createdAt: "2026-09-28T06:30:05.000Z",
        lastModified: "Mon, 28 Sep 2026 06:30:05 GMT",
        size: remoteFiles.get(key)?.byteLength ?? 0,
      }));
    },
    async getObject(key) {
      const value = remoteFiles.get(key);
      if (!value) {
        throw new Error(`missing ${key}`);
      }
      return value;
    },
    async putObject(key, body) {
      if (putShouldFail) {
        throw new Error("upload failed");
      }
      putOrder.push(key);
      remoteFiles.set(key, body);
    },
    async deleteObject(key) {
      if (!remoteFiles.delete(key)) {
        throw new Error(`missing ${key}`);
      }
      deletedKeys.push(key);
    },
  };

  const engine = createSyncEngine({
    remote,
    localSnapshot: {
      async read() {
        const picked = { ...setting };
        const hash = normalizeContentHash({ setting: picked, providerConfig });
        return { setting: picked, providerConfig, contentHash: hash };
      },
    },
    remoteApplier: {
      async apply(snapshot) {
        appliedSnapshots.push(snapshot);
        setting = { ...snapshot.setting };
      },
    },
    state: {
      get: () => state,
      set: async (next) => {
        state = next;
      },
    },
    clock: { now: () => new Date(2026, 8, 28, 14, 30, 5) },
    appVersion: "3.14.3",
    log: (event) => logs.push(event),
    runExclusive: async (run) => {
      await run();
      return { acquired: true };
    },
  });

  return {
    engine,
    remoteFiles,
    putOrder,
    deletedKeys,
    appliedSnapshots,
    setLocal: (next) => {
      setting = next;
    },
    getState: () => state,
    logs,
    breakPut: () => {
      putShouldFail = true;
    },
  };
}

/** 造一份"远端已有、内容为给定 setting"的备份包。 */
async function seedRemoteBackup(
  harness: Harness,
  key: string,
  setting: Record<string, unknown>,
): Promise<void> {
  const contentHash = normalizeContentHash({ setting, providerConfig: {} });
  const zip = await buildBackupZip({
    manifest: {
      schemaVersion: 1,
      createdAt: "2026-09-28T06:30:05.000Z",
      appVersion: "3.14.3",
      contentHash,
      source: "other-machine",
    },
    setting,
    providerConfig: {},
  });
  harness.remoteFiles.set(key, zip);
}

test("本地有改动时上传新备份并更新基准", async () => {
  const harness = createHarness();
  await harness.engine.runCycle("local-change");

  assert.equal(harness.putOrder.length, 1);
  assert.equal(harness.putOrder[0], "zcode-20260928-143005.zip");
  const state = harness.getState();
  assert.ok(state.lastUploadedHash);
  assert.equal(state.lastRemoteKey, "zcode-20260928-143005.zip");
  assert.equal(state.pendingConflict, false);
});

test("防抖窗口内不上传，但仍检测远端更新与冲突", async () => {
  const deferred = createHarness({ lastSyncAt: "2026-09-28T23:00:00.000Z" });
  deferred.getState().lastUploadedHash = "stale-hash";
  deferred.setLocal({ locale: "ja-JP" });
  await deferred.engine.runCycle("poll", { allowUpload: false });
  assert.equal(deferred.putOrder.length, 0);
  assert.ok(deferred.logs.includes("upload-deferred"));

  // 本地有改动 + 远端更新 → 冲突仍然立刻出现（不等防抖结束）
  const bothChanged = createHarness({ lastSyncAt: "2026-09-28T00:00:00.000Z" });
  bothChanged.getState().lastUploadedHash = "stale-hash";
  bothChanged.setLocal({ locale: "ja-JP" });
  await seedRemoteBackup(bothChanged, "zcode-20260928-060000.zip", { locale: "en-US" });
  await bothChanged.engine.runCycle("poll", { allowUpload: false });
  assert.equal(bothChanged.getState().pendingConflict, true);
  assert.equal(bothChanged.putOrder.length, 0);
});

test("内容未变时重复同步不会重复上传", async () => {
  const harness = createHarness();
  await harness.engine.runCycle("startup");
  await harness.engine.runCycle("poll");
  await harness.engine.runCycle("local-change");
  assert.equal(harness.putOrder.length, 1);
});

test("仅远端有更新且本地无改动时自动恢复", async () => {
  const harness = createHarness({ lastSyncAt: "2026-09-28T00:00:00.000Z" });
  const localSetting = { locale: "zh-CN" };
  harness.setLocal(localSetting);
  harness.getState().lastUploadedHash = normalizeContentHash({
    setting: localSetting,
    providerConfig: {},
  });
  await seedRemoteBackup(harness, "zcode-20260928-060000.zip", { locale: "en-US" });

  await harness.engine.runCycle("poll");

  assert.equal(harness.appliedSnapshots.length, 1);
  assert.deepEqual(harness.appliedSnapshots[0]?.setting, { locale: "en-US" });
  assert.equal(harness.putOrder.length, 0);
  assert.equal(harness.getState().pendingConflict, false);
});

test("双侧都有改动时进入冲突且不覆盖任一侧", async () => {
  const harness = createHarness({ lastSyncAt: "2026-09-28T00:00:00.000Z" });
  harness.getState().lastUploadedHash = normalizeContentHash({
    setting: { locale: "zh-CN" },
    providerConfig: {},
  });
  harness.setLocal({ locale: "ja-JP" });
  await seedRemoteBackup(harness, "zcode-20260928-060000.zip", { locale: "en-US" });

  await harness.engine.runCycle("poll");

  assert.equal(harness.getState().pendingConflict, true);
  assert.equal(harness.putOrder.length, 0);
  assert.equal(harness.appliedSnapshots.length, 0);
  assert.ok(harness.logs.includes("conflict"));
});

test("冲突解决：保留本地会上传，使用远端会恢复并先备份本地", async () => {
  const keepLocal = createHarness({ lastSyncAt: "2026-09-28T00:00:00.000Z" });
  keepLocal.getState().lastUploadedHash = "stale-hash";
  keepLocal.setLocal({ locale: "ja-JP" });
  await seedRemoteBackup(keepLocal, "zcode-20260928-060000.zip", { locale: "en-US" });
  await keepLocal.engine.resolveConflict("keep-local");
  assert.equal(keepLocal.putOrder.length, 1);
  assert.equal(keepLocal.getState().pendingConflict, false);

  const useRemote = createHarness({ lastSyncAt: "2026-09-28T00:00:00.000Z" });
  useRemote.getState().lastUploadedHash = "stale-hash";
  useRemote.setLocal({ locale: "ja-JP" });
  await seedRemoteBackup(useRemote, "zcode-20260928-060000.zip", { locale: "en-US" });
  await useRemote.engine.resolveConflict("use-remote-latest");
  // 恢复前先自动备份本地，再应用远端。
  assert.equal(useRemote.putOrder.length, 1);
  assert.deepEqual(
    useRemote.appliedSnapshots.map((item) => item.setting),
    [{ locale: "en-US" }],
  );
  assert.ok(useRemote.putOrder[0]!.startsWith("zcode-"));
});

test("本机从未同步过而远端已有备份时进入冲突（首次配置由用户选择）", async () => {
  const harness = createHarness();
  await seedRemoteBackup(harness, "zcode-20260928-060000.zip", { locale: "en-US" });
  await harness.engine.runCycle("startup");
  assert.equal(harness.getState().pendingConflict, true);
  assert.equal(harness.putOrder.length, 0);
  assert.equal(harness.appliedSnapshots.length, 0);
});

test("保留份数超出时删除最旧备份，且只删备份包", async () => {
  // lastSyncAt 设为晚于远端备份包，确保本周期走「仅本地变 → 上传 + 清理」分支。
  const harness = createHarness({ retentionLimit: 3, lastSyncAt: "2026-09-28T23:00:00.000Z" });
  await seedRemoteBackup(harness, "zcode-20260928-100000.zip", { locale: "a" });
  await seedRemoteBackup(harness, "zcode-20260928-110000.zip", { locale: "b" });
  await seedRemoteBackup(harness, "zcode-20260928-120000.zip", { locale: "c" });
  harness.remoteFiles.set("notes.txt", Buffer.from("keep me"));

  await harness.engine.runCycle("local-change");

  assert.deepEqual(harness.deletedKeys, ["zcode-20260928-100000.zip"]);
  assert.equal(harness.remoteFiles.has("notes.txt"), true);
  assert.equal(harness.remoteFiles.size, 4);
});

test("自动同步关闭时不做上传也不做恢复", async () => {
  const harness = createHarness({ autoSync: false, lastSyncAt: "2026-09-28T00:00:00.000Z" });
  await seedRemoteBackup(harness, "zcode-20260928-060000.zip", { locale: "en-US" });
  await harness.engine.runCycle("poll");
  assert.equal(harness.putOrder.length, 0);
  assert.equal(harness.appliedSnapshots.length, 0);

  // 手动备份仍然可用。
  await harness.engine.backupNow();
  assert.equal(harness.putOrder.length, 1);
});

test("上传失败向上抛出（lastError 由 service 层记录，不落盘）", async () => {
  const harness = createHarness();
  harness.breakPut();
  await assert.rejects(() => harness.engine.backupNow(), /upload failed/);
  assert.ok(harness.logs.includes("cycle-failed"));
});

test("拿不到锁时跳过本周期", async () => {
  let calls = 0;
  const engine = createSyncEngine({
    remote: null,
    localSnapshot: {
      async read() {
        calls += 1;
        return { setting: {}, providerConfig: {}, contentHash: "h" };
      },
    },
    remoteApplier: { async apply() {} },
    state: { get: () => createDefaultForkWebdavState("m"), set: async () => undefined },
    clock: { now: () => new Date() },
    appVersion: "3.14.3",
    log: () => undefined,
    runExclusive: async () => ({ acquired: false }),
  });
  await engine.runCycle("poll");
  assert.equal(calls, 0);
});

test("远端更新时间判断：本机未同步过视为远端更新", () => {
  const backup = {
    key: "zcode-20260928-060000.zip",
    createdAt: "2026-09-28T06:00:00.000Z",
    size: 1,
  };
  assert.equal(isRemoteNewerThanLocalSync(backup, null), true);
  assert.equal(isRemoteNewerThanLocalSync(backup, "2026-09-28T07:00:00.000Z"), false);
  assert.equal(isRemoteNewerThanLocalSync(backup, "2026-09-28T05:00:00.000Z"), true);
  assert.equal(isRemoteNewerThanLocalSync(null, null), false);
});
