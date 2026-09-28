/**
 * WebDAV 备份包：命名、内容哈希规范化、zip 打包/解包、保留清理选择。
 *
 * 纯逻辑与 zip IO 放一处（zip 读写本身没有分支逻辑，单测用真实 zip 往返验证）。
 * 见 docs/features/local-mode/design.md 第 6.1 / 6.2 / 6.3 节。
 */
import { createHash } from "node:crypto";
import yauzl from "yauzl";
import yazl from "yazl";
import {
  FORK_WEBDAV_BACKUP_FILE_PATTERN,
  FORK_WEBDAV_BACKUP_FILE_PREFIX,
  FORK_WEBDAV_MANIFEST_FILE,
  FORK_WEBDAV_PROVIDER_CONFIG_FILE,
  FORK_WEBDAV_SETTING_FILE,
  type ForkWebdavBackupContent,
  type ForkWebdavBackupManifest,
} from "@zcode/shared";

/** 备份包 key 的时间戳格式：本地时间 `YYYYMMDD-HHmmss`（便于用户在文件管理器里辨认）。 */
function formatKeyStamp(date: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * 生成备份包文件名；同一秒重复上传时追加 `-1`、`-2`。
 * `existingKeys` 传远端已有 key 列表（首次登录远端为空时传空数组）。
 */
export function buildBackupKey(date: Date, existingKeys: readonly string[] = []): string {
  const base = `${FORK_WEBDAV_BACKUP_FILE_PREFIX}${formatKeyStamp(date)}`;
  const existing = new Set(existingKeys);
  let candidate = `${base}.zip`;
  let suffix = 1;
  while (existing.has(candidate)) {
    candidate = `${base}-${suffix}.zip`;
    suffix += 1;
  }
  return candidate;
}

export function isBackupKey(key: string): boolean {
  return FORK_WEBDAV_BACKUP_FILE_PATTERN.test(key);
}

/** 从 key 反解时间（用于缺少服务端 mtime 时的排序兜底）。 */
export function parseBackupKeyDate(key: string): Date | null {
  const match = /^zcode-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-\d+)?\.zip$/.exec(key);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

export interface RemoteBackupEntry {
  key: string;
  /** 服务端 mtime（PROPFIND getlastmodified）；缺失时用 key 解析兜底。 */
  lastModified?: string | null;
  size?: number;
}

function resolveEntryTime(entry: RemoteBackupEntry): number {
  if (entry.lastModified) {
    const parsed = Date.parse(entry.lastModified);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return parseBackupKeyDate(entry.key)?.getTime() ?? 0;
}

/** 备份包按时间倒序（新 → 旧）。
 *
 * 服务端 mtime 相同时（或缺失时）回退到 key 里解析出的时间，再回退到 key 字符串比较，
 * 保证同一份目录在不同机器/不同服务端上的排序结果一致——保留清理依赖这个顺序。
 */
export function sortBackupEntriesDesc<T extends RemoteBackupEntry>(entries: readonly T[]): T[] {
  const keyTime = (entry: RemoteBackupEntry) => parseBackupKeyDate(entry.key)?.getTime() ?? 0;
  return [...entries].sort((left, right) => {
    const byModified = resolveEntryTime(right) - resolveEntryTime(left);
    if (byModified !== 0) {
      return byModified;
    }
    const byKeyTime = keyTime(right) - keyTime(left);
    if (byKeyTime !== 0) {
      return byKeyTime;
    }
    return right.key < left.key ? -1 : right.key > left.key ? 1 : 0;
  });
}

/**
 * 保留策略：只保留最新 `limit` 份，返回需要删除的 key（旧 → 新）。
 * 只处理符合 `zcode-*.zip` 命名的对象，避免误删用户放在同目录的其他文件。
 */
export function selectKeysToPrune(entries: readonly RemoteBackupEntry[], limit: number): string[] {
  const backups = sortBackupEntriesDesc(entries.filter((entry) => isBackupKey(entry.key)));
  if (!Number.isFinite(limit) || limit < 0) {
    return [];
  }
  return backups
    .slice(limit)
    .map((entry) => entry.key)
    .reverse();
}

/** 递归按键名排序的稳定序列化，保证同样的内容在不同机器上得到同一个哈希。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

/** 内容哈希：setting 白名单 + provider_config 归一化后的 sha256（设计 6.2）。 */
export function normalizeContentHash(input: {
  setting: Record<string, unknown>;
  providerConfig: Record<string, unknown>;
}): string {
  return createHash("sha256")
    .update(
      stableStringify({ setting: input.setting, providerConfig: input.providerConfig }),
      "utf8",
    )
    .digest("hex");
}

/** 打包备份包（zip 内三份 JSON）。 */
export async function buildBackupZip(content: ForkWebdavBackupContent): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  const addJson = (fileName: string, value: unknown) => {
    zip.addBuffer(Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"), fileName);
  };
  addJson(FORK_WEBDAV_MANIFEST_FILE, content.manifest);
  addJson(FORK_WEBDAV_SETTING_FILE, content.setting);
  addJson(FORK_WEBDAV_PROVIDER_CONFIG_FILE, content.providerConfig);

  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.end();
  });
}

function parseJsonEntry(fileName: string, buffer: Buffer | undefined): Record<string, unknown> {
  if (!buffer) {
    throw new Error(`备份包缺少 ${fileName}`);
  }
  try {
    const parsed = JSON.parse(buffer.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`备份包内 ${fileName} 不是 JSON 对象`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`备份包内 ${fileName} 解析失败: ${(error as Error).message}`);
  }
}

/** 解包并校验备份包。 */
export async function readBackupZip(buffer: Buffer): Promise<ForkWebdavBackupContent> {
  const zipFile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, file) =>
      error ? reject(error) : resolve(file),
    );
  });

  const entries = new Map<string, Buffer>();
  await new Promise<void>((resolve, reject) => {
    zipFile.on("entry", (entry: yauzl.Entry) => {
      if (entry.fileName.endsWith("/")) {
        zipFile.readEntry();
        return;
      }
      zipFile.openReadStream(entry, (error, stream) => {
        if (error) {
          reject(error);
          return;
        }
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          entries.set(entry.fileName, Buffer.concat(chunks));
          zipFile.readEntry();
        });
        stream.on("error", reject);
      });
    });
    zipFile.on("end", () => resolve());
    zipFile.on("error", reject);
    zipFile.readEntry();
  });

  const manifest = parseJsonEntry(
    FORK_WEBDAV_MANIFEST_FILE,
    entries.get(FORK_WEBDAV_MANIFEST_FILE),
  );
  if (manifest.schemaVersion !== 1) {
    throw new Error(`不支持的备份包 schemaVersion: ${String(manifest.schemaVersion)}`);
  }
  return {
    manifest: manifest as unknown as ForkWebdavBackupManifest,
    setting: parseJsonEntry(FORK_WEBDAV_SETTING_FILE, entries.get(FORK_WEBDAV_SETTING_FILE)),
    providerConfig: parseJsonEntry(
      FORK_WEBDAV_PROVIDER_CONFIG_FILE,
      entries.get(FORK_WEBDAV_PROVIDER_CONFIG_FILE),
    ),
  };
}
