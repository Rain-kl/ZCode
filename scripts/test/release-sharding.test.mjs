import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { createVitest } from "vitest/node";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "../..");
const workflow = parse(await readFile(resolve(root, ".github/workflows/release.yml"), "utf8"));

test(
  "installed Vitest shards cover exactly the unsharded project/file set without executing tests",
  { timeout: 120_000 },
  async (t) => {
    const indices = workflow.jobs["unit-tests"].strategy.matrix.shard;
    assert.deepEqual(indices, [1, 2, 3, 4]);
    async function discover(shard) {
      const context = await createVitest("test", {
        root,
        watch: false,
        shard,
        exclude: ["packages/desktop/test/e2e/**/*.test.ts"],
      });
      try {
        const isolated = context.projects.find((project) => project.name === "fork-isolated");
        assert.ok(isolated);
        assert.equal(isolated.config.pool, "forks");
        assert.equal(isolated.config.fileParallelism, false);
        assert.equal(isolated.config.maxWorkers, 1);
        let specs = await context.getRelevantTestSpecifications();
        if (shard) {
          // filesOnly 的 list 只做发现，不应用 --shard；使用执行池相同的真实 sequencer 验证分片契约。
          const sequencer = new context.config.sequence.sequencer(context);
          specs = await sequencer.shard(specs);
        }
        return specs.map((spec) => `${spec.project.name}:${spec.moduleId}`).sort();
      } finally {
        await context.close();
      }
    }
    const all = await discover();
    assert.ok(all.length > 0);
    for (const project of ["unit", "fork-isolated", "cua-placeholder"]) {
      assert.ok(
        all.some((key) => key.startsWith(`${project}:`)),
        project,
      );
    }
    const partition = [];
    for (const index of indices) {
      const shard = await discover(`${index}/${indices.length}`);
      assert.ok(shard.length > 0, `shard ${index}`);
      t.diagnostic(`shard ${index}/${indices.length}: ${shard.length} project/files`);
      partition.push(...shard);
    }
    assert.equal(new Set(partition).size, partition.length, "shards must not repeat project/files");
    assert.deepEqual(partition.sort(), all, "no project/file may be dropped");
    t.diagnostic(`complete selection: ${all.length} project/files, no duplicates or omissions`);
  },
);
