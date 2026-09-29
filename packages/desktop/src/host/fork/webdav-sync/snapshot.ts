/**
 * 按清单读/写同步快照。
 *
 * 这里是**唯一**知道"哪些文件、怎么读、怎么写"的地方；WebDAV 引擎只拿到
 * 「zip 条目名 → 文本」的扁平映射。新增资源只改 `manifest.ts`。
 *
 * 见 FEATURES.md 的 local-mode 条目与 docs/features/local-mode/design.md 第 6.5 节。
 */
import type { Dirent } from "node:fs";
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
  for (const [relativePath, text] of Object.entries(
    await collectDirectoryFiles(dir, source, "", 0),
  )) {
    files[`${entry.archiveName}/${relativePath}`] = text;
  }
  return files;
}

/** 目录深度上限：防止软链环或异常深的目录把一次备份拖死。 */
const MAX_DIRECTORY_DEPTH = 24;

/**
 * 收集目录下的文件，键为相对路径（posix 分隔符）。
 * 与加载器一致：`recursive` 时才下钻——加载器递归而同步不递归会静默漏文件。
 */
async function collectDirectoryFiles(
  dir: string,
  source: Extract<ForkSyncSource, { type: "directory" }>,
  prefix: string,
  depth: number,
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  if (depth > MAX_DIRECTORY_DEPTH) return files;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // 目录不存在 = 还没配置过，属正常状态。
    return files;
  }
  for (const item of entries) {
    const relativePath = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) {
      if (!source.recursive) continue;
      Object.assign(
        files,
        await collectDirectoryFiles(join(dir, item.name), source, relativePath, depth + 1),
      );
      continue;
    }
    if (!item.isFile()) continue;
    if (!isAcceptedFileName(item.name, source)) continue;
    try {
      files[relativePath] = await readFile(join(dir, item.name), "utf8");
    } catch {
      // 单个文件读失败不影响其余条目与整次备份。
    }
  }
  return files;
}

function isAcceptedFileName(
  fileName: string,
  source: Extract<ForkSyncSource, { type: "directory" }>,
): boolean {
  if (fileName.includes("/") || fileName.includes("\\")) return false;
  if (fileName === "." || fileName === "..") return false;
  const extensions = source.fileExtensions ?? [];
  const matched = extensions.find((extension) => fileName.endsWith(extension));
  if (extensions.length > 0 && matched === undefined) return false;
  const stem = matched ? fileName.slice(0, -matched.length) : fileName;
  if (stem.length === 0) return false;
  // 主干不合法的文件不入包：既不该被带到别的机器，也不该在那边被写出来。
  if (source.isValidStem && !source.isValidStem(stem)) return false;
  return true;
}

/** 相对路径逐段校验：zip 条目名与备份包内容都是外部输入，任何一段越界都拒收。 */
function isSafeRelativePath(relativePath: string): boolean {
  if (relativePath.length === 0) return false;
  for (const segment of relativePath.split("/")) {
    if (segment.length === 0 || segment === "." || segment === "..") return false;
    if (segment.includes("\\") || segment.includes("\u0000")) return false;
  }
  return true;
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
      for (const [relativePath, text] of Object.entries(collected.directoryFiles)) {
        if (!isSafeRelativePath(relativePath)) continue;
        // 非递归条目拒收嵌套路径：同步范围里根本没有那一层，写出去只会成为
        // 「agent 读不到、用户也看不见」的孤儿文件，顺带给了恶意备份包建目录的能力。
        if (!source.recursive && relativePath.includes("/")) continue;
        const fileName = relativePath.slice(relativePath.lastIndexOf("/") + 1);
        if (!isAcceptedFileName(fileName, source)) continue;
        await writeTextAtomic(join(dir, relativePath), text);
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
