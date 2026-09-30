import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FORK_TOOL_MODE_STATE_FILENAME } from "@zcode/shared";

import { resolveForkToolMode } from "../src/fork/tool-modes.js";

async function withRoot<T>(
  state: unknown | undefined,
  run: (storageRoot: string) => Promise<T>,
): Promise<T> {
  const storageRoot = await mkdtemp(join(tmpdir(), "fork-tool-mode-"));
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

test("没有状态文件时不下发名单：等价于本功能不存在", async () => {
  await withRoot(undefined, async (storageRoot) => {
    const resolved = await resolveForkToolMode({ storageRoot, hostAllowlist: ["Read", "Bash"] });
    assert.equal(resolved.mode, "standard");
    assert.equal(resolved.injectTools, true);
    // undefined = 不动宿主名单（宿主可能为 CUA 等会话下发了自己的白名单）。
    assert.equal(resolved.toolAllowlist, undefined);
  });
});

test("极简档下发那 8 个；与宿主名单取交集，永不变大", async () => {
  await withRoot({ schemaVersion: 1, injectTools: true, mode: "minimal" }, async (storageRoot) => {
    const resolved = await resolveForkToolMode({ storageRoot });
    assert.equal(resolved.toolAllowlist?.length, 8);
    assert.ok(resolved.toolAllowlist?.includes("Read"));

    const narrowed = await resolveForkToolMode({ storageRoot, hostAllowlist: ["Read", "Bash"] });
    assert.deepEqual(narrowed.toolAllowlist, ["Read", "Bash"]);
  });
});

test("关闭注入下发空名单：一条工具都不注册（MCP 同样为空）", async () => {
  await withRoot(
    { schemaVersion: 1, injectTools: false, mode: "standard" },
    async (storageRoot) => {
      const resolved = await resolveForkToolMode({ storageRoot, hostAllowlist: ["Read"] });
      assert.deepEqual(resolved.toolAllowlist, []);
      assert.equal(resolved.injectTools, false);
    },
  );
});

test("标准档不下发：保持宿主既有名单", async () => {
  await withRoot({ schemaVersion: 1, injectTools: true, mode: "standard" }, async (storageRoot) => {
    const resolved = await resolveForkToolMode({ storageRoot, hostAllowlist: ["Read"] });
    assert.equal(resolved.toolAllowlist, undefined);
  });
});

test("状态文件损坏时回落标准档，不误伤工具面", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "fork-tool-mode-bad-"));
  try {
    await writeFile(join(storageRoot, FORK_TOOL_MODE_STATE_FILENAME), "{ not json", "utf8");
    const resolved = await resolveForkToolMode({ storageRoot });
    assert.equal(resolved.mode, "standard");
    assert.equal(resolved.toolAllowlist, undefined);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});
