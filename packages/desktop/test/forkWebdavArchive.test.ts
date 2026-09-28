import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBackupKey,
  buildBackupZip,
  isBackupKey,
  normalizeContentHash,
  parseBackupKeyDate,
  readBackupZip,
  selectKeysToPrune,
  sortBackupEntriesDesc,
  stableStringify,
} from "../src/host/fork/webdav/backup-archive.js";

test("备份包命名是 zcode-YYYYMMDD-HHmmss.zip，同秒冲突追加序号", () => {
  const date = new Date(2026, 8, 28, 14, 30, 5);
  assert.equal(buildBackupKey(date), "zcode-20260928-143005.zip");
  assert.equal(buildBackupKey(date, ["zcode-20260928-143005.zip"]), "zcode-20260928-143005-1.zip");
  assert.equal(
    buildBackupKey(date, ["zcode-20260928-143005.zip", "zcode-20260928-143005-1.zip"]),
    "zcode-20260928-143005-2.zip",
  );
});

test("只有符合命名的对象才被当作备份包", () => {
  assert.equal(isBackupKey("zcode-20260928-143005.zip"), true);
  assert.equal(isBackupKey("zcode-20260928-143005-3.zip"), true);
  assert.equal(isBackupKey("notes.txt"), false);
  assert.equal(isBackupKey("zcode-backup.zip"), false);
});

test("key 可反解为时间，排序按时间倒序且容忍缺 mtime", () => {
  const older = "zcode-20260928-100000.zip";
  const newer = "zcode-20260928-120000.zip";
  assert.equal(parseBackupKeyDate(older)?.getHours(), 10);
  const sorted = sortBackupEntriesDesc([
    { key: older },
    { key: newer, lastModified: "Mon, 28 Sep 2026 12:00:00 GMT" },
  ]);
  assert.deepEqual(
    sorted.map((entry) => entry.key),
    [newer, older],
  );
});

test("保留策略只删除超出份数的旧包，且忽略非备份包对象", () => {
  const entries = [
    { key: "zcode-20260928-100000.zip" },
    { key: "zcode-20260928-110000.zip" },
    { key: "zcode-20260928-120000.zip" },
    { key: "readme.txt" },
  ];
  assert.deepEqual(selectKeysToPrune(entries, 2), ["zcode-20260928-100000.zip"]);
  assert.deepEqual(selectKeysToPrune(entries, 5), []);
  assert.deepEqual(selectKeysToPrune(entries, 0), [
    "zcode-20260928-100000.zip",
    "zcode-20260928-110000.zip",
    "zcode-20260928-120000.zip",
  ]);
});

test("稳定序列化与内容哈希不受键序影响", () => {
  assert.equal(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
  const left = normalizeContentHash({
    setting: { locale: "zh-CN", memoryEnabled: true },
    providerConfig: { providers: [] },
  });
  const right = normalizeContentHash({
    providerConfig: { providers: [] },
    setting: { memoryEnabled: true, locale: "zh-CN" },
  });
  assert.equal(left, right);
  assert.equal(left.length, 64);
  assert.notEqual(
    left,
    normalizeContentHash({ setting: { locale: "en-US" }, providerConfig: { providers: [] } }),
  );
});

test("zip 往返保持 manifest/setting/providerConfig 一致（含空 provider 配置）", async () => {
  const content = {
    manifest: {
      schemaVersion: 1 as const,
      createdAt: "2026-09-28T06:30:05.000Z",
      appVersion: "3.14.3",
      contentHash: "abc123",
      source: "macbook",
    },
    setting: { locale: "zh-CN", memoryEnabled: true },
    providerConfig: {},
  };
  const zip = await buildBackupZip(content);
  assert.ok(zip.length > 0);
  const restored = await readBackupZip(zip);
  assert.deepEqual(restored, content);
});

test("解包缺文件或 schema 不兼容时报错", async () => {
  const zip = await buildBackupZip({
    manifest: {
      schemaVersion: 2 as unknown as 1,
      createdAt: "2026-09-28T06:30:05.000Z",
      appVersion: "3.14.3",
      contentHash: "abc123",
      source: "macbook",
    },
    setting: {},
    providerConfig: {},
  });
  await assert.rejects(() => readBackupZip(zip), /schemaVersion/);
});
