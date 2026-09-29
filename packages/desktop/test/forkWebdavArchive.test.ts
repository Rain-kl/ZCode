import assert from "node:assert/strict";
import test from "node:test";
import yazl from "yazl";
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

/**
 * 快照里的资源都是文本（zip 条目名 → 文本），所以这里本地造文本：
 * 内容哈希与打包都只搬运字符串，不认业务对象。
 */
function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const MANIFEST = {
  schemaVersion: 1 as const,
  createdAt: "2026-09-28T06:30:05.000Z",
  appVersion: "3.14.3",
  contentHash: "abc123",
  source: "macbook",
};

/** 手工构造 zip（用于造「缺 manifest」这类 buildBackupZip 产不出的包）。 */
async function buildZipFromEntries(entries: Record<string, string>): Promise<Buffer> {
  const zipFile = new yazl.ZipFile();
  for (const [fileName, text] of Object.entries(entries)) {
    zipFile.addBuffer(Buffer.from(text, "utf8"), fileName);
  }
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    zipFile.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zipFile.outputStream.on("error", reject);
    zipFile.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zipFile.end();
  });
}

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

  // 条目文本由清单层生成且逐字搬运，所以哈希的稳定性体现在「同一张映射、不同插入顺序」上。
  const settingText = jsonText({ locale: "zh-CN", memoryEnabled: true });
  const providerText = jsonText({ providers: [] });
  const left = normalizeContentHash({
    files: { "setting.json": settingText, "provider_config.json": providerText },
  });
  const right = normalizeContentHash({
    files: { "provider_config.json": providerText, "setting.json": settingText },
  });
  assert.equal(left, right);
  assert.equal(left.length, 64);
  assert.notEqual(
    left,
    normalizeContentHash({
      files: {
        "setting.json": jsonText({ locale: "en-US" }),
        "provider_config.json": providerText,
      },
    }),
  );
});

test("zip 往返保持 manifest 与各资源条目一致（含空 provider 配置）", async () => {
  const content = {
    manifest: MANIFEST,
    files: {
      "setting.json": jsonText({ locale: "zh-CN", memoryEnabled: true }),
      "provider_config.json": jsonText({}),
    },
  };
  const zip = await buildBackupZip(content);
  assert.ok(zip.length > 0);
  const restored = await readBackupZip(zip);
  assert.deepEqual(restored, content);
});

test("解包缺 manifest 或 schema 不兼容时报错", async () => {
  const zip = await buildBackupZip({
    manifest: { ...MANIFEST, schemaVersion: 2 as unknown as 1 },
    files: {
      "setting.json": jsonText({}),
      "provider_config.json": jsonText({}),
    },
  });
  await assert.rejects(() => readBackupZip(zip), /schemaVersion/);

  // 缺的是容器自身的元数据（业务条目缺席不算损坏，见 snapshot 层的「旧备份包」规则）。
  const withoutManifest = await buildZipFromEntries({ "setting.json": jsonText({}) });
  await assert.rejects(() => readBackupZip(withoutManifest), /缺少 manifest\.json/);
});
