import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FORK_IDENTITY_PRESET_CONTENT_MAX_LENGTH,
  FORK_IDENTITY_PRESET_DEFAULT_TEMPLATE,
} from "@zcode/shared";

import {
  IdentityPresetStoreError,
  createFileIdentityPresetStore,
} from "../src/host/fork/identity-preset/profile-store.js";

async function createRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "identity-preset-store-"));
}

test("新建后可列出与读取，写盘文本与 agent 侧格式一致", async () => {
  const root = await createRoot();
  const store = createFileIdentityPresetStore({ root });

  const { id } = await store.create({ name: "极简风格", template: "default" });

  assert.deepEqual(await store.list(), [{ id, name: "极简风格" }]);
  const profile = await store.read(id);
  assert.equal(profile.name, "极简风格");
  assert.equal(profile.content, FORK_IDENTITY_PRESET_DEFAULT_TEMPLATE);

  const text = await readFile(join(root, "profiles", `${id}.md`), "utf8");
  assert.match(text, /^---\nname: 极简风格\n---\n\n/);
});

test("同名新建绝不覆盖已有配置", async () => {
  const root = await createRoot();
  const store = createFileIdentityPresetStore({ root });

  const first = await store.create({ name: "a b", template: "skeleton" });
  await store.save({ id: first.id, name: "a b", content: "第一次的内容" });
  const second = await store.create({ name: "a-b", template: "skeleton" });

  assert.notEqual(second.id, first.id);
  // slug 冲突时退让成 -2，而不是复用同一个文件
  assert.equal(second.id, `${first.id}-2`);
  assert.equal((await store.read(first.id)).content, "第一次的内容");
});

test("Windows 保留设备名不会被分配成 id", async () => {
  const root = await createRoot();
  const store = createFileIdentityPresetStore({ root });

  const { id } = await store.create({ name: "NUL", template: "skeleton" });

  assert.notEqual(id, "nul");
  assert.match(id, /^nul-2$/);
});

test("名称含换行时归一化后再落盘，不破坏 frontmatter", async () => {
  const root = await createRoot();
  const store = createFileIdentityPresetStore({ root });

  const { id } = await store.create({ name: "极简\n风格", template: "skeleton" });
  const text = await readFile(join(root, "profiles", `${id}.md`), "utf8");

  assert.match(text, /^---\nname: 极简 风格\n---\n/);
  assert.equal((await store.read(id)).name, "极简 风格");
});

test("超长正文与空名称都被拒绝", async () => {
  const root = await createRoot();
  const store = createFileIdentityPresetStore({ root });

  await assert.rejects(
    () => store.create({ name: "  ", template: "skeleton" }),
    (error: unknown) => error instanceof IdentityPresetStoreError,
  );
  const { id } = await store.create({ name: "长正文", template: "skeleton" });
  await assert.rejects(
    () =>
      store.save({
        id,
        name: "长正文",
        content: "x".repeat(FORK_IDENTITY_PRESET_CONTENT_MAX_LENGTH + 1),
      }),
    /超过上限/,
  );
});

test("开关与激活项写入 active.json 并可读回", async () => {
  const root = await createRoot();
  const store = createFileIdentityPresetStore({ root });
  const { id } = await store.create({ name: "concise", template: "skeleton" });

  await store.setEnabled(true);
  await store.activate(id);
  assert.deepEqual(await store.readState(), { schemaVersion: 1, enabled: true, activeId: id });
});

test("删除正在激活的配置会同时清空 activeId", async () => {
  const root = await createRoot();
  const store = createFileIdentityPresetStore({ root });
  const { id } = await store.create({ name: "concise", template: "skeleton" });
  await store.setEnabled(true);
  await store.activate(id);

  await store.remove(id);

  assert.deepEqual(await store.list(), []);
  assert.deepEqual(await store.readState(), { schemaVersion: 1, enabled: true, activeId: null });
});

test("原子写不留下临时文件", async () => {
  const root = await createRoot();
  const store = createFileIdentityPresetStore({ root });
  const { id } = await store.create({ name: "concise", template: "skeleton" });
  await store.save({ id, name: "concise", content: "body" });

  const rootEntries = await readdir(root, { recursive: true });
  assert.equal(rootEntries.filter((entry) => entry.endsWith(".tmp")).length, 0);
});

test("目录不存在时按空配置处理，不报错", async () => {
  const store = createFileIdentityPresetStore({ root: join(tmpdir(), "identity-preset-absent") });

  assert.deepEqual(await store.list(), []);
  assert.deepEqual(await store.readState(), { schemaVersion: 1, enabled: false, activeId: null });
});

test("active.json 损坏时降级为未启用且不覆写用户文件", async () => {
  const root = await createRoot();
  await mkdir(root, { recursive: true });
  const statePath = join(root, "active.json");
  await writeFile(statePath, "{ not json", "utf8");

  const store = createFileIdentityPresetStore({ root });
  assert.deepEqual(await store.readState(), { schemaVersion: 1, enabled: false, activeId: null });
  assert.equal((await stat(statePath)).size, "{ not json".length);
});
