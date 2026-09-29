/**
 * fork（edit-stale-guard）：Edit / Write 的 stale 判据由 mtime+size 换成内容哈希。
 *
 * 两个决定性场景（都通过真实 handler 驱动，不是模型化重写判据）：
 * 1. 误报：Read 只读了 range（offset/limit），另一进程/格式化器只推进了 mtime，字节未变。
 *    上游判据里 `isStrictFullRead` 为假 ⇒ 内容豁免不可用 ⇒ 报 stale；hash 相同则应放行。
 * 2. 漏报：`cp -p` / `tar -x` 这类保留时间戳的写入改了字节，但 mtime 与 size 都不变。
 *    上游判据的 `mtimeAdvanced || sizeChanged` 为假 ⇒ 直接返回「未变」且不比对内容 ⇒ 静默覆盖；
 *    hash 不同则应报 stale。
 * 两个场景都先在旧实现上复现过（见 docs/features/edit-stale-guard/implementation.md 的验证记录）。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";

import {
  EditErrorCode,
  type FileSystemPort,
  type FileSystemReadTextResult,
  type FileSystemStatResult,
} from "@zcode/contracts";

import { resolveStalenessByContentHash } from "../src/fork/edit-stale-guard/hash-staleness.js";
import { editToolEntry } from "../src/tool/handlers/edit.js";
import { writeToolEntry } from "../src/tool/handlers/write.js";
import type {
  ReadFileStateEntry,
  ReadFileStateMap,
  ToolExecutionContext,
} from "../src/tool/types.js";

const WORKSPACE = "/workspace";
const FILE_PATH = join(WORKSPACE, "notes.md");
const RECORDED_MTIME_MS = 1_000;
// 判据契约是「同一份字节同一个字符串」，所以测试自己算一遍 sha256，不复用实现里的 helper：
// 前缀或算法漂移必须在这里露出来。
function contentHashOf(text: string): string {
  return `sha256:${createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")}`;
}

interface FakeFile {
  content: string;
  lineEndings: "LF" | "CRLF";
  mtimeMs: number;
}

function createFakeFileSystemPort(file: FakeFile): {
  port: FileSystemPort;
  writtenContents: string[];
} {
  const writtenContents: string[] = [];
  const sizeBytes = (): number => Buffer.byteLength(file.content, "utf8");
  const revision = () => ({
    id: `mtime:${Math.trunc(file.mtimeMs)}:size:${sizeBytes()}`,
    mtimeMs: file.mtimeMs,
    sizeBytes: sizeBytes(),
    hash: contentHashOf(file.content),
  });

  const port = {
    stat: async (): Promise<FileSystemStatResult> => ({
      path: FILE_PATH,
      kind: "file",
      sizeBytes: sizeBytes(),
      mtimeMs: file.mtimeMs,
      revision: revision(),
    }),
    readTextFile: async (): Promise<FileSystemReadTextResult> => ({
      path: FILE_PATH,
      // 端口契约：content 已归一成 LF，原始行尾只在 lineEndings 里；假端口必须照此返回，
      // 否则测试会自己造出上游并不存在的「行尾不一致」。
      content: file.content,
      encoding: "utf8",
      lineEndings: file.lineEndings,
      bytesRead: sizeBytes(),
      sizeBytes: sizeBytes(),
      truncated: false,
      revision: revision(),
    }),
    writeTextFile: async (request: { content: string; path: string }) => {
      writtenContents.push(request.content);
      file.content = request.content;
      file.mtimeMs += 1;
      return { path: FILE_PATH, bytesWritten: sizeBytes(), revision: revision() };
    },
  };

  return { port: port as unknown as FileSystemPort, writtenContents };
}

function createReadStateEntry(overrides: Partial<ReadFileStateEntry> = {}): ReadFileStateMap {
  const entry: ReadFileStateEntry = {
    path: FILE_PATH,
    content: "line one\n",
    offset: undefined,
    limit: undefined,
    isPartialView: false,
    readAt: new Date(RECORDED_MTIME_MS),
    sourceTool: "Read",
    revisionId: `mtime:${RECORDED_MTIME_MS}:size:9`,
    mtimeMs: RECORDED_MTIME_MS,
    sizeBytes: 9,
    contentHash: contentHashOf("line one\n"),
    ...overrides,
  };
  return new Map([[`${FILE_PATH}\0${entry.offset ?? 1}\0${entry.limit ?? ""}`, entry]]);
}

function createContext(
  port: FileSystemPort,
  readFileState: ReadFileStateMap,
): ToolExecutionContext {
  return {
    abortSignal: new AbortController().signal,
    fileSystemPort: port,
    readFileState,
    toolCallId: "tool-call-1",
    traceId: "trace-1" as ToolExecutionContext["traceId"],
    workingDirectory: WORKSPACE,
    workspaceRoot: WORKSPACE,
  };
}

function editInput(oldString: string, newString: string): unknown {
  return { file_path: FILE_PATH, old_string: oldString, new_string: newString };
}

test("内容哈希判据：一致为 fresh，不一致为 stale，缺任一侧为 unknown", () => {
  assert.equal(
    resolveStalenessByContentHash({ recordedHash: "sha256:a", currentHash: "sha256:a" }),
    "fresh",
  );
  assert.equal(
    resolveStalenessByContentHash({ recordedHash: "sha256:a", currentHash: "sha256:b" }),
    "stale",
  );
  assert.equal(
    resolveStalenessByContentHash({ recordedHash: undefined, currentHash: "sha256:b" }),
    "unknown",
  );
  assert.equal(
    resolveStalenessByContentHash({ recordedHash: "sha256:a", currentHash: undefined }),
    "unknown",
  );
  assert.equal(resolveStalenessByContentHash({}), "unknown");
});

test("Edit 误报：range Read + mtime 前进 + 字节未变 → 放行", async () => {
  const file: FakeFile = {
    // 行尾 CRLF 也是真实的：端口读回按契约归一成 LF，hash 按磁盘原始字节算。
    content: "line one\r\nline two\r\n",
    lineEndings: "CRLF",
    // mtime 已前进（格式化器/IDE 保存/另一会话），但字节与读取时完全相同。
    mtimeMs: RECORDED_MTIME_MS + 5_000,
  };
  const { port, writtenContents } = createFakeFileSystemPort(file);
  const readFileState = createReadStateEntry({
    content: "line one\n",
    offset: 1,
    limit: 1,
    sizeBytes: Buffer.byteLength(file.content, "utf8"),
    contentHash: contentHashOf(file.content),
  });

  const output = (await editToolEntry.handler(
    editInput("line two", "line 2"),
    createContext(port, readFileState),
  )) as { result?: false; errorCode?: number; newString?: string };

  assert.notEqual(output.result, false, `不应报 stale，实际 errorCode=${output.errorCode}`);
  assert.equal(writtenContents.length, 1);
  assert.match(writtenContents[0]!, /line 2/);
});

test("Edit 漏报：mtime 与 size 都不变但字节变了 → 报 stale", async () => {
  const file: FakeFile = {
    content: "line one\nline three\n",
    lineEndings: "LF",
    mtimeMs: RECORDED_MTIME_MS,
  };
  const { port, writtenContents } = createFakeFileSystemPort(file);
  // `cp -p` / `tar -x`：字节变了，mtime 与 size 都没变（revisionId 因此也相同）。
  // edit.ts 的旧判据只看 mtime 是否严格前进 + size，未前进就直接放行、不比对内容。
  const readFileState = createReadStateEntry({
    content: "line one\nline two\n",
    sizeBytes: Buffer.byteLength(file.content, "utf8"),
    revisionId: `mtime:${RECORDED_MTIME_MS}:size:${Buffer.byteLength(file.content, "utf8")}`,
    contentHash: contentHashOf("line one\nline two\n"),
  });

  const output = (await editToolEntry.handler(
    editInput("line two", "line 2"),
    createContext(port, readFileState),
  )) as { result?: false; errorCode?: number };

  assert.equal(output.result, false);
  assert.equal(output.errorCode, EditErrorCode.STALE_FILE);
  assert.equal(writtenContents.length, 0, "判 stale 时不得写盘");
});

test("Edit 缺 hash：回落 mtime/size，行为与改动前一致", async () => {
  const file: FakeFile = {
    content: "line one\r\nline two\r\n",
    lineEndings: "CRLF",
    mtimeMs: RECORDED_MTIME_MS + 5_000,
  };
  const { port, writtenContents } = createFakeFileSystemPort(file);
  // resume 从历史 metadata 恢复的 read-state 没有 hash（不扩 schema），必须仍走旧判据：
  // range Read + mtime 前进 ⇒ 旧判据报 stale，与改动前完全一致。
  const readFileState = createReadStateEntry({
    content: "line one\n",
    offset: 1,
    limit: 1,
    sizeBytes: Buffer.byteLength(file.content, "utf8"),
    contentHash: undefined,
  });

  const output = (await editToolEntry.handler(
    editInput("line two", "line 2"),
    createContext(port, readFileState),
  )) as { result?: false; errorCode?: number };

  assert.equal(output.result, false);
  assert.equal(output.errorCode, EditErrorCode.STALE_FILE);
  assert.equal(writtenContents.length, 0);
});

test("Edit 缺 hash + mtime 未前进 + size 相同 → 回落旧判据放行", async () => {
  const file: FakeFile = { content: "line one\n", lineEndings: "LF", mtimeMs: 1_000 };
  const { port, writtenContents } = createFakeFileSystemPort(file);
  const readFileState = createReadStateEntry({
    content: "line one\n",
    contentHash: undefined,
    revisionId: "mtime:1000:size:9",
  });

  const output = (await editToolEntry.handler(
    editInput("line one", "line 1"),
    createContext(port, readFileState),
  )) as { result?: false; errorCode?: number };

  assert.notEqual(output.result, false, `旧判据本应放行，实际 errorCode=${output.errorCode}`);
  assert.equal(writtenContents.length, 1);
});

test("Edit 不完整视图仍先拒：partial view 即使 hash 相同也报 FILE_NOT_READ", async () => {
  const file: FakeFile = { content: "line one\n", lineEndings: "LF", mtimeMs: 1_000 };
  const { port, writtenContents } = createFakeFileSystemPort(file);
  const readFileState = createReadStateEntry({
    content: "line on",
    isPartialView: true,
    contentHash: contentHashOf(file.content),
  });

  const output = (await editToolEntry.handler(
    editInput("line one", "line 1"),
    createContext(port, readFileState),
  )) as { result?: false; errorCode?: number };

  assert.equal(output.result, false);
  assert.equal(output.errorCode, EditErrorCode.FILE_NOT_READ);
  assert.equal(writtenContents.length, 0);
});

test("Write 误报：range Read + mtime 前进 + 字节未变 → 放行", async () => {
  const file: FakeFile = {
    content: "line one\r\nline two\r\n",
    lineEndings: "CRLF",
    mtimeMs: RECORDED_MTIME_MS + 5_000,
  };
  const { port, writtenContents } = createFakeFileSystemPort(file);
  const readFileState = createReadStateEntry({
    content: "line one\n",
    offset: 1,
    limit: 1,
    sizeBytes: Buffer.byteLength(file.content, "utf8"),
    contentHash: contentHashOf(file.content),
  });

  const output = (await writeToolEntry.handler(
    { file_path: FILE_PATH, content: "line one\nline 2\n" },
    createContext(port, readFileState),
  )) as { type?: string };

  assert.equal(output.type, "update");
  assert.equal(writtenContents.length, 1);
});

test("Write 漏报：range Read + mtime 与 size 都不变但字节变了 → 报 write_file_stale", async () => {
  const file: FakeFile = {
    content: "line one\nline three\n",
    lineEndings: "LF",
    mtimeMs: RECORDED_MTIME_MS,
  };
  const { port, writtenContents } = createFakeFileSystemPort(file);
  // `cp -p` / `tar -x`：字节变了，mtime 与 size 都没变（revisionId 因此也相同）。
  // range 视图（offset/limit）拿不到 write.ts 旧判据最后那道整文件内容比对，旧实现直接放行。
  const readFileState = createReadStateEntry({
    content: "line one\n",
    offset: 1,
    limit: 1,
    sizeBytes: Buffer.byteLength(file.content, "utf8"),
    revisionId: `mtime:${RECORDED_MTIME_MS}:size:${Buffer.byteLength(file.content, "utf8")}`,
    contentHash: contentHashOf("line one\nline two\n"),
  });

  await assert.rejects(
    writeToolEntry.handler(
      { file_path: FILE_PATH, content: "line one\nline 2\n" },
      createContext(port, readFileState),
    ),
    (error: { context?: Record<string, unknown> }) => {
      assert.equal(error.context?.code, "write_file_stale");
      return true;
    },
  );
  assert.equal(writtenContents.length, 0, "判 stale 时不得写盘");
});
