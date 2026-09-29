/**
 * 按清单读/写同步快照。
 *
 * 这里是**唯一**知道"哪些文件、怎么读、怎么写"的地方；WebDAV 引擎只拿到
 * 「zip 条目名 → 文本」的扁平映射。新增资源只改 `manifest.ts`。
 *
 * 见 FEATURES.md 的 local-mode 条目与 docs/features/local-mode/design.md 第 6.5 节。
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { normalizeContentHash } from "../webdav/backup-archive.js";
import type { SyncSnapshotApplierPort, SyncSnapshotPort } from "../webdav/snapshot-port.js";
import {
  FORK_WEBDAV_SYNC_MANIFEST,
  type ForkSyncBase,
  type ForkSyncEntry,
  type ForkSyncSource,
} from "./manifest.js";

/** 设置服务端口（真实实现是 ISettingService，只需 get/update）。 */
export interface ForkSettingPort {
  get(): Promise<unknown>;
  update(patch: Record<string, unknown>): Promise<unknown>;
}

export interface ManifestSnapshotOptions {
  /** 默认用 `FORK_WEBDAV_SYNC_MANIFEST`；测试可注入自定义清单验证扩展性。 */
  manifest?: readonly ForkSyncEntry[];
  /** 把清单里的 base 解析成绝对路径（宿主注入 app 配置目录与 storage root）。 */
  resolveBase(base: ForkSyncBase): string;
  settingService: ForkSettingPort;
}

export function createManifestSnapshotPort(options: ManifestSnapshotOptions): SyncSnapshotPort {
  return {
    async read() {
      const files: Record<string, string> = {};
      for (const entry of options.manifest ?? FORK_WEBDAV_SYNC_MANIFEST) {
        Object.assign(files, await readEntry(entry, options));
      }
      return { files, contentHash: normalizeContentHash({ files }) };
    },
  };
}

export function createManifestSnapshotApplier(
  options: ManifestSnapshotOptions,
): SyncSnapshotApplierPort {
  return {
    async apply(snapshot) {
      for (const entry of options.manifest ?? FORK_WEBDAV_SYNC_MANIFEST) {
        const collected = collectEntry(entry, snapshot.files);
        // 快照里完全没有这个资源的条目 = 远端备份包来自旧版本：保持本地不动，
        // 否则用户恢复一个旧包就会丢掉后来新增的配置。
        if (!collected.found) continue;
        await applyEntry(entry, collected, options);
      }
    },
  };
}

// -----------------------------------------------
// 读取
// -----------------------------------------------

async function readEntry(
  entry: ForkSyncEntry,
  options: ManifestSnapshotOptions,
): Promise<Record<string, string>> {
  const source = entry.source;
  switch (source.type) {
    case "setting-service": {
      const settings = ((await options.settingService.get()) ?? {}) as Record<string, unknown>;
      return { [entry.archiveName]: toJsonText(pickKeys(settings, source.keys)) };
    }
    case "file-json":
      return { [entry.archiveName]: toJsonText(await readJsonObject(localPath(source, options))) };
    case "file-json-whitelist": {
      const parsed = await readJsonObject(localPath(source, options));
      return { [entry.archiveName]: toJsonText(pickKeys(parsed, source.keys)) };
    }
    case "directory":
      return await readDirectoryEntry(entry, source, options);
  }
}

async function readDirectoryEntry(
  entry: ForkSyncEntry,
  source: Extract<ForkSyncSource, { type: "directory" }>,
  options: ManifestSnapshotOptions,
): Promise<Record<string, string>> {
  const dir = localPath(source, options);
  const files: Record<string, string> = {};
  if (source.stateFileName) {
    const state = await readOptionalJsonObject(join(dir, source.stateFileName));
    if (state) {
      files[`${entry.archiveName}/${source.stateFileName}`] = toJsonText(state);
    }
  }
  let fileNames: string[] = [];
  try {
    fileNames = await readdir(dir);
  } catch {
    // 目录不存在 = 还没配置过，属正常状态。
    return files;
  }
  for (const fileName of fileNames) {
    if (source.fileExtension && !fileName.endsWith(source.fileExtension)) continue;
    const stem = source.fileExtension ? fileName.slice(0, -source.fileExtension.length) : fileName;
    // 主干不合法的文件不入包：既不该被带到别的机器，也不该在那边被写出来。
    if (source.isValidStem && !source.isValidStem(stem)) continue;
    try {
      files[`${entry.archiveName}/${fileName}`] = await readFile(join(dir, fileName), "utf8");
    } catch {
      // 单个文件读失败不影响其余条目与整次备份。
    }
  }
  return files;
}

// -----------------------------------------------
// 写入
// -----------------------------------------------

interface CollectedEntry {
  found: boolean;
  jsonText?: string;
  directoryFiles: Record<string, string>;
}

function collectEntry(entry: ForkSyncEntry, files: Record<string, string>): CollectedEntry {
  if (entry.source.type !== "directory") {
    const text = files[entry.archiveName];
    return { found: text !== undefined, jsonText: text, directoryFiles: {} };
  }
  const prefix = `${entry.archiveName}/`;
  const directoryFiles: Record<string, string> = {};
  for (const [name, text] of Object.entries(files)) {
    if (name.startsWith(prefix) && name.length > prefix.length) {
      directoryFiles[name.slice(prefix.length)] = text;
    }
  }
  const stateName = entry.source.stateFileName;
  const stateFound = stateName ? directoryFiles[stateName] !== undefined : false;
  return {
    found: Object.keys(directoryFiles).length > 0,
    ...(stateFound ? { jsonText: directoryFiles[stateName!] } : {}),
    directoryFiles,
  };
}

async function applyEntry(
  entry: ForkSyncEntry,
  collected: CollectedEntry,
  options: ManifestSnapshotOptions,
): Promise<void> {
  const source = entry.source;
  switch (source.type) {
    case "setting-service": {
      const parsed = parseJsonObject(collected.jsonText);
      // 走 settingService.update 保持单写入者语义；白名单外的键在读取侧就已丢弃，
      // 这里再过滤一次，防止手改的备份包塞进未知字段。
      await options.settingService.update(pickKeys(parsed, source.keys));
      return;
    }
    case "file-json": {
      const parsed = parseJsonObject(collected.jsonText);
      await writeTextAtomic(localPath(source, options), toJsonText(parsed));
      return;
    }
    case "file-json-whitelist": {
      const parsed = pickKeys(parseJsonObject(collected.jsonText), source.keys);
      await writeTextAtomic(localPath(source, options), toJsonText(parsed));
      return;
    }
    case "directory": {
      const dir = localPath(source, options);
      // 整目录覆盖：先删再写，避免「远端删过的配置在本地复活」。
      await rm(dir, { recursive: true, force: true });
      for (const [fileName, text] of Object.entries(collected.directoryFiles)) {
        if (source.stateFileName && fileName === source.stateFileName) {
          await writeTextAtomic(join(dir, fileName), text);
          continue;
        }
        const stem = source.fileExtension
          ? fileName.slice(0, -source.fileExtension.length)
          : fileName;
        if (source.fileExtension && !fileName.endsWith(source.fileExtension)) continue;
        if (source.isValidStem && !source.isValidStem(stem)) continue;
        if (fileName.includes("/") || fileName.includes("\\")) continue;
        await writeTextAtomic(join(dir, fileName), text);
      }
      return;
    }
  }
}

// -----------------------------------------------
// 基础工具
// -----------------------------------------------

function localPath(
  source: { base: ForkSyncBase; path: string },
  options: ManifestSnapshotOptions,
): string {
  return join(options.resolveBase(source.base), source.path);
}

export function pickKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in value) {
      picked[key] = value[key];
    }
  }
  return picked;
}

function toJsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseJsonObject(text: string | undefined): Record<string, unknown> {
  if (text === undefined) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 备份包内容损坏：按空对象处理，与本地文件损坏时的既有取舍一致。
  }
  return {};
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  return (await readOptionalJsonObject(filePath)) ?? {};
}

async function readOptionalJsonObject(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 文件缺失或损坏。
  }
  return null;
}

async function writeTextAtomic(filePath: string, text: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, text, "utf8");
  await rename(temporaryPath, filePath);
}
