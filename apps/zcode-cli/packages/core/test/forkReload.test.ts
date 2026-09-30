import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FORK_TOOL_MODE_STATE_FILENAME } from "@zcode/shared";

import type { IdentityPresetPort } from "../src/fork/identity-preset/file-port.js";
import { createFileForkToolModePort } from "../src/fork/tool-modes/file-port.js";
import type { AgentRuntimeInternal } from "../src/runtime/internal.js";
import { reloadForkOverrides } from "../src/runtime/methods/reload.js";
import { resolveBuiltInToolAllowlist } from "../src/runtime/helpers/tool-allowlist.js";
import { createToolRegistry, registerBuiltInTools } from "../src/tool/index.js";

const MINIMAL_TOOL_NAMES = ["Bash", "Edit", "Glob", "Grep", "Read", "WebFetch", "WebSearch", "Write"];

interface FakeRuntimeOptions {
  toolModeRoot?: string;
  hostAllowlist?: readonly string[];
  identityPresetPort?: IdentityPresetPort;
  taskType?: string;
}

/**
 * 轻量假运行时：端口与注册表用真实实现，其余（messageHistory / logger / MCP / 前缀重建的
 * 依赖）用最小桩。reloadForkOverrides 只读 config、registry、两个端口与 cachedTools。
 */
function createFakeRuntime(options: FakeRuntimeOptions = {}): {
  runtime: AgentRuntimeInternal;
  warnings: Array<Record<string, unknown>>;
} {
  const registry = createToolRegistry();
  const warnings: Array<Record<string, unknown>> = [];
  const runtime = {
    config: {
      ...(options.taskType === undefined ? {} : { taskType: options.taskType }),
    } as AgentRuntimeInternal["config"],
    registry,
    cachedTools: null,
    messageHistory: { borrowReadOnlyRuntimeEntries: () => [] },
    logger: {
      info: () => {},
      warn: (_message: string, detail?: Record<string, unknown>) => {
        warnings.push(detail ?? {});
      },
    },
    identityPresetPort: options.identityPresetPort,
    forkToolModePort:
      options.toolModeRoot === undefined
        ? undefined
        : createFileForkToolModePort({
            root: options.toolModeRoot,
            ...(options.hostAllowlist === undefined
              ? {}
              : { hostAllowlist: options.hostAllowlist }),
          }),
    reregisterBuiltInTools: () => {
      registerBuiltInTools(registry, {
        allowedTools: resolveBuiltInToolAllowlist(runtime.config),
        silentDuplicateWarnings: true,
      });
    },
  };
  return { runtime: runtime as unknown as AgentRuntimeInternal, warnings };
}

const TRACE = { traceId: "trace-test", spanId: "span-test" } as never;

async function withToolModeState<T>(
  state: unknown,
  run: (root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "fork-reload-"));
  try {
    await writeFile(
      join(root, FORK_TOOL_MODE_STATE_FILENAME),
      typeof state === "string" ? state : JSON.stringify(state, null, 2),
      "utf8",
    );
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("极简 → 标准：被剃掉的工具恢复注册", async () => {
  await withToolModeState({ schemaVersion: 1, injectTools: true, mode: "standard" }, async (root) => {
    const { runtime } = createFakeRuntime({ toolModeRoot: root });
    registerBuiltInTools(runtime.registry, { allowedTools: MINIMAL_TOOL_NAMES });
    assert.deepEqual([...runtime.registry.list()].sort(), MINIMAL_TOOL_NAMES);

    const outcome = await reloadForkOverrides.call(runtime, TRACE);

    assert.equal(outcome.tools?.mode, "standard");
    assert.equal(outcome.tools?.removedBuiltIn.length, 0);
    assert.ok(outcome.tools!.addedBuiltIn.includes("TodoWrite"));
    assert.ok(runtime.registry.has("TodoWrite"));
    assert.ok(runtime.registry.has("Read"));
  });
});

test("标准 → 极简：被排除的工具显式注销（注册表不会自动回收）", async () => {
  await withToolModeState({ schemaVersion: 1, injectTools: true, mode: "minimal" }, async (root) => {
    const { runtime } = createFakeRuntime({ toolModeRoot: root });
    registerBuiltInTools(runtime.registry, {});
    assert.ok(runtime.registry.list().length > MINIMAL_TOOL_NAMES.length);

    const outcome = await reloadForkOverrides.call(runtime, TRACE);

    assert.equal(outcome.tools?.mode, "minimal");
    assert.deepEqual([...runtime.registry.list()].sort(), MINIMAL_TOOL_NAMES);
    assert.ok(outcome.tools!.removedBuiltIn.includes("TodoWrite"));
    assert.ok(!runtime.registry.has("TodoWrite"));
  });
});

test("注入关闭：内置工具面清空（MCP 缺席时不参与）", async () => {
  await withToolModeState({ schemaVersion: 1, injectTools: false, mode: "minimal" }, async (root) => {
    const { runtime } = createFakeRuntime({ toolModeRoot: root });
    registerBuiltInTools(runtime.registry, {});

    const outcome = await reloadForkOverrides.call(runtime, TRACE);

    assert.equal(outcome.tools?.injectTools, false);
    assert.equal(outcome.tools?.allowedCount, 0);
    assert.deepEqual(runtime.registry.list(), []);
    assert.deepEqual(outcome.tools?.mcpRegistered, []);
  });
});

test("档位文件损坏：回退宿主名单并给诊断，不抛出", async () => {
  await withToolModeState("{ not json", async (root) => {
    const { runtime, warnings } = createFakeRuntime({
      toolModeRoot: root,
      hostAllowlist: ["Read", "Bash"],
    });

    const outcome = await reloadForkOverrides.call(runtime, TRACE);

    assert.equal(outcome.tools?.mode, "standard");
    assert.deepEqual(runtime.config.toolAllowlist, ["Read", "Bash"]);
    assert.match(outcome.tools?.diagnostic ?? "", /JSON/);
    assert.ok(warnings.some((entry) => entry.event === "fork.tool_mode.load.failed"));
  });
});

test("身份端口重读：preset 落到 config；诊断走同一事件名", async () => {
  const { runtime, warnings } = createFakeRuntime({
    identityPresetPort: {
      loadActive: async () => ({
        preset: {
          id: "concise",
          name: "极简",
          content: "你是私人助理。",
          injectDynamic: false,
          injectSkills: false,
        },
      }),
    },
  });

  const outcome = await reloadForkOverrides.call(runtime, TRACE);

  assert.equal(outcome.identity?.presetId, "concise");
  assert.equal(outcome.identity?.injectSkills, false);
  assert.equal(runtime.config.identityPreset?.id, "concise");
  assert.equal(warnings.length, 0);
});

test("身份端口诊断：warn 同一事件名，preset 清空回退系统默认", async () => {
  const { runtime, warnings } = createFakeRuntime({
    identityPresetPort: {
      loadActive: async () => ({ diagnostic: "active.json 不是合法 JSON，已回退系统默认" }),
    },
  });

  const outcome = await reloadForkOverrides.call(runtime, TRACE);

  assert.equal(outcome.identity?.presetId, null);
  assert.equal(runtime.config.identityPreset, undefined);
  assert.ok(warnings.some((entry) => entry.event === "identity_preset.load.failed"));
});

test("子代理运行时不承接（命令面不可达；防御性短路）", async () => {
  const { runtime } = createFakeRuntime({ taskType: "subagent_child" });

  const outcome = await reloadForkOverrides.call(runtime, TRACE);

  assert.equal(outcome.skipped, "subagent_child");
  assert.equal(outcome.tools, undefined);
  assert.equal(outcome.identity, undefined);
});
