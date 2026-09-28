# local-mode 第①期（入口屏蔽）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 fork 里屏蔽云账号全部入口、停用后台账号链路、移除智谱预置行与左下角用量/升级入口，且不删除任何上游代码。

**Architecture:** 开关与过滤判定集中在 `packages/shared/src/fork/flags.ts`（纯函数，可被 UI 与 host 共用、可单测）；上游文件只在入口处加「开关判断 + 提前返回/过滤」，每处带 `FORK(local-mode)` 标记。UI 屏蔽放在组件内部（`WorkspaceSidebarFooter`），使它的两个挂载点自动生效，减少上游接线。

**Tech Stack:** TypeScript、React 19、Node 24（`node:test` 经 `tsx --test` 运行）、pnpm workspace。

## Global Constraints

- 设计依据：`docs/features/local-mode/design.md`（第 5 节屏蔽点表、第 7 节接线表）。
- 二开标准：`AGENTS.md` 的「二开标准（Fork）」——上游文件改动必须带 `FORK(local-mode)` 标记并指向 `FEATURES.md` 条目；新增文件放 `fork/` 目录。
- 不删除上游代码；所有屏蔽都是「开关判断 + 提前返回/切换渲染」。
- 提交规范：`AGENTS.md` 的「Git 提交规范」——Conventional Commits，只提交本次改动的文件，**禁止推送远程**。
- 每个任务结束必须跑：`pnpm typecheck`、`pnpm lint`（仓库既有命令）。
- 单测命令：`pnpm exec tsx --test <file>`（仓库既有测试文件因 import `@/` 别名不可运行；本计划的测试只写相对导入，不引入 `@/` 别名）。
- 计划范围：本期只做入口屏蔽（`design.md` 第 9 节第 1 期）。第②③④期各自另出计划。

---

### Task 1: fork 开关与过滤判定（含单测）

**Files:**

- Create: `packages/shared/src/fork/flags.ts`
- Create: `packages/shared/test/forkLocalMode.test.ts`
- 参考（只读）: `packages/shared/src/model-provider-types.ts:7-14`（`BUILTIN_MODEL_PROVIDER_IDS`）

**Interfaces:**

- Produces:
  - `FORK_LOCAL_MODE: boolean`
  - `FORK_HIDDEN_PRESET_PROVIDER_IDS: readonly BuiltinModelProviderId[]`
  - `FORK_HIDDEN_CODING_PLAN_PROVIDER_IDS: readonly BuiltinModelProviderId[]`
  - `isCloudAccountSurfaceEnabled(): boolean`
  - `isCloudAccountBackgroundEnabled(): boolean`
  - `isForkHiddenPresetProviderId(id: string): boolean`
  - `isForkHiddenCodingPlanProviderId(id: string): boolean`
  - `filterPresetProviderSpecs<T extends { id: string }>(specs: readonly T[]): T[]`
  - `filterCodingPlanProviderSpecs<T extends { id: string }>(specs: readonly T[]): T[]`

- [ ] **Step 1: 写失败测试**

创建 `packages/shared/test/forkLocalMode.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  FORK_HIDDEN_CODING_PLAN_PROVIDER_IDS,
  FORK_HIDDEN_PRESET_PROVIDER_IDS,
  filterCodingPlanProviderSpecs,
  filterPresetProviderSpecs,
  isCloudAccountBackgroundEnabled,
  isCloudAccountSurfaceEnabled,
  isForkHiddenCodingPlanProviderId,
  isForkHiddenPresetProviderId,
} from "../src/fork/flags.js";
import { BUILTIN_MODEL_PROVIDER_IDS } from "../src/model-provider-types.js";

test("本地模式下云账号入口与后台链路都关闭", () => {
  assert.equal(isCloudAccountSurfaceEnabled(), false);
  assert.equal(isCloudAccountBackgroundEnabled(), false);
});

test("预置提供商过滤只去掉智谱两家，保留其他", () => {
  const specs = [
    { id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan },
    { id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan },
    { id: "personal-provider-a" },
  ];
  assert.deepEqual(
    filterPresetProviderSpecs(specs).map((spec) => spec.id),
    ["personal-provider-a"],
  );
});

test("Coding Plan 行过滤覆盖六个账号套餐 id", () => {
  const specs = Object.values(BUILTIN_MODEL_PROVIDER_IDS).map((id) => ({ id }));
  assert.deepEqual(filterCodingPlanProviderSpecs(specs), []);
});

test("隐藏 id 列表都是内置账号 id，避免与上游常量漂移", () => {
  const builtinIds = new Set<string>(Object.values(BUILTIN_MODEL_PROVIDER_IDS));
  for (const id of [...FORK_HIDDEN_PRESET_PROVIDER_IDS, ...FORK_HIDDEN_CODING_PLAN_PROVIDER_IDS]) {
    assert.equal(builtinIds.has(id), true, `${id} 不在 BUILTIN_MODEL_PROVIDER_IDS 中`);
  }
});

test("判定函数对非账号 id 返回 false", () => {
  assert.equal(isForkHiddenPresetProviderId("personal-provider-a"), false);
  assert.equal(isForkHiddenCodingPlanProviderId("personal-provider-a"), false);
  assert.equal(isForkHiddenCodingPlanProviderId(BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan), true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec tsx --test packages/shared/test/forkLocalMode.test.ts`
Expected: FAIL —— `Cannot find module '../src/fork/flags.js'`

- [ ] **Step 3: 写最小实现**

创建 `packages/shared/src/fork/flags.ts`：

```ts
/**
 * 本地模式（fork local-mode）的集中开关与判定。
 * 见 FEATURES.md 的 local-mode 条目与 docs/features/local-mode/design.md。
 * 只放常量与纯函数：除同包模块外不引入依赖，组件与服务都从这里取判定，避免开关漂移。
 */
import { BUILTIN_MODEL_PROVIDER_IDS } from "../model-provider-types.js";
import type { BuiltinModelProviderId } from "../model-provider-types.js";

/** 本地模式总开关。true = 屏蔽云账号体系，只保留自定义提供商。 */
export const FORK_LOCAL_MODE = true;

/** 本地模式下从模型设置隐藏的预置提供商（智谱系列）。 */
export const FORK_HIDDEN_PRESET_PROVIDER_IDS: readonly BuiltinModelProviderId[] = [
  BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
  BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
];

/** 本地模式下从模型设置隐藏的 Coding Plan 套餐行。 */
export const FORK_HIDDEN_CODING_PLAN_PROVIDER_IDS: readonly BuiltinModelProviderId[] = [
  BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
  BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan,
  BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
  BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
  BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
  BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
];

/** 云账号相关界面入口（首屏登录引导、登录页、手动登录、用量、升级）是否展示。 */
export function isCloudAccountSurfaceEnabled(): boolean {
  return !FORK_LOCAL_MODE;
}

/** 云账号后台链路（静默会话恢复、账号 provider 下发与刷新）是否启用。 */
export function isCloudAccountBackgroundEnabled(): boolean {
  return !FORK_LOCAL_MODE;
}

export function isForkHiddenPresetProviderId(id: string): boolean {
  return FORK_HIDDEN_PRESET_PROVIDER_IDS.includes(id as BuiltinModelProviderId);
}

export function isForkHiddenCodingPlanProviderId(id: string): boolean {
  return FORK_HIDDEN_CODING_PLAN_PROVIDER_IDS.includes(id as BuiltinModelProviderId);
}

/** 按本地模式过滤预置提供商卡片；非本地模式返回原列表（保持上游行为可回退）。 */
export function filterPresetProviderSpecs<T extends { id: string }>(specs: readonly T[]): T[] {
  if (!FORK_LOCAL_MODE) {
    return [...specs];
  }
  return specs.filter((spec) => !isForkHiddenPresetProviderId(spec.id));
}

/** 按本地模式过滤 Coding Plan 套餐行；非本地模式返回原列表。 */
export function filterCodingPlanProviderSpecs<T extends { id: string }>(specs: readonly T[]): T[] {
  if (!FORK_LOCAL_MODE) {
    return [...specs];
  }
  return specs.filter((spec) => !isForkHiddenCodingPlanProviderId(spec.id));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec tsx --test packages/shared/test/forkLocalMode.test.ts`
Expected: PASS（5 tests, 0 fail）

- [ ] **Step 5: 跑仓库门禁并提交**

```bash
pnpm typecheck && pnpm lint
git add packages/shared/src/fork/flags.ts packages/shared/test/forkLocalMode.test.ts
git commit -m "feat(local-mode): add fork flag and zhipu filter helpers"
```

---

### Task 2: 首屏登录入口屏蔽（Root）

**Files:**

- Modify: `packages/ui/src/lib/rootStartupGate.ts:43-45`
- Modify: `packages/ui/src/Root.tsx:205`（会话过期标记消费）、`:870-872`（手动登录回调）、`:962`、`:1059`（父级传入的 `onLogin`）、`:982-991`（WelcomeScreen 渲染）
- 参考（只读）: Task 1 的 `packages/shared/src/fork/flags.ts`

**Interfaces:**

- Consumes: `isCloudAccountSurfaceEnabled()`（Task 1）

- [ ] **Step 1: 屏蔽启动登录门禁**

`packages/ui/src/lib/rootStartupGate.ts` 顶部加导入，并改函数体：

```ts
import { isCloudAccountSurfaceEnabled } from "@zcode/shared";

export function shouldEnableProviderAvailabilityLoginEntryGuard(): boolean {
  // FORK(local-mode): 本地模式不引导云账号登录；见 FEATURES.md 的 local-mode 条目
  return isCloudAccountSurfaceEnabled();
}
```

- [ ] **Step 2: 不渲染 WelcomeScreen**

`packages/ui/src/Root.tsx:982` 的条件改为：

```tsx
  // FORK(local-mode): 本地模式不渲染云账号登录页（首屏 WebDAV 引导在第④期接入）
  if (welcomeScreenOpenReason && isCloudAccountSurfaceEnabled()) {
```

并在文件顶部（现有 `@zcode/shared` 导入处）补 `isCloudAccountSurfaceEnabled`。

- [ ] **Step 3: 不注入手动登录回调**

`Root.tsx:870` 改为：

```ts
const handleOpenLoginEntry = () => {
  // FORK(local-mode): 本地模式没有云账号登录入口
  if (!isCloudAccountSurfaceEnabled()) {
    return;
  }
  setWelcomeScreenOpenReason("manual-login");
};
```

`Root.tsx` 里传给侧栏与设置页的 `onLogin`（约 `:962`、`:1059`）改为：

```tsx
            onLogin={isCloudAccountSurfaceEnabled() ? handleOpenLoginEntry : undefined}
```

- [ ] **Step 4: 不消费会话过期标记**

`Root.tsx:205` 附近消费 `zcodeJwtInvalidRestartMarker` 的位置加同一开关（读取到也不进入 WelcomeScreen 流程）：

```ts
// FORK(local-mode): 本地模式忽略云账号会话过期标记
if (!isCloudAccountSurfaceEnabled()) {
  return;
}
```

- [ ] **Step 5: 验证类型与 lint，提交**

```bash
pnpm typecheck && pnpm lint
git add packages/ui/src/lib/rootStartupGate.ts packages/ui/src/Root.tsx
git commit -m "feat(local-mode): gate cloud account entry surfaces in root"
```

---

### Task 3: 左下角用量/升级与登录项屏蔽（footer 内部统一判定）

**Files:**

- Modify: `packages/ui/src/WorkspaceSidebarFooter.tsx`（`:138-142` 取数、`:168` 徽标、`:346-351` 用量/升级、`:352-369` 登录/登出）
- 说明：footer 有两个挂载点（`WorkspaceSidebar.tsx:1645`、`SettingsPage.tsx:1533`），把判定放在组件内部即可**同时**生效，不必改这两个上游文件。

**Interfaces:**

- Consumes: `isCloudAccountSurfaceEnabled()`（Task 1）

- [ ] **Step 1: 停止取数并隐藏用量徽标**

```tsx
// FORK(local-mode): 本地模式不请求用量/套餐数据，也不显示套餐徽标
const cloudAccountSurfaceEnabled = isCloudAccountSurfaceEnabled();
const usageSummaryState = useWorkspaceSidebarFooterUsageSummaryState({
  enabled: cloudAccountSurfaceEnabled,
  workspaceIdentity,
  workspacePath,
});
```

并把 `:168` 徽标条件改为：

```tsx
{
  cloudAccountSurfaceEnabled && user ? (
    <WorkspaceSidebarFooterPlanBadge state={usageSummaryState} />
  ) : null;
}
```

- [ ] **Step 2: 隐藏「连接使用 / 升级」两项**

`WorkspaceSidebarFooter.tsx:346-351` 包一层条件：

```tsx
{
  /* FORK(local-mode): 本地模式隐藏「使用统计 / 升级续期」入口 */
}
{
  cloudAccountSurfaceEnabled ? (
    <WorkspaceSidebarFooterUsageSummaryContent
      state={usageSummaryState}
      onUsageClick={usageButtonClick}
      onUpgradeClick={onUpgradeClick}
    />
  ) : null;
}
```

- [ ] **Step 3: 隐藏登录/登出菜单项**

`WorkspaceSidebarFooter.tsx:352-369` 的两个条件改为：

```tsx
            {cloudAccountSurfaceEnabled && onLogin && !user ? (
```

```tsx
            {cloudAccountSurfaceEnabled && onLogout ? (
```

- [ ] **Step 4: 处理未登录态头像文案**

`getSidebarProfileBadge`（`:71-80`）在未登录时返回「连接使用」文案，本地模式下不应出现登录引导语义：把 `:134` 的调用改为

```tsx
const profileBadge = cloudAccountSurfaceEnabled
  ? getSidebarProfileBadge(user, intl.formatMessage)
  : getSidebarProfileName(user);
```

- [ ] **Step 5: 验证类型与 lint，提交**

```bash
pnpm typecheck && pnpm lint
git add packages/ui/src/WorkspaceSidebarFooter.tsx
git commit -m "feat(local-mode): hide usage, upgrade and account entries in sidebar footer"
```

---

### Task 4: 停用后台账号链路

**Files:**

- Modify: `packages/ui/src/root/useAccountConnectionLossNotification.ts`（观察 effect 内提前返回）
- Modify: `packages/ui/src/root/useRootOAuthEffects.ts:128`（静默恢复）、`:203`（JWT 失效广播）
- Modify: `packages/services/src/zcode-agent/zcodeAgentService.ts:1381-1385`（账号 provider 下发）

**Interfaces:**

- Consumes: `isCloudAccountBackgroundEnabled()`（Task 1）

- [ ] **Step 1: 停止渲染层账号后台行为**

`packages/ui/src/root/useRootOAuthEffects.ts` 顶部补导入，然后：

````ts
账号断连提醒：`useAccountConnectionLossNotification` 没有 `enabled` 参数，且不能在条件里调用 hook。
因此在它自身的观察 effect 内部提前返回（签名不变）：

`packages/ui/src/root/useAccountConnectionLossNotification.ts`（在第二个 `useEffect` 主体开头）：

```ts
  useEffect(() => {
    // FORK(local-mode): 本地模式不观察云账号连接状态；见 FEATURES.md 的 local-mode 条目
    if (!isCloudAccountBackgroundEnabled()) {
      return;
    }
````

并把该文件加入 Task 4 的 Files 列表与提交范围。

静默恢复（`:128`）在 `restoreOAuthSessionInBackground` 开头提前返回：

```ts
    async function restoreOAuthSessionInBackground() {
      // FORK(local-mode): 本地模式不做云账号会话恢复
      if (!isCloudAccountBackgroundEnabled()) {
        setIsRestoringOAuthSession(false);
        return;
      }
```

JWT 失效广播（`:203`）在 effect 开头提前返回：

```ts
  useEffect(() => {
    // FORK(local-mode): 本地模式不处理云账号 JWT 失效广播
    if (!isCloudAccountBackgroundEnabled()) {
      return;
    }
```

- [ ] **Step 2: 停止 host 向 Agent 下发账号 provider**

`packages/services/src/zcode-agent/zcodeAgentService.ts` 顶部补导入，`syncAccountProviderConfigToClient` 开头：

```ts
  async function syncAccountProviderConfigToClient(params: {
    client: ZCodeProtocolClient;
    reason: string;
  }): Promise<void> {
    // FORK(local-mode): 本地模式不下发云账号 provider 配置；见 FEATURES.md 的 local-mode 条目
    if (!isCloudAccountBackgroundEnabled()) {
      return;
    }
    if (!accountProviderConfigSource) return;
```

- [ ] **Step 3: 验证类型与 lint，提交**

```bash
pnpm typecheck && pnpm lint
git add packages/ui/src/root/useAccountConnectionLossNotification.ts packages/ui/src/root/useRootOAuthEffects.ts packages/services/src/zcode-agent/zcodeAgentService.ts
git commit -m "feat(local-mode): disable cloud account background paths"
```

---

### Task 5: 隐藏预置智谱提供商与套餐行

**Files:**

- Modify: `packages/ui/src/settings/model-provider-section/constants.ts:34-49`、`:77-106`
- Modify: `packages/ui/src/settings/ModelProviderSection.tsx:110-124`

**Interfaces:**

- Consumes: `filterPresetProviderSpecs`、`filterCodingPlanProviderSpecs`、`isForkHiddenCodingPlanProviderId`（Task 1）

- [ ] **Step 1: 过滤两个 spec 列表**

`constants.ts` 顶部补导入，并把两个数组定义为「过滤后的结果」：

```ts
// FORK(local-mode): 本地模式隐藏智谱预置行；见 FEATURES.md 的 local-mode 条目
const ALL_PRESET_PROVIDER_SPECS: PresetProviderSpec[] = [
  /* 原 :34-45 内容不动 */
];
export const PRESET_PROVIDER_SPECS: PresetProviderSpec[] =
  filterPresetProviderSpecs(ALL_PRESET_PROVIDER_SPECS);
```

```ts
const ALL_CODING_PLAN_PROVIDER_SPECS: CodingPlanProviderSpec[] = [
  /* 原 :77-106 内容不动 */
];
export const CODING_PLAN_PROVIDER_SPECS: CodingPlanProviderSpec[] = filterCodingPlanProviderSpecs(
  ALL_CODING_PLAN_PROVIDER_SPECS,
);
```

注意：`PRESET_PROVIDER_SPEC_BY_ID`（`:47-49`）继续基于过滤后的 `PRESET_PROVIDER_SPECS` 构建。

- [ ] **Step 2: 屏蔽套餐深链意图**

`ModelProviderSection.tsx:110-124`：

```ts
function resolveCodingPlanIntentProviderId(
  target: SettingsModelProviderTarget | undefined,
): BuiltinModelProviderId | null {
  // FORK(local-mode): 本地模式没有套餐页，忽略套餐深链意图
  if (!target?.providerId || isForkHiddenCodingPlanProviderId(target.providerId)) {
    return null;
  }
  switch (target.providerId /* 原分支不动 */) {
  }
}
```

- [ ] **Step 3: 验证类型与 lint，提交**

```bash
pnpm typecheck && pnpm lint
git add packages/ui/src/settings/model-provider-section/constants.ts packages/ui/src/settings/ModelProviderSection.tsx
git commit -m "feat(local-mode): hide preset zhipu providers and coding plan rows"
```

---

### Task 6: 标记自查、设计文档回写与验收

**Files:**

- Modify: `docs/features/local-mode/design.md`（第 5.1 节与第 7 节：footer 判定位置改为组件内部，`SettingsPage.tsx` 从接线表移除；接线数 15 → 14）
- Modify: `FEATURES.md`（`local-mode` 条目：状态改为「第①期已实现」、上游改动标记清单同步）

- [ ] **Step 1: 标记自查**

Run: `rg -n "FORK\(local-mode\)" --glob '!AGENTS.md' --glob '!FEATURES.md'`
Expected: 命中 Task 2/3/4/5 的每一处（`rootStartupGate.ts`、`Root.tsx`、`WorkspaceSidebarFooter.tsx`、`useAccountConnectionLossNotification.ts`、`useRootOAuthEffects.ts`、`zcodeAgentService.ts`、`constants.ts`、`ModelProviderSection.tsx`），逐条与 `design.md` 第 7 节表格核对。

- [ ] **Step 2: 全量门禁**

```bash
pnpm typecheck && pnpm lint && pnpm architecture:check
pnpm exec tsx --test packages/shared/test/forkLocalMode.test.ts
```

Expected: typecheck 无错误、lint 0 error（既有 warning 数不变）、架构检查 OK、单测 5 passed。

- [ ] **Step 3: 更新文档并提交**

在 `design.md` 第 5.1 节把「设置页同款 footer」一行的屏蔽方式改为「footer 组件内部统一判定（两个挂载点自动生效）」；第 7 节接线表删除 `SettingsPage.tsx` 行（footer 内部判定已覆盖），并新增 `useAccountConnectionLossNotification.ts` 行，总数保持 15。`FEATURES.md` 条目的状态改为「第①期已实现（入口屏蔽）」，并把上游改动标记清单更新为实际命中的文件。

```bash
git add docs/features/local-mode/design.md FEATURES.md
git commit -m "docs(local-mode): sync wiring table after phase 1"
```

---

## 第②③④期计划（各自另出计划文件）

- **第②期 备份内核**：`packages/desktop/src/host/fork/webdav/**`（WebDAV 客户端、zip 打包/解包、备份与恢复引擎、状态文件）、`packages/services/src/accessor.ts` 与 `packages/client/src/remoteServiceAccess.ts` 的服务接线、`packages/desktop/src/host/index.ts` 注册；用临时脚本驱动验证上传/恢复/冲突/清理，附 zip 往返与 `PROPFIND` 解析单测。
- **第③期 设置页栏目**：`configSync` section（导航类型、导航定义、渲染分支、两个语言文件）+ 面板组件（连接、开关、保留份数、云端备份、云端恢复、备份列表的恢复与删除、冲突横幅）。
- **第④期 首屏与状态项**：首屏 WebDAV 登录卡（可跳过）、应用级冲突弹窗、左下角状态项。

## Self-Review

- **Spec coverage**：`design.md` 第 5.1 节 11 行屏蔽点 → Task 2（启动门禁、登录页、手动登录、会话过期）、Task 3（侧栏登录/登出、用量徽标、用量/升级项、设置页 footer 同款）、Task 5（智谱预置、套餐行、深链意图）；第 5.2 节 4 行停用点 → Task 4（静默恢复、断连提醒、账号 provider 下发）；第 9 节第 1 期 → 全部任务；验收场景 7、8 → Task 6 的手工验证（`pnpm dev:desktop`，见下）。
- **手工验收（Task 6 补充）**：`pnpm dev:desktop` 启动后确认——首屏不再要求登录；侧栏头像菜单无登录/登出、无「使用统计/升级续期」；模型设置里无 Z.ai / BigModel 预置卡与套餐行；自定义提供商可新增并选中使用。
- **Placeholder scan**：无 TBD/TODO；Task 4 Step 1 已按 `useAccountConnectionLossNotification` 的真实签名给出唯一做法（在观察 effect 内提前返回）。
- **Type consistency**：`isCloudAccountSurfaceEnabled` / `isCloudAccountBackgroundEnabled` / `filterPresetProviderSpecs` / `filterCodingPlanProviderSpecs` / `isForkHiddenCodingPlanProviderId` 在 Task 2–5 的使用与 Task 1 的定义一致；过滤函数泛型 `<T extends { id: string }>` 与 `PresetProviderSpec`、`CodingPlanProviderSpec`（均有 `id`）兼容。
