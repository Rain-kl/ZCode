import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FORK_TOOL_MODE_STATE_FILENAME } from "@zcode/shared";

import { createFileForkToolModePort } from "../src/fork/tool-modes/file-port.js";

async function withRoot<T>(
  state: unknown | undefined,
  run: (storageRoot: string) => Promise<T>,
): Promise<T> {
  const storageRoot = await mkdtemp(join(tmpdir(), "fork-tool-mode-port-"));
  try {
    if (state !== undefined) {
      await writeFile(
        join(storageRoot, FORK_TOOL_MODE_STATE_FILENAME),
        JSON.stringify(state, null, 2),
        "utf8",
      );
    }
    return await run(storageRoot);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
}

test("没有状态文件：标准档，名单等于宿主名单（未启用不产生诊断）", async () => {
  await withRoot(undefined, async (storageRoot) => {
    const port = createFileForkToolModePort({
      root: storageRoot,
      hostAllowlist: ["Read", "Bash"],
    });
    const outcome = await port.loadActive();
    assert.equal(outcome.mode, "standard");
    assert.equal(outcome.injectTools, true);
    // 「最终值」语义：标准档 = 不加档位约束，名单就是宿主下发的名单本身。
    assert.deepEqual(outcome.toolAllowlist, ["Read", "Bash"]);
    assert.equal(outcome.diagnostic, undefined);
  });
});

test("没有状态文件且宿主没有名单：不下发任何约束", async () => {
  await withRoot(undefined, async (storageRoot) => {
    const outcome = await createFileForkToolModePort({ root: storageRoot }).loadActive();
    assert.equal(outcome.mode, "standard");
    assert.equal(outcome.toolAllowlist, undefined);
  });
});

test("极简档：下发那 8 个；与宿主名单取交集，永不变大", async () => {
  await withRoot({ schemaVersion: 1, injectTools: true, mode: "minimal" }, async (storageRoot) => {
    const plain = await createFileForkToolModePort({ root: storageRoot }).loadActive();
    assert.equal(plain.mode, "minimal");
    assert.equal(plain.injectTools, true);
    assert.equal(plain.toolAllowlist?.length, 8);
    assert.ok(plain.toolAllowlist?.includes("Read"));

    const narrowed = await createFileForkToolModePort({
      root: storageRoot,
      hostAllowlist: ["Read", "Bash"],
    }).loadActive();
    assert.deepEqual(narrowed.toolAllowlist, ["Read", "Bash"]);
  });
});

test("关闭注入：空名单压过宿主名单，一条工具都不注册", async () => {
  await withRoot(
    { schemaVersion: 1, injectTools: false, mode: "standard" },
    async (storageRoot) => {
      const outcome = await createFileForkToolModePort({
        root: storageRoot,
        hostAllowlist: ["Read"],
      }).loadActive();
      assert.equal(outcome.mode, "standard");
      assert.equal(outcome.injectTools, false);
      assert.deepEqual(outcome.toolAllowlist, []);
    },
  );
});

test("标准档：名单等于宿主名单（/reload 切回标准时据此恢复约束）", async () => {
  await withRoot({ schemaVersion: 1, injectTools: true, mode: "standard" }, async (storageRoot) => {
    const withHost = await createFileForkToolModePort({
      root: storageRoot,
      hostAllowlist: ["Read"],
    }).loadActive();
    assert.equal(withHost.mode, "standard");
    assert.deepEqual(withHost.toolAllowlist, ["Read"]);

    const withoutHost = await createFileForkToolModePort({ root: storageRoot }).loadActive();
    assert.equal(withoutHost.toolAllowlist, undefined);
  });
});

test("状态文件损坏：标准档 + 宿主名单，并给出诊断", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "fork-tool-mode-bad-"));
  try {
    await writeFile(join(storageRoot, FORK_TOOL_MODE_STATE_FILENAME), "{ not json", "utf8");
    const outcome = await createFileForkToolModePort({
      root: storageRoot,
      hostAllowlist: ["Read"],
    }).loadActive();
    assert.equal(outcome.mode, "standard");
    assert.deepEqual(outcome.toolAllowlist, ["Read"]);
    assert.match(outcome.diagnostic ?? "", /JSON/);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test("状态文件读不动（路径是目录）：标准档 + 诊断，绝不抛出", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "fork-tool-mode-dir-"));
  try {
    await mkdir(join(storageRoot, FORK_TOOL_MODE_STATE_FILENAME));
    const outcome = await createFileForkToolModePort({ root: storageRoot }).loadActive();
    assert.equal(outcome.mode, "standard");
    assert.equal(outcome.injectTools, true);
    assert.match(outcome.diagnostic ?? "", /读取失败/);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test("状态文件缺字段：按契约缺省（注入开启 + 标准档）", async () => {
  await withRoot({ schemaVersion: 1 }, async (storageRoot) => {
    const outcome = await createFileForkToolModePort({ root: storageRoot }).loadActive();
    assert.equal(outcome.mode, "standard");
    assert.equal(outcome.injectTools, true);
    assert.equal(outcome.toolAllowlist, undefined);
  });
});
