import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import yazl from "yazl";

import {
  FORK_IDENTITY_PRESET_PROFILE_EXTENSION,
  FORK_IDENTITY_PRESET_PROFILES_DIRNAME,
  FORK_IDENTITY_PRESET_STATE_FILENAME,
  FORK_WEBDAV_MANIFEST_FILE,
} from "@zcode/shared";

import {
  buildBackupZip,
  normalizeContentHash,
  readBackupZip,
} from "../src/host/fork/webdav/backup-archive.js";
import { FORK_WEBDAV_SYNC_MANIFEST } from "../src/host/fork/webdav-sync/manifest.js";
import {
  createManifestSnapshotApplier,
  createManifestSnapshotPort,
} from "../src/host/fork/webdav-sync/snapshot.js";

const MANIFEST = {
  schemaVersion: 1 as const,
  createdAt: "2026-09-29T01:00:00.000Z",
  appVersion: "3.14.3",
  contentHash: "hash-1",
  source: "test",
};

/** presets 条目名与生产清单一致（archiveName: "presets"），内部布局见 identity-preset 契约。 */
const PRESETS_ARCHIVE_NAME = "presets";
const PRESETS_STATE_ARCHIVE_NAME = "presets/active.json";
const PRESETS_PROFILES_ARCHIVE_NAME = "presets/profiles";
const PRESETS_STATE_ENTRY = `${PRESETS_ARCHIVE_NAME}/${FORK_IDENTITY_PRESET_STATE_FILENAME}`;

function presetsProfileEntry(id: string): string {
  return `${PRESETS_ARCHIVE_NAME}/${FORK_IDENTITY_PRESET_PROFILES_DIRNAME}/${id}${FORK_IDENTITY_PRESET_PROFILE_EXTENSION}`;
}

function presetsEntries(files: Record<string, string>): Record<string, string> {
  const prefix = `${PRESETS_ARCHIVE_NAME}/`;
  return Object.fromEntries(Object.entries(files).filter(([name]) => name.startsWith(prefix)));
}

/** 快照条目是文本：这里造与 production 清单层一致的 JSON 文本。 */
function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseJson(text: string | undefined): unknown {
  return JSON.parse(text ?? "null");
}

const stubSettingService = {
  get: async (): Promise<unknown> => ({}),
  update: async (): Promise<unknown> => undefined,
};

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "fork-webdav-presets-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function zipBuffer(zipFile: yazl.ZipFile): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    zipFile.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zipFile.outputStream.on("error", reject);
    zipFile.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zipFile.end();
  });
}

test("zip 往返保留系统指令配置", async () => {
  // 清单把 preset 拆成两条：状态文件是单份 JSON，提示词正文是一层目录。
  assert.equal(
    FORK_WEBDAV_SYNC_MANIFEST.some((entry) => entry.archiveName === PRESETS_STATE_ARCHIVE_NAME),
    true,
  );
  assert.equal(
    FORK_WEBDAV_SYNC_MANIFEST.some((entry) => entry.archiveName === PRESETS_PROFILES_ARCHIVE_NAME),
    true,
  );

  const profileText = "---\nname: 极简\n---\n\n只给结论。\n";
  const files = {
    "setting.json": jsonText({ locale: "zh-CN" }),
    "provider_config.json": jsonText({}),
    [PRESETS_STATE_ENTRY]: jsonText({ schemaVersion: 1, enabled: true, activeId: "concise" }),
    [presetsProfileEntry("concise")]: profileText,
  };
  const zip = await buildBackupZip({ manifest: MANIFEST, files });

  const content = await readBackupZip(zip);
  assert.deepEqual(presetsEntries(content.files), {
    [PRESETS_STATE_ENTRY]: jsonText({ schemaVersion: 1, enabled: true, activeId: "concise" }),
    [presetsProfileEntry("concise")]: profileText,
  });
});

test("旧备份包（无 presets 条目）不产生该前缀条目", async () => {
  const zip = await buildBackupZip({
    manifest: MANIFEST,
    files: {
      "setting.json": jsonText({ locale: "zh-CN" }),
      "provider_config.json": jsonText({}),
    },
  });

  const content = await readBackupZip(zip);
  assert.deepEqual(presetsEntries(content.files), {});
});

test("预设正文参与内容哈希：只改正文也会触发上传", () => {
  const base = {
    "setting.json": jsonText({ locale: "zh-CN" }),
    "provider_config.json": jsonText({}),
  };
  const before = normalizeContentHash({
    files: { ...base, [presetsProfileEntry("a")]: "旧正文" },
  });
  const after = normalizeContentHash({
    files: { ...base, [presetsProfileEntry("a")]: "新正文" },
  });

  assert.notEqual(before, after);
});

test("备份包内的越界预设条目名被拒绝：既不越界写文件，也不吞掉合法正文", async () => {
  // 写入侧：yazl 自己拒绝 `..`，所以本项目的打包不可能产出穿越条目。
  const hostile = new yazl.ZipFile();
  assert.throws(
    () => hostile.addBuffer(Buffer.from("x", "utf8"), "presets/profiles/../escaped.md"),
    /invalid relative path/,
  );

  // 读取侧：引擎对资源无知，不再按业务规则拒绝条目；条目名是外部输入，
  // 过滤职责下移到清单层——写回本地之前必须挡住嵌套 / 穿越名字。
  const zipFile = new yazl.ZipFile();
  zipFile.addBuffer(Buffer.from(JSON.stringify(MANIFEST), "utf8"), FORK_WEBDAV_MANIFEST_FILE);
  zipFile.addBuffer(Buffer.from("{}", "utf8"), "setting.json");
  zipFile.addBuffer(Buffer.from("{}", "utf8"), "provider_config.json");
  zipFile.addBuffer(Buffer.from("x", "utf8"), "presets/profiles/nested/evil.md");
  const content = await readBackupZip(await zipBuffer(zipFile));

  await withTempDir(async (dir) => {
    await mkdir(join(dir, "presets", "profiles"), { recursive: true });
    const applier = createManifestSnapshotApplier({
      resolveBase: () => dir,
      settingService: stubSettingService,
    });
    await applier.apply({
      files: {
        ...content.files,
        [presetsProfileEntry("concise")]: "合法正文",
        "presets/profiles/../escaped.md": "x",
      },
      contentHash: "h",
    });

    assert.equal(existsSync(join(dir, "escaped.md")), false);
    assert.equal(existsSync(join(dir, "presets", "profiles", "nested", "evil.md")), false);
    // 合法的正文必须写回，否则「越界被拒绝」只是因为整类条目都被丢掉了。
    assert.equal(
      await readFile(join(dir, "presets", "profiles", "concise.md"), "utf8"),
      "合法正文",
    );
  });
});

test("本地快照读取只收合法 id 的配置", async () => {
  await withTempDir(async (dir) => {
    const presetsDir = join(dir, "presets");
    await mkdir(join(presetsDir, "profiles"), { recursive: true });
    await writeFile(
      join(presetsDir, "active.json"),
      JSON.stringify({ schemaVersion: 1, enabled: true, activeId: "concise" }),
      "utf8",
    );
    await writeFile(join(presetsDir, "profiles", "concise.md"), "正文", "utf8");
    await writeFile(join(presetsDir, "profiles", "NOT-AN-ID.md"), "越界", "utf8");
    await writeFile(join(presetsDir, "profiles", "readme.txt"), "非 md", "utf8");

    const port = createManifestSnapshotPort({
      resolveBase: () => dir,
      settingService: stubSettingService,
    });
    const snapshot = await port.read();

    assert.deepEqual(parseJson(snapshot.files[PRESETS_STATE_ENTRY]), {
      schemaVersion: 1,
      enabled: true,
      activeId: "concise",
    });
    assert.deepEqual(
      Object.keys(snapshot.files).filter((name) =>
        name.startsWith(`${PRESETS_ARCHIVE_NAME}/${FORK_IDENTITY_PRESET_PROFILES_DIRNAME}/`),
      ),
      [presetsProfileEntry("concise")],
    );
  });
});

test("恢复到旧备份（无 presets 条目）时保持本地配置不动", async () => {
  await withTempDir(async (dir) => {
    const presetsDir = join(dir, "presets");
    await mkdir(join(presetsDir, "profiles"), { recursive: true });
    await writeFile(join(presetsDir, "profiles", "keep.md"), "本地内容", "utf8");

    const applier = createManifestSnapshotApplier({
      resolveBase: () => dir,
      settingService: stubSettingService,
    });
    await applier.apply({
      files: {
        "setting.json": jsonText({}),
        "provider_config.json": jsonText({}),
      },
      contentHash: "h",
    });

    assert.equal(await readFile(join(presetsDir, "profiles", "keep.md"), "utf8"), "本地内容");
  });
});

test("恢复含 presets 的备份时整目录覆盖，远端删过的配置不会在本地复活", async () => {
  await withTempDir(async (dir) => {
    const presetsDir = join(dir, "presets");
    await mkdir(join(presetsDir, "profiles"), { recursive: true });
    await writeFile(join(presetsDir, "profiles", "stale.md"), "该被删掉", "utf8");

    const applier = createManifestSnapshotApplier({
      resolveBase: () => dir,
      settingService: stubSettingService,
    });
    await applier.apply({
      files: {
        "setting.json": jsonText({}),
        "provider_config.json": jsonText({}),
        [PRESETS_STATE_ENTRY]: jsonText({ schemaVersion: 1, enabled: true, activeId: "concise" }),
        [presetsProfileEntry("concise")]: "远端正文",
      },
      contentHash: "h",
    });

    assert.equal(await readFile(join(presetsDir, "profiles", "concise.md"), "utf8"), "远端正文");
    assert.equal(existsSync(join(presetsDir, "profiles", "stale.md")), false);
    assert.deepEqual(JSON.parse(await readFile(join(presetsDir, "active.json"), "utf8")), {
      schemaVersion: 1,
      enabled: true,
      activeId: "concise",
    });
  });
});
