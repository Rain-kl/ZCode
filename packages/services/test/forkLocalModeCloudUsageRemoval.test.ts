/**
 * 契约测试：本地模式下云账号额度链路必须已经断开。
 *
 * 为什么需要这条测试：`FORK_LOCAL_MODE` 曾经只覆盖 UI 门面（首屏登录、侧栏登录/登出、
 * 升级入口）与部分后台通知链路，`useUsageEntitlement` / `getEntitlementSnapshot` /
 * account provider 可用性查询这几条云链路完全没有判定，启动时仍会带着残留的
 * `zcodejwttoken` 请求 `zcode.z.ai/api/v1/zcode-plan/billing/balance`，
 * 把账号套餐与额度打回本地日志。这类"入口屏蔽但后台仍出网"的回归不会有类型错误，
 * 只能在行为层面断言。
 *
 * 上游若恢复云账号体系（或重新实装 Coding Plan 额度查询），本测试应整体删除并同步
 * FEATURES.md 的 local-mode 条目——它断言的是本 fork 的产品不变量，不是上游实现细节。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createUsageStatsService } from "../src/usage-stats/usageStatsService.js";

const APP_USAGE_SNAPSHOT = {
  range: "7d" as const,
  generatedAt: 0,
  timeZone: "UTC",
  estimatedTokenCharDivisor: 4,
  summary: {
    totalSessions: 0,
    totalMessages: 0,
    totalCharacters: 0,
    totalEstimatedTokens: 0,
    activeDays: 0,
    mostActiveDay: null,
    favoriteModel: null,
    longestSessionMs: 0,
    longestStreakDays: 0,
    currentStreakDays: 0,
    firstActivityDate: null,
    lastActivityDate: null,
    peakHour: null,
  },
  daily: [],
  heatmap: { cells: [] } as never,
  models: [],
};

/** 只记录调用次数；任何网络访问都必须先经过这里，因此计数为 0 即等价于"未出网"。 */
function createSpyAgentService() {
  const calls: Array<{ range: unknown; timeZone: unknown }> = [];
  return {
    calls,
    service: {
      async getAppUsageStats(input: { range: unknown; timeZone: unknown }) {
        calls.push(input);
        return APP_USAGE_SNAPSHOT;
      },
    },
  };
}

function createService(overrides: { apiClient?: unknown } = {}) {
  const spy = createSpyAgentService();
  const apiClient =
    overrides.apiClient ??
    ({
      request() {
        throw new Error("云请求不应发生：本地模式下 apiClient 不得被调用");
      },
    } as never);

  const service = createUsageStatsService({
    apiClient,
    accountRequestAuthService: {
      async resolveAccessCurrent() {
        throw new Error("云凭据不应被读取：应使用本地统计链路");
      },
      async resolveCurrent() {
        throw new Error("云凭据不应被读取：应使用本地统计链路");
      },
      async assertCurrent() {
        throw new Error("云凭据不应被读取：应使用本地统计链路");
      },
    } as never,
    credentialService: {
      async load() {
        throw new Error("云凭据不应被读取：应使用本地统计链路");
      },
    } as never,
    zcodeAgentService: spy.service as never,
  });

  return { service, spy };
}

test("本地统计 getAppUsageSnapshot 仍走 agent 数据库，不受云链路下线影响", async () => {
  const { service, spy } = createService();

  const snapshot = await service.getAppUsageSnapshot({ range: "7d", timeZone: "UTC" });

  assert.equal(spy.calls.length, 1, "本地统计必须仍然请求 agent 数据库");
  assert.deepEqual(spy.calls[0], { range: "7d", timeZone: "UTC" });
  assert.equal(snapshot, APP_USAGE_SNAPSHOT);
});

test("getEntitlementSnapshot 返回 fail-closed 的 not_configured，且不触达网络与凭据", async () => {
  const { service } = createService();

  const snapshot = await service.getEntitlementSnapshot({
    preferredProviderId: "account:bigmodel-start-plan",
    includeSubscription: true,
  });

  // UI 依赖这个状态把云套餐数据源判为「无有效套餐」（hasActiveCodingPlanSnapshot 为假），
  // 从而使 Coding Plan 面板自然消失，而不是显示上一账号的额度。
  assert.equal(snapshot.unavailableReason, "not_configured");
  assert.equal(snapshot.authenticated, false);
  assert.equal(snapshot.provider, null);
  assert.equal(snapshot.quota, null);
  assert.equal(snapshot.subscription, null);
});

test("云套餐只读方法显式失败，且错误信息带方法名与移除原因（不得静默返回空数据）", async () => {
  const { service } = createService();

  const invocations: Array<[string, () => Promise<unknown>]> = [
    [
      "getCodingPlanUsageSnapshot",
      () =>
        service.getCodingPlanUsageSnapshot({
          range: "7d",
          preferredProviderId: "account:bigmodel-start-plan",
        } as never),
    ],
    [
      "getCodingPlanResetStatus",
      () =>
        service.getCodingPlanResetStatus({
          preferredProviderId: "account:bigmodel-start-plan",
        } as never),
    ],
    [
      "requestCodingPlanResetOpportunity",
      () =>
        service.requestCodingPlanResetOpportunity({
          preferredProviderId: "account:bigmodel-start-plan",
          idempotencyKey: "k",
        } as never),
    ],
    [
      "useCodingPlanReset",
      () =>
        service.useCodingPlanReset({
          preferredProviderId: "account:bigmodel-start-plan",
          idempotencyKey: "k",
          resetType: "FIVE_HOUR",
        } as never),
    ],
    [
      "markCodingPlanResetHistoryRead",
      () =>
        service.markCodingPlanResetHistoryRead({
          preferredProviderId: "account:bigmodel-start-plan",
        } as never),
    ],
    [
      "getSnapshot",
      () =>
        service.getSnapshot({
          range: "7d",
          preferredProviderId: "account:bigmodel-start-plan",
        } as never),
    ],
  ];

  for (const [method, invoke] of invocations) {
    await assert.rejects(invoke, (error: unknown) => {
      assert.ok(error instanceof Error, `${method} 必须抛出 Error`);
      assert.match(error.message, new RegExp(method), `错误信息必须带上方法名: ${method}`);
      assert.match(error.message, /FORK_LOCAL_MODE|已移除云账号额度链路/);
      return true;
    });
  }
});
