import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
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
    assert.equal(fullPath, resolveForkSearchProvidersFilePath(home));
  }
});
