import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ForkSearchProvidersFile } from "@zcode/shared";
import { createForkSearchProvidersService } from "../src/host/fork/search-providers/service.js";
import { createForkSearchProvidersFileStore } from "../src/host/fork/search-providers/file-store.js";

function serviceAt(file: string) {
  return createForkSearchProvidersService({
    store: createForkSearchProvidersFileStore({ filePath: file }),
  });
}
const newFile = () => join(mkdtempSync(join(tmpdir(), "sp-")), "settings.json");

/** 用 assert.ok 收窄，替代非空断言——非空断言会把「渠道没被写进去」这类真实缺陷静音。 */
function channelIdAt(file: ForkSearchProvidersFile, index: number): string {
  const channel = file.channels[index];
  assert.ok(channel, `期望第 ${index + 1} 条渠道存在，实际只有 ${file.channels.length} 条`);
  return channel.id;
}
function labelsOf(file: ForkSearchProvidersFile): string[] {
  return file.channels.map((channel) => channel.label);
}

test("addChannel 生成 id 并落盘，list 读回同一份", async () => {
  const file = newFile();
  const service = serviceAt(file);
  await service.addChannel({ kind: "tavily", label: "工作用", apiKey: "tvly-1" });
  const listed = await service.list();
  assert.equal(listed.channels.length, 1);
  assert.equal(labelsOf(listed)[0], "工作用");
  assert.ok(channelIdAt(listed, 0).length > 0);
  assert.match(readFileSync(file, "utf8"), /tvly-1/);
});

test("reorder 按给定 id 顺序重排，未知 id 被忽略", async () => {
  const file = newFile();
  const service = serviceAt(file);
  const afterFirst = await service.addChannel({ kind: "tavily", label: "A", apiKey: "k" });
  const afterSecond = await service.addChannel({ kind: "tavily", label: "B", apiKey: "k" });
  const reordered = await service.reorder([
    channelIdAt(afterSecond, 1),
    channelIdAt(afterFirst, 0),
    "missing",
  ]);
  assert.deepEqual(labelsOf(reordered), ["B", "A"]);
  assert.equal(reordered.channels.length, 2, "未知 id 不得新增渠道");
});

test("updateChannel 能清空 key（用户合法状态），不删渠道", async () => {
  const file = newFile();
  const service = serviceAt(file);
  const added = await service.addChannel({ kind: "tavily", label: "A", apiKey: "k" });
  const updated = await service.updateChannel(channelIdAt(added, 0), { apiKey: "" });
  assert.equal(updated.channels.length, 1);
  assert.equal(updated.channels[0]?.apiKey, "");
});

test("removeChannel 移除目标；文件损坏时 list 返回 0 条而不抛错", async () => {
  const file = newFile();
  const service = serviceAt(file);
  const added = await service.addChannel({ kind: "tavily", label: "A", apiKey: "k" });
  const emptied = await service.removeChannel(channelIdAt(added, 0));
  assert.deepEqual(emptied.channels, []);

  writeFileSync(file, "{ broken", "utf8");
  assert.deepEqual((await service.list()).channels, []);
});

test("文件里保留未知版本时 list 不把旧渠道当作有效渠道", async () => {
  const file = newFile();
  writeFileSync(
    file,
    JSON.stringify({
      version: 99,
      channels: [{ id: "a", kind: "tavily", enabled: true, apiKey: "k" }],
    }),
    "utf8",
  );
  assert.deepEqual((await serviceAt(file).list()).channels, []);
});
