import { appendFile, chmod, mkdir, readdir, rm, stat } from "node:fs/promises";
import { inspect } from "node:util";
import { join } from "node:path";
import type { ServerCloudWebAccessLayout } from "./contract.js";

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const RETAIN_LOG_DAYS = 7;
const SENSITIVE_TEXT = [
  /(authorization\s*[:=]\s*bearer\s+)[^\s,}"]+/giu,
  /([?&](?:token|access_token|api_key)=)[^&\s"]+/giu,
  /((?:password|sessionToken|apiKey)["']?\s*[:=]\s*["']?)[^"'\s,}]+/giu,
  /((?:cookie|set-cookie)\s*[:=]\s*)[^\r\n]+/giu,
];

function day(value = new Date()): string {
  return value.toISOString().slice(0, 10);
}

function redact(value: string): string {
  return SENSITIVE_TEXT.reduce((result, pattern) => result.replace(pattern, "$1[REDACTED]"), value);
}

function formatArgument(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  return inspect(value, { depth: 5, breakLength: Infinity, compact: true });
}

async function pruneLogs(layout: ServerCloudWebAccessLayout): Promise<void> {
  const threshold = Date.now() - RETAIN_LOG_DAYS * 24 * 60 * 60 * 1_000;
  let entries: string[];
  try {
    entries = await readdir(layout.logsDir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  await Promise.all(
    entries
      .filter((name) => /^server-\d{4}-\d{2}-\d{2}\.log$/u.test(name))
      .map(async (name) => {
        const path = join(layout.logsDir, name);
        if ((await stat(path)).mtimeMs < threshold) await rm(path, { force: true });
      }),
  );
}

/**
 * 安装在 Supervisor/Core 进程入口，ServiceLogger 继续写 console；这里把同一事实流
 * 原子排队到 canonical server-root 日志。失败仍交给原 console，不能递归写自身。
 */
export async function installPersistentServerLogger(
  layout: ServerCloudWebAccessLayout,
): Promise<() => Promise<void>> {
  await mkdir(layout.logsDir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(layout.logsDir, 0o700);
  await pruneLogs(layout);
  const originals = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };
  let queue = Promise.resolve();
  let installed = true;
  const write = (level: "INFO" | "WARN" | "ERROR" | "DEBUG", args: unknown[]): void => {
    const original =
      level === "ERROR"
        ? originals.error
        : level === "WARN"
          ? originals.warn
          : level === "DEBUG"
            ? originals.debug
            : originals.log;
    const rendered = redact(args.map(formatArgument).join(" "));
    original(rendered);
    if (!installed) return;
    const line = `${new Date().toISOString()} ${level} ${rendered}\n`;
    queue = queue.then(async () => {
      const path = join(layout.logsDir, `server-${day()}.log`);
      try {
        const currentSize = await stat(path).then(
          (entry) => entry.size,
          () => 0,
        );
        if (currentSize + Buffer.byteLength(line) > MAX_LOG_BYTES) {
          originals.warn("ZCode Server log reached the daily size limit; dropping this entry");
          return;
        }
        await appendFile(path, line, { encoding: "utf8", mode: 0o600 });
        if (process.platform !== "win32") await chmod(path, 0o600);
      } catch (error) {
        originals.error("Failed to persist ZCode Server log", error);
      }
    });
  };
  console.log = (...args) => write("INFO", args);
  console.warn = (...args) => write("WARN", args);
  console.error = (...args) => write("ERROR", args);
  console.debug = (...args) => write("DEBUG", args);
  return async () => {
    installed = false;
    console.log = originals.log;
    console.warn = originals.warn;
    console.error = originals.error;
    console.debug = originals.debug;
    await queue;
  };
}
