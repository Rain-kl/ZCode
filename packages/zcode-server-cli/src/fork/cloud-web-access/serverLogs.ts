import { open, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  FollowServerLogsOptions,
  ServerCloudWebAccessLayout,
  ServerLogSnapshot,
} from "./contract.js";

const SERVER_LOG_FILE_PATTERN = /^server-\d{4}-\d{2}-\d{2}\.log$/u;
const FOLLOW_INTERVAL_MS = 250;

async function listServerLogFiles(layout: ServerCloudWebAccessLayout): Promise<string[]> {
  try {
    return (await readdir(layout.logsDir))
      .filter((name) => SERVER_LOG_FILE_PATTERN.test(name))
      .sort()
      .map((name) => join(layout.logsDir, name));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw new Error(`Failed to list server logs in ${layout.logsDir}`, { cause: error });
  }
}

function splitCompleteLines(content: string): string[] {
  const lines = content.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export async function readServerLogSnapshot(
  layout: ServerCloudWebAccessLayout,
  limit = 200,
): Promise<ServerLogSnapshot> {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 10_000) {
    throw new Error("Server log line limit must be between 1 and 10000");
  }
  const files = await listServerLogFiles(layout);
  const contents = new Map<string, string>();
  const offsets = new Map<string, number>();
  for (const path of files) {
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch (error) {
      throw new Error(`Failed to read server log ${path}`, { cause: error });
    }
    contents.set(path, content);
    offsets.set(path, Buffer.byteLength(content));
  }
  const collected: string[] = [];
  for (const path of [...files].reverse()) {
    collected.unshift(...splitCompleteLines(contents.get(path) ?? ""));
    if (collected.length >= limit) break;
  }
  return { lines: collected.slice(-limit), offsets };
}

export async function readServerLogTail(
  layout: ServerCloudWebAccessLayout,
  limit = 200,
): Promise<string[]> {
  return (await readServerLogSnapshot(layout, limit)).lines;
}

export async function followServerLogs(options: FollowServerLogsOptions): Promise<void> {
  const offsets = new Map(options.offsets);
  while (!options.signal.aborted) {
    const files = await listServerLogFiles(options.layout);
    for (const path of files) {
      let size: number;
      try {
        size = (await stat(path)).size;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
        throw new Error(`Failed to inspect server log ${path}`, { cause: error });
      }
      // Bug 原因：快照之后才创建的轮转文件不在 offsets 中，从 size 起步会漏掉首行；
      // 新文件必须从 0 读取，已知文件才沿用快照和上一轮 cursor。
      const previous = offsets.get(path) ?? 0;
      const start = size < previous ? 0 : previous;
      offsets.set(path, size);
      if (size <= start) continue;
      const handle = await open(path, "r");
      try {
        const buffer = Buffer.alloc(size - start);
        await handle.read(buffer, 0, buffer.length, start);
        for (const line of splitCompleteLines(buffer.toString("utf8"))) options.writeLine(line);
      } finally {
        await handle.close();
      }
    }
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        options.signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, FOLLOW_INTERVAL_MS);
      options.signal.addEventListener("abort", finish, { once: true });
    });
  }
}
