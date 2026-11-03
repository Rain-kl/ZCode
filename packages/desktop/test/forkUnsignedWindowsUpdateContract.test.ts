import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Windows 更新不以 Authenticode 为准入条件，发布签名能力仍保留", async () => {
  const updater = await readFile(new URL("../src/main/autoUpdater.ts", import.meta.url), "utf8");
  const config = await readFile(new URL("../electron-builder.config.js", import.meta.url), "utf8");
  assert.doesNotMatch(updater, /verifyWindowsAuthenticodeSignature|verifyUpdateCodeSignature/);
  assert.match(config, /verifyUpdateCodeSignature: false/);
  assert.match(config, /sign: "\.\/scripts\/sign-windows-hook\.cjs"/);
});
