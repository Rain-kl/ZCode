import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join, resolve, win32 } from "node:path";
import {
  ZCODE_AGENT_RUNTIME,
  resolveForkSearchProvidersFilePath,
} from "@zcode/shared";
import { FORK_WEBDAV_SYNC_MANIFEST } from "../src/host/fork/webdav-sync/manifest.js";

test("搜索渠道文件在同步清单里，且声明了新 base", () => {
  const entry = FORK_WEBDAV_SYNC_MANIFEST.find((item) => item.archiveName === "cli-fork/settings.json");
  assert.ok(entry, "缺少 cli-fork/settings.json 同步条目");
  assert.deepEqual(entry.source, {
    type: "file-json",
    base: "cliConfigDir",
    path: "fork/settings.json",
  });
});

test("cliConfigDir 拼接后与 resolveForkSearchProvidersFilePath 解析到同一个绝对路径", () => {
  const entry = FORK_WEBDAV_SYNC_MANIFEST.find((item) => item.archiveName === "cli-fork/settings.json");
  assert.ok(entry, "缺少 cli-fork/settings.json 同步条目");
  assert.equal(entry.source.type, "file-json");
  if (entry.source.type === "file-json") {
    const home = homedir();
    const resolvedCliBase = join(home, ZCODE_AGENT_RUNTIME.nativeConfigDir);
    const fullPath = join(resolvedCliBase, entry.source.path);
    // 跨平台比对前用 resolve 归一化，避免 Windows 下斜杠与反斜杠混合导致字符串全等失败
    assert.equal(resolve(fullPath), resolve(resolveForkSearchProvidersFilePath(home)));
  }
});

test("Windows 路径分隔符下归一化后指向同一个绝对路径（模拟 Windows 跨平台契约）", () => {
  const winHome = "C:\\Users\\testuser";
  const winCliBase = win32.join(winHome, ZCODE_AGENT_RUNTIME.nativeConfigDir);
  const winFullPath = win32.join(winCliBase, "fork/settings.json");
  const winSharedPath = resolveForkSearchProvidersFilePath(winHome);
  // resolveForkSearchProvidersFilePath 内部使用 "/" 拼接以兼容浏览器环境
  assert.notEqual(winFullPath, winSharedPath, "未经 resolve 归一化时在 Windows 语义下混合分隔符不直接字符串相等");
  assert.equal(win32.resolve(winFullPath), win32.resolve(winSharedPath), "经 resolve 归一化后路径语义完全一致");
});
