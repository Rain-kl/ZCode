# 网络搜索渠道（search-providers）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `WebSearch` 的后端可替换——服务端搜索成为渠道链的第一环（存在性由模型能力决定），用户可在设置页追加多条 Tavily 渠道，工具内部自上而下降级。

**Architecture:** CLI 侧在 `core/src/fork/search-providers/` 内实现「渠道接口 + 路由 + Tavily 适配器 + 模块级 mtime 缓存的渠道加载器」；上游 `websearch.ts` 只把 provider-native 逻辑包成可调用单元并交给路由。桌面侧 host 新增 `IForkSearchProvidersService` 读写渠道文件，UI 新增「搜索」栏目；渠道文件同时纳入 WebDAV 同步清单。

**Tech Stack:** TypeScript / Node 24 / zod / node:test + assert/strict（经 `pnpm test:unit` → `tsx --test`）/ React / RPC `createServiceDescriptor` + `ProxyChannel`。

**Spec:** `docs/features/search-providers/design.md`（本计划逐条实现该设计；执行者需同时阅读）

## Global Constraints

- 渠道文件路径 = `<homedir()>/.zcode/cli/fork/settings.json`。host 侧解析**不得**经过 `getDataBaseDir()` / `getZCodeDataRootDir()` / `resolveUserHomeDir()`；路径拼接只有一处实现（`resolveForkSearchProvidersFilePath`）。
- 渠道数据不进 `AppSettings` / `setting.json`。
- 模型可见文本不含渠道信息；日志、错误文本、解析问题列表**不得**出现 apiKey 或 label。
- Tavily 请求**不设** `egressPolicy: "public"`（否则代理用户必然 `egress_blocked`）。
- 服务端渠道在模型不支持时**不存在**（不是「存在但失败」）；渠道数 = `(supportsNativeWebSearch ? 1 : 0) + 已启用 Tavily 数`；渠道数 = 0 则不暴露 `WebSearch`。
- 不用 `as any`、非空断言、可选链兜底、`try/catch` 吞异常来让测试变绿。
- 每处上游文件改动打 `FORK(search-providers)` 标记；新增文件不需要标记。
- 先写测试再实现；每个任务结束提交一次；**禁止 push**。

## Review Focus

Spec 没有明说、但最可能让人踩到的输入，每条都要有测试（落在归属任务的步骤里）：

1. **Tavily 返回 200 但 `results` 为空数组** → 这是「成功但零条结果」，不得当成失败去降级（降级会白烧下一个渠道的额度）。→ Task 3
2. **用户把 key 清空但保留渠道** → 发送空 Bearer 会得到 401，这是正常的运行时失败并降级；UI 不得阻止保存，也不得静默改成「渠道不存在」。→ Task 1 + Task 7
3. **渠道文件被另一个进程（WebDAV 恢复）在两次调用之间整体替换** → mtime 变化必须让缓存失效，否则用户恢复了备份却一直用旧 key。→ Task 4
4. **`version` 高于当前认知** → 按 0 条渠道处理并留痕（设计已定），但 UI 若仍列出渠道会让用户困惑，因此解析结果必须把 `version` 与 `channels` 分开回报。→ Task 1 + Task 7
5. **模型传入超过 Tavily 上限的域名列表（include 上限 300 / exclude 上限 150）** → 必须截断而不是原样发送（原样发送会 400，把一次可用的搜索变成一次失败降级）。→ Task 3

---

## File Structure

**新建（无上游冲突风险）**

| 文件 | 职责 |
| --- | --- |
| `packages/shared/src/fork/search-providers-contract.ts` | 渠道文件格式、版本、容错解析、路径拼接（唯一实现）、RPC channel 常量 |
| `packages/services/src/fork/search-providers.ts` | `IForkSearchProvidersService` 接口 + 服务描述符 |
| `packages/desktop/src/host/fork/search-providers/file-store.ts` | 渠道文件读/写（原子写 + 文件锁），只做 IO 不做业务 |
| `packages/desktop/src/host/fork/search-providers/service.ts` | 服务实现：list/add/update/remove/reorder |
| `packages/ui/src/fork/search-providers/useForkSearchProviders.ts` | 设置页数据入口（照 `useForkWebdav`） |
| `packages/ui/src/fork/search-providers/SearchProvidersSection.tsx` | 「搜索」栏目 UI |
| `apps/zcode-cli/packages/core/src/fork/search-providers/channel.ts` | 渠道接口与类型（`SearchChannel` 等） |
| `apps/zcode-cli/packages/core/src/fork/search-providers/router.ts` | `runSearchChannels`：按序尝试 + 失败聚合 |
| `apps/zcode-cli/packages/core/src/fork/search-providers/tavily.ts` | Tavily 适配器：请求构造 / 响应映射 / 错误分类 |
| `apps/zcode-cli/packages/core/src/fork/search-providers/channels.ts` | 渠道加载器：模块级 mtime 缓存 + 组装渠道链 |
| `apps/zcode-cli/packages/core/test/forkSearchProviders*.test.ts` | 测试 |
| `packages/shared/test/forkSearchProvidersContract.test.ts`、`packages/desktop/test/forkSearchProviders*.test.ts` | 测试 |
| `docs/features/search-providers/implementation.md` | 落地记录 |

**修改（上游文件，逐处打标）**：`apps/zcode-cli/packages/core/src/tool/handlers/websearch.ts`、`.../runtime/methods/config.ts`、`apps/zcode-cli/packages/contracts/src/tools/websearch.ts`、`packages/desktop/src/host/index.ts`、`packages/client/src/remoteServiceAccess.ts`、`packages/services/src/accessor.ts`、`packages/shared/src/index.ts`、设置页四件套 + i18n 双份、`packages/desktop/src/host/fork/webdav-sync/manifest.ts`（fork 自有）、`FEATURES.md`。

---

### Task 1: 渠道文件契约（shared）

**Files:**
- Create: `packages/shared/src/fork/search-providers-contract.ts`
- Modify: `packages/shared/src/index.ts`（导出，照 `webdav-contract.js` 的既有导出行）
- Test: `packages/shared/test/forkSearchProvidersContract.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `FORK_SEARCH_PROVIDERS_CHANNEL: string`、`FORK_SEARCH_PROVIDERS_FILE_VERSION: number`、`ForkSearchProviderChannel`、`ForkSearchProvidersFile`、`EMPTY_FORK_SEARCH_PROVIDERS_FILE`、`parseForkSearchProvidersFile(raw: unknown): { file: ForkSearchProvidersFile; problems: string[] }`、`resolveForkSearchProvidersFilePath(homeDir: string): string`

- [ ] **Step 1: 写失败的测试**

```ts
// packages/shared/test/forkSearchProvidersContract.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_FORK_SEARCH_PROVIDERS_FILE,
  FORK_SEARCH_PROVIDERS_FILE_VERSION,
  parseForkSearchProvidersFile,
  resolveForkSearchProvidersFilePath,
} from "../src/fork/search-providers-contract.js";

const good = {
  version: 1,
  channels: [{ id: "a1", kind: "tavily", label: "工作用", enabled: true, apiKey: "tvly-secret" }],
};

test("保留顺序与字段", () => {
  const { file, problems } = parseForkSearchProvidersFile(good);
  assert.deepEqual(problems, []);
  assert.equal(file.version, FORK_SEARCH_PROVIDERS_FILE_VERSION);
  assert.deepEqual(file.channels, good.channels);
});

test("缺失 enabled 默认为 true，缺失 label 默认为空串", () => {
  const { file } = parseForkSearchProvidersFile({
    version: 1,
    channels: [{ id: "a1", kind: "tavily", apiKey: "k" }],
  });
  assert.equal(file.channels[0]?.enabled, true);
  assert.equal(file.channels[0]?.label, "");
});

test("非对象输入按 0 条处理并留下问题", () => {
  const { file, problems } = parseForkSearchProvidersFile(null);
  assert.deepEqual(file, EMPTY_FORK_SEARCH_PROVIDERS_FILE);
  assert.equal(problems.length, 1);
});

test("未知版本按 0 条处理，且版本被单独回报", () => {
  const { file, problems } = parseForkSearchProvidersFile({ version: 99, channels: good.channels });
  assert.deepEqual(file.channels, []);
  assert.equal(file.version, 99);
  assert.match(problems.join("\n"), /99/);
});

test("坏条目被丢弃，好条目保留", () => {
  const { file, problems } = parseForkSearchProvidersFile({
    version: 1,
    channels: [
      { id: "ok", kind: "tavily", apiKey: "k" },
      { id: "", kind: "tavily", apiKey: "k" },
      { id: "x", kind: "brave", apiKey: "k" },
      { id: "y", kind: "tavily" },
    ],
  });
  assert.deepEqual(file.channels.map((c) => c.id), ["ok"]);
  assert.equal(problems.length, 3);
});

test("问题列表绝不包含 apiKey（避免密钥进日志）", () => {
  const { problems } = parseForkSearchProvidersFile({
    version: 1,
    channels: [{ id: "y", kind: "tavily", apiKey: "tvly-do-not-leak" }],
  });
  assert.ok(problems.length > 0);
  assert.ok(!problems.join("\n").includes("tvly-do-not-leak"));
});

test("保留空 key 渠道：清空 key 是用户的合法状态，不是坏条目", () => {
  const { file, problems } = parseForkSearchProvidersFile({
    version: 1,
    channels: [{ id: "a1", kind: "tavily", apiKey: "" }],
  });
  assert.deepEqual(problems, []);
  assert.equal(file.channels[0]?.apiKey, "");
});

test("路径拼接只有一处实现：homedir + .zcode/cli + fork/settings.json", () => {
  assert.equal(
    resolveForkSearchProvidersFilePath("/home/u"),
    "/home/u/.zcode/cli/fork/settings.json",
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test:unit -- --test-name-pattern search-providers` （若该参数不被 runner 透传，直接 `cd packages/shared && pnpm exec tsx --test test/forkSearchProvidersContract.test.ts`）
Expected: FAIL — Cannot find module `../src/fork/search-providers-contract.js`

- [ ] **Step 3: 实现**

```ts
// packages/shared/src/fork/search-providers-contract.ts
/**
 * 网络搜索渠道（fork）的数据契约。
 *
 * 渠道文件由桌面 host 的 `IForkSearchProvidersService` 独占写入，CLI 侧只读；
 * 两边的路径拼接必须走 `resolveForkSearchProvidersFilePath`，不允许各自 join——
 * 见 docs/features/search-providers/design.md §6.2（两侧漂移的症状是「UI 配了、模型用不到」）。
 */
import { ZCODE_AGENT_RUNTIME } from "../zcode-agent-runtime.js";

export const FORK_SEARCH_PROVIDERS_CHANNEL = "fork-search-providers";
export const FORK_SEARCH_PROVIDERS_FILE_VERSION = 1;
/** 相对于 CLI 配置目录（`ZCODE_AGENT_RUNTIME.nativeConfigDir`）。 */
export const FORK_SEARCH_PROVIDERS_RELATIVE_PATH = "fork/settings.json";

export interface ForkSearchProviderChannel {
  id: string;
  kind: "tavily";
  /** 仅 UI 标签：不进入模型可见内容，也不写进日志。 */
  label: string;
  enabled: boolean;
  apiKey: string;
}

export interface ForkSearchProvidersFile {
  version: number;
  channels: ForkSearchProviderChannel[];
}

export const EMPTY_FORK_SEARCH_PROVIDERS_FILE: ForkSearchProvidersFile = Object.freeze({
  version: FORK_SEARCH_PROVIDERS_FILE_VERSION,
  channels: [],
});

/**
 * 路径拼接的唯一实现。刻意不用 node:path，因为本模块会被浏览器侧（packages/ui）导入；
 * `/` 对 Node 的 fs API 在 Windows 上同样可用。
 */
export function resolveForkSearchProvidersFilePath(homeDir: string): string {
  return [homeDir, ZCODE_AGENT_RUNTIME.nativeConfigDir, FORK_SEARCH_PROVIDERS_RELATIVE_PATH].join(
    "/",
  );
}

/**
 * 容错解析：坏数据一律降级为「少几条渠道」，绝不抛给调用方使其启动失败。
 * 返回的 problems 会进日志，因此**不得**包含 apiKey 或 label。
 */
export function parseForkSearchProvidersFile(raw: unknown): {
  file: ForkSearchProvidersFile;
  problems: string[];
} {
  if (!isRecord(raw)) {
    return { file: { ...EMPTY_FORK_SEARCH_PROVIDERS_FILE }, problems: ["配置不是 JSON 对象"] };
  }

  const version = typeof raw.version === "number" ? raw.version : FORK_SEARCH_PROVIDERS_FILE_VERSION;
  if (version !== FORK_SEARCH_PROVIDERS_FILE_VERSION) {
    return {
      file: { version, channels: [] },
      problems: [`不支持的配置版本 ${version}，已按无渠道处理`],
    };
  }

  if (!Array.isArray(raw.channels)) {
    return { file: { version, channels: [] }, problems: ["channels 不是数组"] };
  }

  const channels: ForkSearchProviderChannel[] = [];
  const problems: string[] = [];
  raw.channels.forEach((entry, index) => {
    if (!isRecord(entry)) {
      problems.push(`第 ${index + 1} 条渠道不是对象，已忽略`);
      return;
    }
    if (typeof entry.id !== "string" || entry.id.trim() === "") {
      problems.push(`第 ${index + 1} 条渠道缺少 id，已忽略`);
      return;
    }
    if (entry.kind !== "tavily") {
      problems.push(`渠道 ${entry.id} 的类型不受支持，已忽略`);
      return;
    }
    if (typeof entry.apiKey !== "string") {
      problems.push(`渠道 ${entry.id} 缺少 apiKey，已忽略`);
      return;
    }
    channels.push({
      id: entry.id,
      kind: "tavily",
      label: typeof entry.label === "string" ? entry.label : "",
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
      apiKey: entry.apiKey,
    });
  });

  return { file: { version, channels }, problems };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2
Expected: PASS（8 例）

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/fork/search-providers-contract.ts packages/shared/src/index.ts packages/shared/test/forkSearchProvidersContract.test.ts
git commit -m "feat(search-providers): 渠道文件契约与容错解析"
```

---

### Task 2: 渠道接口与路由

**Files:**
- Create: `apps/zcode-cli/packages/core/src/fork/search-providers/channel.ts`, `.../router.ts`
- Test: `apps/zcode-cli/packages/core/test/forkSearchProvidersRouter.test.ts`

**Interfaces:**
- Consumes: `ModelTextResult`（`@zcode/contracts`）
- Produces: `SearchChannelRequest`、`SearchChannelFailure`、`SearchChannel`、`SearchChannelOutcome`、`runSearchChannels(input: { channels: readonly SearchChannel[]; request: SearchChannelRequest }): Promise<SearchChannelOutcome>`、`SearchChannelsExhaustedError`

- [ ] **Step 1: 写失败的测试**

```ts
// apps/zcode-cli/packages/core/test/forkSearchProvidersRouter.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import type { ModelTextResult } from "@zcode/contracts";
import {
  SearchChannelsExhaustedError,
  runSearchChannels,
  type SearchChannel,
} from "../src/fork/search-providers/router.js";

const result = (text: string): ModelTextResult => ({ text, finishReason: "stop", usage: {} });
const request = { query: "q" };

function channel(
  kind: string,
  label: string,
  behaviour: () => Promise<ModelTextResult>,
): SearchChannel & { calls: number } {
  const fake = {
    kind,
    label,
    calls: 0,
    async search() {
      fake.calls += 1;
      return await behaviour();
    },
  };
  return fake;
}

test("首个成功即返回，后续渠道不被调用", async () => {
  const first = channel("server", "服务端搜索", async () => result("ok"));
  const second = channel("tavily", "工作用", async () => result("nope"));
  const outcome = await runSearchChannels({ channels: [first, second], request });
  assert.equal(outcome.result.text, "ok");
  assert.equal(outcome.channelKind, "server");
  assert.deepEqual(outcome.attempts, []);
  assert.equal(second.calls, 0);
});

test("前一个失败则降级，并把失败记进 attempts", async () => {
  const failing = channel("server", "服务端搜索", async () => {
    throw new Error("通道不支持 web_search");
  });
  const working = channel("tavily", "工作用", async () => result("from tavily"));
  const outcome = await runSearchChannels({ channels: [failing, working], request });
  assert.equal(outcome.result.text, "from tavily");
  assert.equal(outcome.channelKind, "tavily");
  assert.equal(outcome.attempts.length, 1);
  assert.equal(outcome.attempts[0]?.channelKind, "server");
  assert.equal(outcome.attempts[0]?.channelLabel, "服务端搜索");
  assert.match(outcome.attempts[0]?.reason ?? "", /通道不支持 web_search/);
});

test("全部失败抛出，并保留逐条原因与顺序", async () => {
  const a = channel("server", "服务端搜索", async () => {
    throw new Error("401 鉴权失败");
  });
  const b = channel("tavily", "工作用", async () => {
    throw new Error("超时");
  });
  await assert.rejects(
    () => runSearchChannels({ channels: [a, b], request }),
    (error: unknown) => {
      assert.ok(error instanceof SearchChannelsExhaustedError);
      assert.deepEqual(
        error.failures.map((f) => f.channelKind),
        ["server", "tavily"],
      );
      assert.match(error.message, /401 鉴权失败/);
      assert.match(error.message, /超时/);
      return true;
    },
  );
});

test("没有任何渠道时抛出而非返回空结果", async () => {
  await assert.rejects(
    () => runSearchChannels({ channels: [], request }),
    (error: unknown) => {
      assert.ok(error instanceof SearchChannelsExhaustedError);
      assert.equal(error.failures.length, 0);
      return true;
    },
  );
});

test("非 Error 抛出物也会被描述成原因，不吞掉", async () => {
  const weird = channel("tavily", "工作用", async () => {
    throw "plain string failure";
  });
  await assert.rejects(
    () => runSearchChannels({ channels: [weird], request }),
    (error: unknown) => {
      assert.ok(error instanceof SearchChannelsExhaustedError);
      assert.match(error.failures[0]?.reason ?? "", /plain string failure/);
      return true;
    },
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/zcode-cli/packages/core && pnpm exec tsx --test test/forkSearchProvidersRouter.test.ts`
Expected: FAIL — Cannot find module

- [ ] **Step 3: 实现**

```ts
// apps/zcode-cli/packages/core/src/fork/search-providers/channel.ts
import type { ModelTextResult } from "@zcode/contracts";

/**
 * 一次搜索请求。字段是各渠道需求的并集，**不是每个渠道都支持全部字段**：
 * 渠道只取自己需要的参数，不认识的字段直接忽略（不报错）——
 * 见 docs/features/search-providers/design.md §8。
 */
export interface SearchChannelRequest {
  query: string;
  allowedDomains?: string[];
  blockedDomains?: string[];
  /** 服务端渠道用：最多发起几次服务端搜索。 */
  maxUses?: number;
  /** Tavily 渠道用：返回多少条结果。 */
  maxResults?: number;
  signal?: AbortSignal;
}

/** 一次渠道失败。三个字段都是「排查这条链为什么绕过了某个渠道」所需的最小信息。 */
export interface SearchChannelFailure {
  channelKind: string;
  channelLabel: string;
  reason: string;
}

export interface SearchChannel {
  kind: string;
  label: string;
  /** 成功返回该渠道的结果；失败必须抛出（不允许返回半成品让路由误判成功）。 */
  search(request: SearchChannelRequest): Promise<ModelTextResult>;
}

export interface SearchChannelOutcome {
  result: ModelTextResult;
  channelKind: string;
  channelLabel: string;
  /** 本次调用中先失败的那些渠道，按尝试顺序。成功降级时非空。 */
  attempts: readonly SearchChannelFailure[];
}
```

```ts
// apps/zcode-cli/packages/core/src/fork/search-providers/router.ts
import type { SearchChannel, SearchChannelFailure, SearchChannelOutcome, SearchChannelRequest } from "./channel.js";

/**
 * 渠道链走完仍未成功。
 *
 * 逐条携带失败原因：把不同渠道的不同失败压成一句「搜索失败」会让
 * 「为什么绕过了服务端搜索」永远查不出来（AGENTS.md 代码规范 7）。
 * failures 的顺序 = 尝试顺序。
 */
export class SearchChannelsExhaustedError extends Error {
  readonly failures: readonly SearchChannelFailure[];

  constructor(failures: readonly SearchChannelFailure[]) {
    super(formatExhaustedMessage(failures));
    this.name = "SearchChannelsExhaustedError";
    this.failures = failures;
  }
}

function formatExhaustedMessage(failures: readonly SearchChannelFailure[]): string {
  if (failures.length === 0) {
    return "No search channel is available";
  }
  const details = failures
    .map((failure) => `${failure.channelKind}(${failure.channelLabel}): ${failure.reason}`)
    .join("; ");
  return `All search channels failed: ${details}`;
}

function describeThrown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function runSearchChannels(input: {
  channels: readonly SearchChannel[];
  request: SearchChannelRequest;
}): Promise<SearchChannelOutcome> {
  const attempts: SearchChannelFailure[] = [];

  for (const channel of input.channels) {
    try {
      const result = await channel.search(input.request);
      return {
        result,
        channelKind: channel.kind,
        channelLabel: channel.label,
        attempts: [...attempts],
      };
    } catch (error) {
      attempts.push({
        channelKind: channel.kind,
        channelLabel: channel.label,
        reason: describeThrown(error),
      });
    }
  }

  throw new SearchChannelsExhaustedError(attempts);
}
```

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS（5 例）
- [ ] **Step 5: 提交**

```bash
git add apps/zcode-cli/packages/core/src/fork/search-providers/ apps/zcode-cli/packages/core/test/forkSearchProvidersRouter.test.ts
git commit -m "feat(search-providers): 渠道接口与降级路由"
```

---

### Task 3: Tavily 适配器

**Files:**
- Create: `apps/zcode-cli/packages/core/src/fork/search-providers/tavily.ts`
- Test: `apps/zcode-cli/packages/core/test/forkSearchProvidersTavily.test.ts`

**Interfaces:**
- Consumes: `SearchChannel` / `SearchChannelRequest`（Task 2）、`HttpClientPort`（`@zcode/contracts`）
- Produces: `TAVILY_SEARCH_ENDPOINT`、`buildTavilySearchRequest(input)`、`mapTavilyResponse(payload)`、`classifyTavilyFailure(status, bodyText, statusText)`、`createTavilyChannel(input: { label: string; apiKey: string; httpClientPort: HttpClientPort; timeoutMs?: number })`

**厂商契约（官方 OpenAPI + 线上实测，取数日期 2026-09-29）**：`POST https://api.tavily.com/search`（无版本前缀，`/v1/search` 是 404），鉴权 `Authorization: Bearer <key>`（**大小写敏感**，小写 `bearer` 会被拒；不再接受 body 里的 `api_key`）。请求 `query`（必填、实测最少 2 字符）、`max_results`（文档默认 10 / 0–20）、`include_domains`（≤300）、`exclude_domains`（≤150）；未知字段被静默忽略。响应 `results[]` 每项 `title`/`url`/`content`/`score` 恒在，`published_date` **只在显式请求或 `topic: news` 时才出现**，`raw_content` 存在但为 `null`。

四条实测结论直接影响实现，逐条落地：

1. **`max_results` 上限并未被服务端强制**：`25` 返回 25 条、`30` 返回 26 条、`50+` 返回 20 条，全部 200。所以「20」是我们的**产品钳制**，不是厂商约束；而 `0` 与负数会被 400 拒绝。
2. **错误体 `detail` 有三种形状**：对象（400/401/429/432/433/500，`{"detail":{"error":"..."}}`）、数组（422，pydantic 校验错误）、纯字符串（405，而我们不会发 GET）。解析只承诺前两种，第三种退回状态码，不编造消息。
3. **校验先于鉴权**：请求体不合法 + key 也无效时返回 400/422 而不是 401。诊断「为什么不是 401」时按此解释。
4. **没有任何 `timeout` 请求参数**（只有 `/extract` `/crawl` `/map` 有）；官方 SDK 用 60s 客户端超时，我们用 30s。

- [ ] **Step 1: 写失败的测试**

```ts
// apps/zcode-cli/packages/core/test/forkSearchProvidersTavily.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  TAVILY_SEARCH_ENDPOINT,
  buildTavilySearchRequest,
  classifyTavilyFailure,
  createTavilyChannel,
  mapTavilyResponse,
} from "../src/fork/search-providers/tavily.js";

/** HttpClientRequest.body 是 Uint8Array，断言前必须解码——直接 deepEqual 一个对象必然失败。 */
function decodeBody(body: Uint8Array | undefined): unknown {
  assert.ok(body, "请求体必须存在");
  return JSON.parse(new TextDecoder().decode(body)) as unknown;
}

test("请求形状：端点、方法、Bearer 鉴权与 JSON 体", () => {
  const request = buildTavilySearchRequest({ query: "hello", apiKey: "tvly-k" });
  assert.equal(request.url, TAVILY_SEARCH_ENDPOINT);
  assert.equal(request.url, "https://api.tavily.com/search");
  assert.equal(request.method, "POST");
  assert.equal(request.headers?.Authorization, "Bearer tvly-k");
  assert.equal(request.headers?.["Content-Type"], "application/json");
  assert.deepEqual(decodeBody(request.body), { query: "hello" });
});

test("可选参数只在有值时出现，且不再发送 maxUses", () => {
  const request = buildTavilySearchRequest({
    query: "q",
    apiKey: "k",
    allowedDomains: ["a.com"],
    blockedDomains: [],
    maxResults: 3,
    maxUses: 8,
  });
  assert.deepEqual(decodeBody(request.body), {
    query: "q",
    max_results: 3,
    include_domains: ["a.com"],
  });
  assert.ok(!("maxUses" in (decodeBody(request.body) as Record<string, unknown>)));
  assert.ok(!("exclude_domains" in (decodeBody(request.body) as Record<string, unknown>)));
});

test("域名列表被截断到厂商上限（include 300 / exclude 150）", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => `d${i}.com`);
  const request = buildTavilySearchRequest({
    query: "q",
    apiKey: "k",
    allowedDomains: many(305),
    blockedDomains: many(160),
  });
  const body = decodeBody(request.body) as { include_domains: string[]; exclude_domains: string[] };
  assert.equal(body.include_domains.length, 300);
  assert.equal(body.exclude_domains.length, 150);
});

test("响应映射：vendor 字段转成中立结果项，published_date → pageAge", () => {
  const mapped = mapTavilyResponse({
    query: "q",
    results: [
      { title: "T1", url: "https://a.com", content: "snippet", score: 0.9, published_date: "2026-01-02" },
      { url: "https://b.com" },
    ],
    response_time: 1.2,
  });
  assert.deepEqual(mapped.items, [
    { url: "https://a.com", title: "T1", pageAge: "2026-01-02" },
    { url: "https://b.com", title: undefined, pageAge: undefined },
  ]);
  assert.match(mapped.text, /https:\/\/a\.com/);
  assert.match(mapped.text, /snippet/);
});

test("200 但 results 为空数组 = 成功（不得当作失败去降级）", () => {
  const mapped = mapTavilyResponse({ query: "q", results: [] });
  assert.deepEqual(mapped.items, []);
  assert.equal(mapped.text, "");
});

test("results 缺失或不是数组 = 响应不合规，抛错", () => {
  assert.throws(() => mapTavilyResponse({ query: "q" }), /results/);
  assert.throws(() => mapTavilyResponse({ query: "q", results: "nope" }), /results/);
  assert.throws(() => mapTavilyResponse(null), /results/);
});

test("错误分类逐条覆盖状态码与厂商消息", () => {
  const detail = (message: string) => JSON.stringify({ detail: { error: message } });
  assert.match(classifyTavilyFailure(401, detail("invalid api key"), "Unauthorized"), /401/);
  assert.match(classifyTavilyFailure(401, detail("invalid api key"), "Unauthorized"), /invalid api key/);
  assert.match(classifyTavilyFailure(429, detail("too many"), "Too Many Requests"), /429/);
  assert.match(classifyTavilyFailure(432, detail("plan limit"), "Limit"), /432/);
  assert.match(classifyTavilyFailure(433, detail("paygo limit"), "Limit"), /433/);
  assert.match(classifyTavilyFailure(400, detail("bad body"), "Bad Request"), /400/);
  assert.match(classifyTavilyFailure(422, JSON.stringify({ detail: [{ msg: "bad" }] }), "Unprocessable"), /422/);
  assert.match(classifyTavilyFailure(500, "", "Internal Server Error"), /500/);
});

test("错误体不是预期形状时不崩，仍给出状态码", () => {
  assert.match(classifyTavilyFailure(500, "<html>oops</html>", "Internal Server Error"), /500/);
  // 405 的 detail 是纯字符串（第三种形状）——我们不会发 GET，但解析必须是全函数
  assert.match(classifyTavilyFailure(405, JSON.stringify({ detail: "Method Not Allowed" }), "Method Not Allowed"), /405/);
  assert.ok(!classifyTavilyFailure(405, JSON.stringify({ detail: "Method Not Allowed" }), "Method Not Allowed").includes("undefined"));
});

test("published_date 缺席时 pageAge 为 undefined（真实响应默认不含该字段）", () => {
  const mapped = mapTavilyResponse({
    query: "q",
    results: [{ url: "https://a.com", title: "T", content: "c", score: 0.5, raw_content: null }],
  });
  assert.equal(mapped.items[0]?.pageAge, undefined);
});

test("渠道：HTTP 错误转成带状态码的失败，超时转成超时失败", async () => {
  const channel = createTavilyChannel({
    label: "工作用",
    apiKey: "tvly-k",
    httpClientPort: {
      async request() {
        return {
          url: TAVILY_SEARCH_ENDPOINT,
          status: 401,
          statusText: "Unauthorized",
          headers: {},
          body: new TextEncoder().encode('{"detail":{"error":"invalid api key"}}'),
          bytes: 40,
          durationMs: 5,
        };
      },
    },
  });
  await assert.rejects(
    () => channel.search({ query: "q" }),
    (error: unknown) => {
      assert.match(String(error instanceof Error ? error.message : error), /401/);
      return true;
    },
  );
});

test("渠道：成功响应产出中立结果，且不发 egressPolicy（代理用户不被拦）", async () => {
  let seen: { egressPolicy?: unknown } | undefined;
  const channel = createTavilyChannel({
    label: "工作用",
    apiKey: "tvly-k",
    httpClientPort: {
      async request(request) {
        seen = request;
        return {
          url: TAVILY_SEARCH_ENDPOINT,
          status: 200,
          statusText: "OK",
          headers: {},
          body: new TextEncoder().encode(
            JSON.stringify({ query: "q", results: [{ title: "T", url: "https://a.com", content: "c" }] }),
          ),
          bytes: 60,
          durationMs: 5,
        };
      },
    },
  });
  const result = await channel.search({ query: "q", maxResults: 2 });
  assert.equal(seen?.egressPolicy, undefined);
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(result.toolResults?.[0]?.output, [
    { url: "https://a.com", title: "T", pageAge: undefined },
  ]);
});
```

- [ ] **Step 2: 跑测试确认失败** — Expected: FAIL（Cannot find module）

- [ ] **Step 3: 实现**

```ts
// apps/zcode-cli/packages/core/src/fork/search-providers/tavily.ts
import {
  isHttpClientPortError,
  type HttpClientPort,
  type HttpClientRequest,
  type ModelTextResult,
} from "@zcode/contracts";
import type { SearchChannel, SearchChannelRequest } from "./channel.js";

export const TAVILY_SEARCH_ENDPOINT = "https://api.tavily.com/search";
const TAVILY_DEFAULT_TIMEOUT_MS = 30_000;
/** 厂商上限，见官方 OpenAPI 的 include_domains / exclude_domains 约束。 */
const TAVILY_MAX_INCLUDE_DOMAINS = 300;
const TAVILY_MAX_EXCLUDE_DOMAINS = 150;

export interface TavilyResultItem {
  url: string;
  title?: string;
  pageAge?: string;
}

export function buildTavilySearchRequest(input: {
  query: string;
  apiKey: string;
  allowedDomains?: string[];
  blockedDomains?: string[];
  maxResults?: number;
  maxUses?: number;
}): HttpClientRequest {
  const body: Record<string, unknown> = { query: input.query };
  if (input.maxResults !== undefined) body.max_results = input.maxResults;
  const include = input.allowedDomains?.slice(0, TAVILY_MAX_INCLUDE_DOMAINS);
  if (include && include.length > 0) body.include_domains = include;
  const exclude = input.blockedDomains?.slice(0, TAVILY_MAX_EXCLUDE_DOMAINS);
  if (exclude && exclude.length > 0) body.exclude_domains = exclude;
  // input.maxUses 有意忽略：Tavily 只发一次请求，「搜几次」对它没有意义。

  return {
    url: TAVILY_SEARCH_ENDPOINT,
    method: "POST",
    headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
    body: new TextEncoder().encode(JSON.stringify(body)),
    timeoutMs: TAVILY_DEFAULT_TIMEOUT_MS,
  };
}

export function mapTavilyResponse(payload: unknown): { items: TavilyResultItem[]; text: string } {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new Error("Tavily response has no results array");
  }

  const items = payload.results.flatMap((entry): TavilyResultItem[] => {
    if (!isRecord(entry) || typeof entry.url !== "string" || entry.url === "") return [];
    return [
      {
        url: entry.url,
        title: typeof entry.title === "string" && entry.title !== "" ? entry.title : undefined,
        pageAge:
          // 实测：真实响应默认不含 published_date（只在显式请求或 topic=news 时出现）。
          // 这里保持宽容读取、但不为了它加 include_published_date（beta 且无消费方）。
          typeof entry.published_date === "string" && entry.published_date !== ""
            ? entry.published_date
            : undefined,
      },
    ];
  });

  const text = payload.results
    .flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.url !== "string") return [];
      const title = typeof entry.title === "string" ? entry.title : entry.url;
      const content = typeof entry.content === "string" ? entry.content.trim() : "";
      return [`- ${title} (${entry.url})${content ? `: ${content}` : ""}`];
    })
    .join("\n");

  return { items, text };
}

/** 把状态码与厂商错误消息合成一句可诊断的原因；厂商消息缺失时不编造。 */
export function classifyTavilyFailure(status: number, bodyText: string, statusText: string): string {
  const vendorMessage = extractVendorError(bodyText);
  const base = `Tavily search failed with HTTP ${status} ${statusText}`.trim();
  return vendorMessage ? `${base}: ${vendorMessage}` : base;
}

function extractVendorError(bodyText: string): string | undefined {
  // 厂商 detail 有三种形状：对象（400/401/429/432/433/500）、数组（422 的 pydantic 校验错误）、
  // 纯字符串（405，我们不会触发）。只承诺前两种；其余退回状态码，不编造消息。
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (!isRecord(parsed)) return undefined;
    const detail = parsed.detail;
    if (isRecord(detail) && typeof detail.error === "string") return detail.error;
    if (Array.isArray(detail)) {
      const messages = detail.flatMap((entry) =>
        isRecord(entry) && typeof entry.msg === "string" ? [entry.msg] : [],
      );
      if (messages.length > 0) return messages.join("; ");
    }
  } catch {
    // 非 JSON 错误体（网关 HTML 等）：交给状态码表达，不编造消息。
    return undefined;
  }
  return undefined;
}

export function createTavilyChannel(input: {
  label: string;
  apiKey: string;
  httpClientPort: HttpClientPort;
  timeoutMs?: number;
}): SearchChannel {
  return {
    kind: "tavily",
    label: input.label,
    async search(request: SearchChannelRequest): Promise<ModelTextResult> {
      const httpRequest = buildTavilySearchRequest({
        query: request.query,
        apiKey: input.apiKey,
        ...(request.allowedDomains ? { allowedDomains: request.allowedDomains } : {}),
        ...(request.blockedDomains ? { blockedDomains: request.blockedDomains } : {}),
        ...(request.maxResults === undefined ? {} : { maxResults: request.maxResults }),
      });

      let response;
      try {
        response = await input.httpClientPort.request(
          { ...httpRequest, ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }) },
          request.signal ? { signal: request.signal } : {},
        );
      } catch (error) {
        // 传输层失败（DNS/代理/超时）没有状态码，必须把底层原因带出去，
        // 否则降级链里只会看到一句 "fetch failed"。
        if (isHttpClientPortError(error)) {
          throw new Error(`Tavily search transport failure (${error.code}): ${error.message}`);
        }
        throw error instanceof Error ? error : new Error(String(error));
      }

      const bodyText = new TextDecoder().decode(response.body);
      if (response.status < 200 || response.status >= 300) {
        throw new Error(classifyTavilyFailure(response.status, bodyText, response.statusText));
      }

      const mapped = mapTavilyResponse(JSON.parse(bodyText) as unknown);
      return {
        text: mapped.text,
        finishReason: "stop",
        usage: {},
        toolResults: [
          { id: "tavily-search", name: "web_search", input: { query: request.query }, output: mapped.items },
        ],
      };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS（10 例）
- [ ] **Step 5: 提交**

```bash
git add apps/zcode-cli/packages/core/src/fork/search-providers/tavily.ts apps/zcode-cli/packages/core/test/forkSearchProvidersTavily.test.ts
git commit -m "feat(search-providers): Tavily 适配器与失败分类"
```

---

### Task 4: 渠道加载器（mtime 缓存）

**Files:**
- Create: `apps/zcode-cli/packages/core/src/fork/search-providers/channels.ts`
- Test: `apps/zcode-cli/packages/core/test/forkSearchProvidersChannels.test.ts`

**Interfaces:**
- Consumes: `parseForkSearchProvidersFile` / `resolveForkSearchProvidersFilePath`（Task 1）、`createTavilyChannel`（Task 3）、`HttpClientPort`、`Model`
- Produces: `loadForkSearchChannels(input: { homeDir: string; httpClientPort: HttpClientPort }): ForkSearchProviderChannel[]`（同步、带 mtime 缓存）、`countAvailableSearchChannels(model): 0 | 1 | 2+`、`resetSearchChannelCacheForTests()`

**为什么同步**：暴露门 `shouldExposeWebSearch` 在 `getTools` 里是同步的。用模块级缓存 + `statSync` 做失效判断，只在 mtime 变化时 `readFileSync`。core 内已有 27 处同步文件 IO 先例（含工具处理器），且这样不必把加载器注入 runtime，上游改动面最小。

- [ ] **Step 1: 写失败的测试**

```ts
// apps/zcode-cli/packages/core/test/forkSearchProvidersChannels.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  countAvailableSearchChannels,
  loadForkSearchChannels,
  resetSearchChannelCacheForTests,
} from "../src/fork/search-providers/channels.js";

const httpClientPort = { async request() { throw new Error("not used"); } };
const modelWith = (native: boolean) =>
  ({ properties: { supportsNativeWebSearch: native } }) as never;

function writeChannelsFile(home: string, payload: unknown, mtimeSeconds?: number): string {
  const dir = join(home, ".zcode", "cli", "fork");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "settings.json");
  writeFileSync(file, JSON.stringify(payload), "utf8");
  if (mtimeSeconds !== undefined) utimesSync(file, mtimeSeconds, mtimeSeconds);
  return file;
}

test("文件缺失 = 0 条 Tavily 渠道，不抛错", () => {
  resetSearchChannelCacheForTests();
  const home = mkdtempSync(join(tmpdir(), "sp-"));
  assert.deepEqual(loadForkSearchChannels({ homeDir: home, httpClientPort }), []);
});

test("只把启用中的渠道变成可调用渠道，顺序保持", () => {
  resetSearchChannelCacheForTests();
  const home = mkdtempSync(join(tmpdir(), "sp-"));
  writeChannelsFile(home, {
    version: 1,
    channels: [
      { id: "a", kind: "tavily", label: "一", enabled: true, apiKey: "k1" },
      { id: "b", kind: "tavily", label: "二", enabled: false, apiKey: "k2" },
      { id: "c", kind: "tavily", label: "三", enabled: true, apiKey: "k3" },
    ],
  });
  const channels = loadForkSearchChannels({ homeDir: home, httpClientPort });
  assert.deepEqual(channels.map((c) => c.id), ["a", "c"]);
});

test("mtime 变化让缓存失效（WebDAV 恢复整体替换文件的场景）", () => {
  resetSearchChannelCacheForTests();
  const home = mkdtempSync(join(tmpdir(), "sp-"));
  writeChannelsFile(
    home,
    { version: 1, channels: [{ id: "a", kind: "tavily", label: "旧", enabled: true, apiKey: "old" }] },
    1_000_000,
  );
  assert.deepEqual(
    loadForkSearchChannels({ homeDir: home, httpClientPort }).map((c) => c.label),
    ["旧"],
  );
  writeChannelsFile(
    home,
    { version: 1, channels: [{ id: "a", kind: "tavily", label: "新", enabled: true, apiKey: "new" }] },
    2_000_000,
  );
  assert.deepEqual(
    loadForkSearchChannels({ homeDir: home, httpClientPort }).map((c) => c.label),
    ["新"],
  );
});

test("文件损坏 = 0 条渠道，不抛错", () => {
  resetSearchChannelCacheForTests();
  const home = mkdtempSync(join(tmpdir(), "sp-"));
  const dir = join(home, ".zcode", "cli", "fork");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.json"), "{ not json", "utf8");
  assert.deepEqual(loadForkSearchChannels({ homeDir: home, httpClientPort }), []);
});

test("渠道数 = 服务端能力 + 启用中的 Tavily 数", () => {
  resetSearchChannelCacheForTests();
  const home = mkdtempSync(join(tmpdir(), "sp-"));
  assert.equal(countAvailableSearchChannels({ homeDir: home, model: modelWith(false) }), 0);
  assert.equal(countAvailableSearchChannels({ homeDir: home, model: modelWith(true) }), 1);
  writeChannelsFile(home, {
    version: 1,
    channels: [
      { id: "a", kind: "tavily", enabled: true, apiKey: "k" },
      { id: "b", kind: "tavily", enabled: false, apiKey: "k" },
    ],
  });
  assert.equal(countAvailableSearchChannels({ homeDir: home, model: modelWith(false) }), 1);
  assert.equal(countAvailableSearchChannels({ homeDir: home, model: modelWith(true) }), 2);
});
```

- [ ] **Step 2: 跑测试确认失败** — Expected: FAIL（Cannot find module）

- [ ] **Step 3: 实现**

```ts
// apps/zcode-cli/packages/core/src/fork/search-providers/channels.ts
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import type { HttpClientPort, Model } from "@zcode/contracts";
import {
  parseForkSearchProvidersFile,
  resolveForkSearchProvidersFilePath,
  type ForkSearchProviderChannel,
} from "@zcode/shared";
import { createTavilyChannel } from "./tavily.js";
import type { SearchChannel } from "./channel.js";

interface CacheEntry {
  channels: ForkSearchProviderChannel[];
  mtimeMs: number;
}

/**
 * 模块级缓存：暴露门是同步的（`shouldExposeWebSearch` 在 getTools 里），
 * 所以这里用 statSync 判失效、只在 mtime 变化时读文件。
 * 缓存键是文件路径，进程内共享（渠道文件本来就是每用户一份，不是每会话一份）。
 */
const cache = new Map<string, CacheEntry>();

/** 测试与「用户刚改完设置」的强制失效入口。 */
export function resetSearchChannelCacheForTests(): void {
  cache.clear();
}

function readChannels(filePath: string): ForkSearchProviderChannel[] {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(filePath).mtimeMs;
  } catch {
    // 文件不存在是正常状态（独立 CLI 从未配置过渠道）。
    cache.delete(filePath);
    return [];
  }

  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.channels;
  }

  let channels: ForkSearchProviderChannel[] = [];
  try {
    const parsed = parseForkSearchProvidersFile(JSON.parse(readFileSync(filePath, "utf8")) as unknown);
    channels = parsed.file.channels;
    for (const problem of parsed.problems) {
      // 渠道文件是可选项：坏配置降级为「少几条渠道」，但必须留痕，
      // 否则用户改了配置却看不到任何反馈。这里不含 apiKey/label。
      console.warn(`[search-providers] ${problem}`);
    }
  } catch (error) {
    console.warn(
      `[search-providers] 渠道文件无法解析，已按无渠道处理: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    channels = [];
  }

  cache.set(filePath, { channels, mtimeMs });
  return channels;
}

/** 渠道契约（含 id / label / enabled / apiKey），供 UI 侧组装与计数使用。 */
export function loadForkSearchProviderChannels(options: { homeDir?: string }): ForkSearchProviderChannel[] {
  const home = options.homeDir ?? homedir();
  return readChannels(resolveForkSearchProvidersFilePath(home));
}

/** 可调用的渠道链：只含启用中的 Tavily 渠道，顺序即降级顺序。 */
export function loadForkSearchChannels(input: {
  homeDir?: string;
  httpClientPort: HttpClientPort;
}): SearchChannel[] {
  return loadForkSearchProviderChannels(input)
    .filter((channel) => channel.enabled)
    .map((channel) =>
      createTavilyChannel({
        label: channel.label,
        apiKey: channel.apiKey,
        httpClientPort: input.httpClientPort,
      }),
    );
}

/**
 * 渠道数 = (模型支持服务端搜索 ? 1 : 0) + 启用中的 Tavily 渠道数。
 * 这是工具暴露门唯一的输入（0 → 不暴露）。
 */
export function countAvailableSearchChannels(input: {
  model: Model | undefined;
  homeDir?: string;
}): number {
  const serverCount = input.model?.properties.supportsNativeWebSearch === true ? 1 : 0;
  const tavilyCount = loadForkSearchProviderChannels(input).filter((c) => c.enabled).length;
  return serverCount + tavilyCount;
}

/** 渠道链的第一环：服务端搜索。其执行体由上游 websearch.ts 注入（Task 6）。 */
export function createServerSearchChannel(input: {
  label: string;
  execute: (request: import("./channel.js").SearchChannelRequest) => Promise<import("@zcode/contracts").ModelTextResult>;
}): SearchChannel {
  return { kind: "server", label: input.label, search: input.execute };
}
```

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS（5 例）
- [ ] **Step 5: 提交**

```bash
git add apps/zcode-cli/packages/core/src/fork/search-providers/channels.ts apps/zcode-cli/packages/core/test/forkSearchProvidersChannels.test.ts
git commit -m "feat(search-providers): 渠道加载器与 mtime 缓存"
```

---

### Task 5: 暴露门改为渠道数

**Files:**
- Modify: `apps/zcode-cli/packages/core/src/runtime/methods/config.ts:268-273`（`shouldExposeWebSearch`）
- Test: `apps/zcode-cli/packages/core/test/forkSearchProvidersExposure.test.ts`

**Interfaces:**
- Consumes: `countAvailableSearchChannels`（Task 4）
- Produces: `shouldExposeWebSearch(model)` 语义变更（无 `model` 时行为不变）

- [ ] **Step 1: 写失败的测试**

```ts
// apps/zcode-cli/packages/core/test/forkSearchProvidersExposure.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shouldExposeWebSearch } from "../src/runtime/methods/config.js";
import { resetSearchChannelCacheForTests } from "../src/fork/search-providers/channels.js";

const modelWith = (native: boolean) => ({ properties: { supportsNativeWebSearch: native } }) as never;

function homeWithTavilyChannel(enabled = true): string {
  const home = mkdtempSync(join(tmpdir(), "sp-"));
  const dir = join(home, ".zcode", "cli", "fork");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({
      version: 1,
      channels: [{ id: "a", kind: "tavily", label: "", enabled, apiKey: "k" }],
    }),
    "utf8",
  );
  return home;
}

test("无 model 时不过滤（注册表枚举语义不变）", () => {
  resetSearchChannelCacheForTests();
  assert.equal(
    shouldExposeWebSearch({ homeDir: mkdtempSync(join(tmpdir(), "sp-")) }, undefined),
    true,
  );
});

test("模型支持服务端搜索 → 暴露（与今天一致）", () => {
  resetSearchChannelCacheForTests();
  assert.equal(
    shouldExposeWebSearch({ homeDir: mkdtempSync(join(tmpdir(), "sp-")) }, modelWith(true)),
    true,
  );
});

test("模型不支持且无 Tavily 渠道 → 不暴露（回归保护）", () => {
  resetSearchChannelCacheForTests();
  assert.equal(
    shouldExposeWebSearch({ homeDir: mkdtempSync(join(tmpdir(), "sp-")) }, modelWith(false)),
    false,
  );
});

test("模型不支持但有启用的 Tavily 渠道 → 暴露（本次解锁的场景）", () => {
  resetSearchChannelCacheForTests();
  assert.equal(shouldExposeWebSearch({ homeDir: homeWithTavilyChannel() }, modelWith(false)), true);
});

test("唯一的 Tavily 渠道被禁用 → 回到不暴露", () => {
  resetSearchChannelCacheForTests();
  assert.equal(
    shouldExposeWebSearch({ homeDir: homeWithTavilyChannel(false) }, modelWith(false)),
    false,
  );
});
```

> 说明：测试用 `homeDir` 注入。为实现这一点，`shouldExposeWebSearch` 的宿主参数改为 `{ homeDir?: string }`，而它原本就接收 `this: AgentRuntimeInternal` —— 真实调用点传 `this`，`homeDir` 缺席时用 `homedir()`。这是为了让判定可测，不改变线上行为。

- [ ] **Step 2: 跑测试确认失败** — Expected: FAIL（`shouldExposeWebSearch` 尚未接受 homeDir；第 4/5 例红）

- [ ] **Step 3: 实现（上游文件，最小 diff + 标记）**

```ts
// FORK(search-providers): 暴露门从「模型是否支持服务端搜索」改为「渠道数 > 0」；
// 导出该函数只为可测（原本是模块私有），判定语义的改动见下一行标记；
// 见 FEATURES.md 的 search-providers 条目与 docs/features/search-providers/design.md §5.2
export function shouldExposeWebSearch(
  this: { homeDir?: string },
  model?: Model,
  // FORK-BEGIN(search-providers)
): boolean {
  // 无 Model 的调用只枚举完整注册表，供持久化和 UI 元数据使用；真实执行始终传入活动模型。
  if (!model) return true;
  return countAvailableSearchChannels({ model, ...(this.homeDir ? { homeDir: this.homeDir } : {}) }) > 0;
  // FORK-END(search-providers)
}
```

> 调用点 `config.ts:141` 传的是 `this`（runtime 实例），`homeDir` 缺席时 `countAvailableSearchChannels` 回落到 `homedir()`，线上行为不变。

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS（5 例）
- [ ] **Step 5: 提交**

```bash
git add apps/zcode-cli/packages/core/src/runtime/methods/config.ts apps/zcode-cli/packages/core/test/forkSearchProvidersExposure.test.ts
git commit -m "feat(search-providers): 暴露门改为渠道数"
```

---

### Task 6: WebSearch 处理器接线

**Files:**
- Modify: `apps/zcode-cli/packages/core/src/tool/handlers/websearch.ts`
- Modify: `apps/zcode-cli/packages/contracts/src/tools/websearch.ts`（入参 `max_results`、输出 `channel`）
- Test: `apps/zcode-cli/packages/core/test/forkSearchProvidersHandler.test.ts`

**Interfaces:**
- Consumes: `runSearchChannels`（Task 2）、`loadForkSearchChannels` / `createServerSearchChannel`（Task 4）
- Produces: `WebSearchInput` 新增 `max_results?: number`；`WebSearchOutput` 新增 `channel?: { kind: string; label: string }`

- [ ] **Step 1: 写失败的测试**

```ts
// apps/zcode-cli/packages/core/test/forkSearchProvidersHandler.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { WebSearchInputSchema, WebSearchOutputSchema } from "@zcode/contracts";
import {
  WEBSEARCH_TOOL_NAME,
  buildWebSearchProviderDescription,
} from "../src/tool/handlers/websearch.js";

test("入参接受 max_results，且仍是 strict", () => {
  const parsed = WebSearchInputSchema.parse({ query: "q", max_results: 5 });
  assert.equal(parsed.max_results, 5);
  assert.throws(() => WebSearchInputSchema.parse({ query: "q", nope: 1 }));
});

test("输出接受可选 channel，且缺省时仍合法", () => {
  // 注意：WebSearchOutputSchema 是 strict，且没有 truncated 字段（那是 WebFetchOutput 的）。
  const base = { query: "q", results: [], sources: [], durationMs: 1 };
  assert.ok(WebSearchOutputSchema.safeParse(base).success);
  assert.ok(
    WebSearchOutputSchema.safeParse({ ...base, channel: { kind: "tavily", label: "工作用" } }).success,
  );
});

test("工具描述不再声称 US-only", () => {
  const description = buildWebSearchProviderDescription(new Date("2026-09-29T00:00:00Z"));
  assert.ok(!/US-only/.test(description));
  assert.match(description, /current month is September 2026/);
});

test("工具名未变（模型侧签名保持单一形状）", () => {
  assert.equal(WEBSEARCH_TOOL_NAME, "WebSearch");
});
```

- [ ] **Step 2: 跑测试确认失败** — Expected: FAIL（`buildWebSearchProviderDescription` 未导出；`max_results` 未知键）

- [ ] **Step 3: 实现**

`apps/zcode-cli/packages/contracts/src/tools/websearch.ts`：

```ts
// FORK(search-providers): 渠道只取自己需要的参数：服务端渠道用 maxUses，Tavily 渠道用 max_results；
// 见 docs/features/search-providers/design.md §8
const WebSearchProviderInputSchema = z
  .object({
    query: z.string().min(2).describe("The search query to use"),
    allowed_domains: z.array(z.string()).optional().describe("Only include search results from these domains"),
    blocked_domains: z.array(z.string()).optional().describe("Never include search results from these domains"),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      // 20 是我们的产品钳制（取厂商文档值）。实测服务端并不强制该上限（25 会返回 25 条），
      // 所以这里的目标是让模型有一个可预期的上界，而不是替厂商兜错。
      .describe("Maximum number of results to return, for channels that support it"),
  })
  .strict();
```

输出 schema 增加一个可选字段（`.strict()` 必须显式声明）：

```ts
// FORK(search-providers): 记录实际命中的渠道，供日志与诊断；不进模型可见文本
channel: z.object({ kind: z.string(), label: z.string() }).strict().optional(),
```

`apps/zcode-cli/packages/core/src/tool/handlers/websearch.ts`：

- 导出 `buildWebSearchProviderDescription`（去掉 `US-only` 那一句，其余不动）。
- 把现有「构造 provider-native 契约 + 流式收集 + `buildWebSearchOutput`」的整段逻辑收敛成一个内部函数 `executeProviderNativeSearch(input, context, request): Promise<ModelTextResult>`（内容原样搬运，不重写归并语义）。
- **依赖方向必须单向**（handler → fork 模块）。服务端渠道由 handler 自己构造后传进去，**不能**让 fork 模块反过来 import handler（那会形成循环依赖）：

```ts
// FORK-BEGIN(search-providers)
const serverChannel =
  context.model?.properties.supportsNativeWebSearch === true
    ? createServerSearchChannel({
        label: "服务端搜索",
        execute: (request) => executeProviderNativeSearch(parsed, context, request),
      })
    : undefined;

const channels = buildSearchChannelChain({
  ...(serverChannel ? { serverChannel } : {}),
  ...(context.httpClientPort ? { httpClientPort: context.httpClientPort } : {}),
});

const outcome = await runSearchChannels({
  channels,
  request: {
    query: parsed.query,
    ...(parsed.allowed_domains ? { allowedDomains: parsed.allowed_domains } : {}),
    ...(parsed.blocked_domains ? { blockedDomains: parsed.blocked_domains } : {}),
    ...(parsed.maxUses === undefined ? {} : { maxUses: parsed.maxUses }),
    ...(parsed.max_results === undefined ? {} : { maxResults: parsed.max_results }),
    ...(context.abortSignal ? { signal: context.abortSignal } : {}),
  },
});

for (const attempt of outcome.attempts) {
  // 工具层没有 logger（ToolExecutionContext 不暴露它），与 tool/registry.ts 的既有做法一致用 console.warn。
  // 成功降级的唯一痕迹就在这里：不记下来，「为什么这次没走服务端搜索」永远查不出。
  console.warn(
    `[search-providers] ${attempt.channelKind}(${attempt.channelLabel}) failed, fell through: ${attempt.reason}`,
  );
}

return {
  ...buildWebSearchOutput(parsed, outcome.result, startedAt),
  channel: { kind: outcome.channelKind, label: outcome.channelLabel },
};
// FORK-END(search-providers)
```

`buildSearchChannelChain` 新增在 fork 目录的 `channels.ts`（Task 4 的文件）：

```ts
export function buildSearchChannelChain(input: {
  homeDir?: string;
  httpClientPort?: HttpClientPort;
  serverChannel?: SearchChannel;
}): SearchChannel[] {
  const chain: SearchChannel[] = [];
  if (input.serverChannel) chain.push(input.serverChannel);
  if (input.httpClientPort) {
    chain.push(...loadForkSearchChannels({ ...input, httpClientPort: input.httpClientPort }));
  }
  return chain;
}
```

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS（4 例）
- [ ] **Step 5: 提交**

```bash
git add apps/zcode-cli/packages/core/src/tool/handlers/websearch.ts apps/zcode-cli/packages/contracts/src/tools/websearch.ts apps/zcode-cli/packages/core/src/fork/search-providers/channels.ts apps/zcode-cli/packages/core/test/forkSearchProvidersHandler.test.ts
git commit -m "feat(search-providers): WebSearch 处理器接入渠道链"
```

---

### Task 7: host 文件存储与服务

**Files:**
- Create: `packages/services/src/fork/search-providers.ts`、`packages/desktop/src/host/fork/search-providers/file-store.ts`、`.../service.ts`
- Modify: `packages/services/src/accessor.ts`、`packages/desktop/src/host/index.ts`、`packages/client/src/remoteServiceAccess.ts`
- Test: `packages/desktop/test/forkSearchProvidersFileStore.test.ts`

**Interfaces:**
- Consumes: 渠道文件契约（Task 1）
- Produces: `IForkSearchProvidersService`、`createForkSearchProvidersFileStore({ filePath })`、`createForkSearchProvidersService({ store })`

- [ ] **Step 1: 写失败的测试**

```ts
// packages/desktop/test/forkSearchProvidersFileStore.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ForkSearchProvidersFile } from "@zcode/shared";
import { createForkSearchProvidersService } from "../src/host/fork/search-providers/service.js";
import { createForkSearchProvidersFileStore } from "../src/host/fork/search-providers/file-store.js";

function serviceAt(file: string) {
  return createForkSearchProvidersService({ store: createForkSearchProvidersFileStore({ filePath: file }) });
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
    JSON.stringify({ version: 99, channels: [{ id: "a", kind: "tavily", enabled: true, apiKey: "k" }] }),
    "utf8",
  );
  assert.deepEqual((await serviceAt(file).list()).channels, []);
});
```

- [ ] **Step 2: 跑测试确认失败** — Expected: FAIL（Cannot find module）

- [ ] **Step 3: 实现**

`packages/services/src/fork/search-providers.ts`（照 `fork/webdav.ts` 的形状）：

```ts
import type {
  ForkSearchProvidersFile,
} from "@zcode/shared";
import { FORK_SEARCH_PROVIDERS_CHANNEL } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IForkSearchProvidersService {
  list(): Promise<ForkSearchProvidersFile>;
  addChannel(input: { kind: "tavily"; label: string; apiKey: string }): Promise<ForkSearchProvidersFile>;
  updateChannel(
    id: string,
    patch: { label?: string; apiKey?: string; enabled?: boolean },
  ): Promise<ForkSearchProvidersFile>;
  removeChannel(id: string): Promise<ForkSearchProvidersFile>;
  reorder(ids: string[]): Promise<ForkSearchProvidersFile>;
}

export const IForkSearchProvidersService =
  createServiceDescriptor<IForkSearchProvidersService>(FORK_SEARCH_PROVIDERS_CHANNEL);
```

`file-store.ts`：只做 IO，不做业务判断。

```ts
// packages/desktop/src/host/fork/search-providers/file-store.ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  EMPTY_FORK_SEARCH_PROVIDERS_FILE,
  parseForkSearchProvidersFile,
  type ForkSearchProvidersFile,
} from "@zcode/shared";

export interface ForkSearchProvidersFileStore {
  read(): Promise<{ file: ForkSearchProvidersFile; problems: string[] }>;
  write(file: ForkSearchProvidersFile): Promise<void>;
}

export function createForkSearchProvidersFileStore(input: {
  filePath: string;
  logger: { warn(message: string, detail?: unknown): void };
}): ForkSearchProvidersFileStore {
  return {
    async read() {
      let raw: string;
      try {
        raw = await readFile(input.filePath, "utf8");
      } catch (error) {
        // 文件不存在是正常状态（还没配过渠道）；其它读失败同样降级——
        // 渠道文件是可选项，不能让设置页整页打不开。
        if (!isNotFound(error)) {
          input.logger.warn(`[search-providers] 读取渠道文件失败: ${describe(error)}`);
        }
        return { file: { ...EMPTY_FORK_SEARCH_PROVIDERS_FILE }, problems: [] };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch (error) {
        input.logger.warn(`[search-providers] 渠道文件不是合法 JSON: ${describe(error)}`);
        return { file: { ...EMPTY_FORK_SEARCH_PROVIDERS_FILE }, problems: ["JSON 解析失败"] };
      }
      const result = parseForkSearchProvidersFile(parsed);
      for (const problem of result.problems) {
        input.logger.warn(`[search-providers] ${problem}`);
      }
      return result;
    },
    async write(file) {
      await mkdir(dirname(input.filePath), { recursive: true });
      const temporaryPath = `${input.filePath}.${process.pid}.tmp`;
      // 临时文件 + rename：读者永远看不到半截文件（CLI 侧是 statSync+readFileSync，必须有这个保证）。
      await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
      await rename(temporaryPath, input.filePath);
    },
  };
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

**并发边界（写清楚，不假装有锁）**：同一 host 进程内的多次编辑由 `service.ts` 的 promise 队列串行化，不会出现读-改-写交错；跨窗口（多 host 进程）与 WebDAV 恢复并发时是**整份文件 last-write-wins**。这里刻意不引入文件锁：WebDAV 那把锁是 `webdav/service.ts` 的私有实现，抽出来要动已交付的功能；而且即便加锁，两个「整体替换同一份文件」的意图依然是语义冲突，锁只能把它们排队、仍会丢掉其中一个。原子 rename 已经消除了真正危险的部分（读到半截文件）。这条取舍写进 `implementation.md` 的已知边界。

`service.ts`：`list/add/update/remove/reorder`，每次操作都是「读 → 改 → 写」的串行事务（同进程内用一把 promise 队列串行化；跨进程为整份文件 last-write-wins，理由见上）。`addChannel` 的 id 用 `crypto.randomUUID()`，label 原样保存（不 trim 成空串以外的东西，也不落日志）。

`packages/desktop/src/host/fork/search-providers/service.ts` 的 `filePath` 必须这样解析：

```ts
// FORK(search-providers): 路径的唯一真源是 CLI 配置目录（homedir + nativeConfigDir）。
// 刻意不用 getDataBaseDir()/getZCodeDataRootDir()：它们在隔离 home / ZCODE_DATA_BASE_DIR
// 下会与 CLI 的解析分叉，症状是「UI 配了、模型用不到」。见 design.md §6.2。
const filePath = resolveForkSearchProvidersFilePath(homedir());
```

注册与暴露：`packages/desktop/src/host/index.ts` 里照 `IForkWebdavService` 的写法 `services.register(IForkSearchProvidersService, ...)`（仅在桌面 host 装配，条件与 `forkCredentialService` 同款可选）；`packages/client/src/remoteServiceAccess.ts` 加 `ProxyChannel.toService<IForkSearchProvidersService>(...)`；`packages/services/src/accessor.ts` 加可选字段。三处各打一个 `FORK(search-providers)` 标记。

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS（5 例）
- [ ] **Step 5: 提交**

```bash
git add packages/services/src/fork/search-providers.ts packages/services/src/accessor.ts packages/desktop/src/host/fork/search-providers/ packages/desktop/src/host/index.ts packages/client/src/remoteServiceAccess.ts packages/desktop/test/forkSearchProvidersFileStore.test.ts
git commit -m "feat(search-providers): host 渠道文件服务"
```

---

### Task 8: WebDAV 同步清单

**Files:**
- Modify: `packages/desktop/src/host/fork/webdav-sync/manifest.ts`、`packages/desktop/src/host/index.ts`（`resolveBase`）

**Interfaces:**
- Consumes: Task 1 的路径函数
- Produces: `ForkSyncBase` 新增 `"cliConfigDir"` 变体

- [ ] **Step 1: 写失败的测试**

```ts
// packages/desktop/test/forkSearchProvidersSyncEntry.test.ts
import test from "node:test";
import assert from "node:assert/strict";
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
```

- [ ] **Step 2: 跑测试确认失败** — Expected: FAIL（找不到条目）

- [ ] **Step 3: 实现**

`ForkSyncBase` 增加变体，清单增加条目（fork 自有文件，无需 FORK 标记）；`packages/desktop/src/host/index.ts` 的 `resolveBase` 增加分支（该文件需要补 `homedir` 与 `ZCODE_AGENT_RUNTIME` 的 import）：

```ts
// FORK(search-providers): 渠道文件在 CLI 配置目录，不在 appConfigDir/storageRoot；
// 两侧解析必须一致，见 docs/features/search-providers/design.md §6.2
resolveBase: (base: ForkSyncBase) =>
  base === "appConfigDir"
    ? forkAppConfigDir
    : base === "cliConfigDir"
      ? join(homedir(), ZCODE_AGENT_RUNTIME.nativeConfigDir)
      : forkStorageRoot,
```

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS
- [ ] **Step 5: 提交**

```bash
git add packages/desktop/src/host/fork/webdav-sync/manifest.ts packages/desktop/src/host/index.ts packages/desktop/test/forkSearchProvidersSyncEntry.test.ts
git commit -m "feat(search-providers): 渠道文件纳入 WebDAV 同步清单"
```

---

### Task 9: 设置页「搜索」栏目

**Files:**
- Create: `packages/ui/src/fork/search-providers/useForkSearchProviders.ts`、`.../SearchProvidersSection.tsx`
- Modify: `packages/ui/src/settings/settingsPageConfig.ts`、`packages/ui/src/lib/settingsNavigation.ts`、`packages/ui/src/SettingsPage.tsx`、`packages/ui/src/i18n/locales/zh-CN.ts`、`en-US.ts`

**Interfaces:**
- Consumes: `IForkSearchProvidersService`（Task 7）经 `useServices().forkSearchProvidersService`
- Produces: section id `searchProviders`

- [ ] **Step 1: 写失败的测试**

```ts
// packages/ui/test/forkSearchProvidersSection.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { SETTINGS_SECTIONS } from "../src/settings/settingsPageConfig.js";
import { isSettingsSectionId } from "../src/lib/settingsNavigation.js";

// 注意：不要断言 HIDDEN_SETTINGS_SECTIONS —— 它是模块私有常量（settingsNavigation.ts:40 未导出），
// 而且 SETTINGS_SECTIONS 已经用 isSettingsSectionEnabled 过滤过隐藏栏目，断言它即可。
test("搜索栏目已注册且可导航", () => {
  assert.ok(SETTINGS_SECTIONS.some((section) => section.id === "searchProviders"));
  assert.equal(isSettingsSectionId("searchProviders"), true);
});

test("栏目文案在两种语言里都有", async () => {
  const zh = (await import("../src/i18n/locales/zh-CN.js")).default as Record<string, string>;
  const en = (await import("../src/i18n/locales/en-US.js")).default as Record<string, string>;
  for (const key of [
    "settings.searchProviders.title",
    "settings.searchProviders.serverChannel",
    "settings.searchProviders.keySyncHint",
  ]) {
    assert.ok(zh[key], `zh-CN 缺少 ${key}`);
    assert.ok(en[key], `en-US 缺少 ${key}`);
  }
});
```

> 该测试是纯注册表断言，不需要 React 渲染；交互行为走 Task 10 的 E2E 场景。

- [ ] **Step 2: 跑测试确认失败** — Expected: FAIL

- [ ] **Step 3: 实现**

- `settingsPageConfig.ts`：`BASE_SETTINGS_SECTIONS` 增加 `{ id: "searchProviders", icon: Search, titleId: "settings.searchProviders.title", groupId: "basics" }`，逐处打 `FORK(search-providers)` 单点标记。
- `settingsNavigation.ts`：`SettingsSectionId` 联合类型与 `isSettingsSectionId` 守卫各加一处（这两处必须同时改，只改一处会让「上次所在栏目」恢复失效），打标记。
- `SettingsPage.tsx`：加 import 与渲染分支 `) : activeSection === "searchProviders" ? (<SearchProvidersSection />)`，打标记。
- `useForkSearchProviders.ts`：照 `useForkWebdav` 的结构——`available`、`channels`、`busy`、`error`、`refresh`，以及 `add/update/remove/reorder` 包装，错误统一落 `error`。
- **先定位活动模型的读取路径**（只读端首行依赖它，且**不新建第二套读取**）：

```bash
rg -n "supportsNativeWebSearch" packages/ui/src --glob '!**/fork/**'
rg -n "activeModel|selectedModel" packages/ui/src/store packages/ui/src/hooks | head
```

Expected: 模型设置页已经能读到 `supportsNativeWebSearch`（`ProviderModelMetadata.ts:87` 与 `ProviderModelMetadataDialog.tsx:336` 就是在这条读取上工作的）。把那一处读取路径记为 `readActiveModelNativeSearchEnabled()` 的落点，**直接复用其数据源**。若确实没有「活动模型」的概念（只有 provider/model 配置列表），则该行改为显示「服务端搜索由模型配置决定，见模型设置」的静态说明，不做状态推导——**不允许**为了让这一行显示状态而新增一套活动模型读取。

- `SearchProvidersSection.tsx` 结构：

```tsx
// FORK(search-providers): 设置页「搜索」栏目
export function SearchProvidersSection(): JSX.Element {
  const controller = useForkSearchProviders();
  const serverNativeEnabled = readActiveModelNativeSearchEnabled(); // 上一步定位到的既有读取
  if (!controller.available) {
    return <p className="text-ui-sm text-foreground-subtle" data-testid="search-providers-unavailable">
      <FormattedMessage id="settings.searchProviders.unavailable" />
    </p>;
  }
  return (
    <div className="flex flex-col gap-4" data-testid="search-providers-section">
      {/* 只读首行：链条的第一环，不可拖不可禁 */}
      <ServerChannelRow enabled={serverNativeEnabled} />
      {/* 渠道列表：拖拽排序 + 启用开关 + 备注 + 删除 */}
      <ChannelList controller={controller} />
      <AddChannelDialog onSubmit={controller.add} />
      <p className="text-ui-sm text-foreground-subtle">
        <FormattedMessage id="settings.searchProviders.priorityHint" />
      </p>
      <p className="text-ui-sm text-foreground-subtle">
        <FormattedMessage id="settings.searchProviders.keySyncHint" />
      </p>
    </div>
  );
}
```

key 输入复用 `ApiKeyInput`（`packages/ui/src/settings/model-provider-section/ApiKeyInput.tsx`），拖拽沿用仓库既有列表拖拽实现（`packages/ui` 内已有排序列表时可复用其 DnD 基元；若无则用原生 HTML5 draggable，不引入新依赖）。
- i18n 键（zh / en 双份）：`settings.searchProviders.title`（搜索 / Search）、`.serverChannel`（服务端搜索（由模型配置决定）/ Server-side search (decided by model config)）、`.serverChannelEnabled`、`.serverChannelDisabled`、`.channels`、`.add`、`.addTitle`、`.kind`、`.label`、`.apiKey`、`.enabled`、`.remove`、`.empty`、`.unavailable`、`.priorityHint`（搜索时自上而下尝试，前一个失败自动降级到下一个 / Channels are tried top-down; a failure falls through to the next）、`.keySyncHint`（Key 以明文保存，并会随配置备份同步到你的 WebDAV / Keys are stored in plain text and synced to your WebDAV with config backups）。

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS
- [ ] **Step 5: 提交**

```bash
git add packages/ui/src/fork/search-providers/ packages/ui/src/settings/settingsPageConfig.ts packages/ui/src/lib/settingsNavigation.ts packages/ui/src/SettingsPage.tsx packages/ui/src/i18n/locales/zh-CN.ts packages/ui/src/i18n/locales/en-US.ts packages/ui/test/forkSearchProvidersSection.test.ts
git commit -m "feat(search-providers): 设置页搜索栏目"
```

---

### Task 10: 文档、E2E 与全量验证

**Files:**
- Create: `docs/features/search-providers/implementation.md`
- Modify: `FEATURES.md`

- [ ] **Step 1: 跑全量验证**

```bash
pnpm typecheck && pnpm lint && pnpm test:unit && pnpm architecture:check -- --changed && pnpm fork:check-removals
```

Expected: 全绿。若 `architecture:check` 因新增模块未登记而失败，在 `architecture-policy.yaml` 里为新模块登记（`managed: true` + 必要的 `publicEntrypoints` / `layers`）。

- [ ] **Step 2: 自查标记与移除不变量**

```bash
rg -n "FORK\(|FORK-BEGIN\(" --glob '!AGENTS.md' --glob '!FEATURES.md'
```

Expected: `search-providers` 标记出现在 §9 表列出的每一处上游文件里；无遗漏、无多余。

- [ ] **Step 3: 写 implementation.md**

内容：落地位置（每个新文件的职责）、关键改动、上游接线点与标记清单（逐文件逐行）、Tavily 厂商契约（端点/鉴权/字段/错误码，注明取自官方 OpenAPI 与取数日期）、验证记录（每条验收场景的执行结果）、**未验证项与验证方法**（至少包含：打包产物内的真实 Tavily 调用、WebDAV 同步往返、桌面隔离 home 下的两侧路径一致性）。

- [ ] **Step 4: 登记 FEATURES.md**

按仓库格式追加 `## 网络搜索渠道 (search-providers)`：状态、需求背景、修改内容、修改文件、上游改动标记、设计文档、实现文档、已知边界、上游同步记录（暂无）。

- [ ] **Step 5: 提交**

```bash
git add FEATURES.md docs/features/search-providers/implementation.md
git commit -m "docs(search-providers): 实现记录与 FEATURES 登记"
```

---

## 手工验收清单（打包产物，需在实现完成后执行）

1. 桌面隔离 home 启动 → 设置页加一条 Tavily 渠道 → 对比「设置页写入的绝对路径」与「CLI 日志里读取的绝对路径」是同一个文件（design.md 验收场景 12）。
2. 模型不支持服务端搜索时：无渠道 → 工具不出现；加一条渠道 → 工具出现且调用成功。
3. 故意填错 key → 调用得到 401 结构化失败，日志里有该渠道的尝试记录。
4. 配两条渠道、第一条 key 无效 → 自动降级到第二条成功。
5. **拖拽把第二条拖到第一条之前 → 下一次调用按新顺序尝试**（顺序必须真的影响路由，不是只影响 UI）；**关掉唯一启用中的渠道 → 下一次调用里 `WebSearch` 不再出现**（design.md 验收场景 8、14）。
6. WebDAV 备份 → 远端含 `cli-fork/settings.json`；恢复到干净环境后渠道表一致。
