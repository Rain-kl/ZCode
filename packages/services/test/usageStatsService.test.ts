import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, AppUsageSnapshot, ZCodeAccountAccess } from "@zcode/shared";
import { BUILTIN_MODEL_PROVIDER_IDS } from "@zcode/shared";
import type { IZCodeAgentService } from "../src/zcode-agent/zcodeAgent.js";
import { createUsageStatsService } from "../src/usage-stats/usageStatsService.js";
import { resolveCodingPlanUsageTimeRange } from "../src/usage-stats/providers/bigmodelUsageMonitorRange.js";

const TEST_BIGMODEL_PROVIDER_ID = "test-bigmodel-api-provider";
const TEST_ZAI_PROVIDER_ID = "test-zai-api-provider";

function createAppUsageSnapshot(): AppUsageSnapshot {
  return {
    range: "30d",
    generatedAt: 1_900_000_000_000,
    timeZone: "UTC",
    source: "agent-db",
    summary: {
      totalTokens: 104,
      inputTokens: 14,
      outputTokens: 5,
      reasoningTokens: 0,
      cacheCreationTokens: 5,
      cacheReadTokens: 80,
      cacheHitRate: 0.8,
      totalSessions: 1,
      totalTurns: 1,
      toolCallCount: 2,
      toolErrorRate: 0.5,
      modelErrorRate: 0.5,
      avgTimeToFirstTokenMs: 100,
      avgTurnDurationMs: 2000,
      activeDays: 2,
      currentStreakDays: 2,
      longestSessionMs: 2000,
      longestStreakDays: 2,
      peakDayTokens: 104,
      favoriteModel: { modelId: "model-a", totalTokens: 104, share: 1 },
    },
    heatmap: { startDate: null, endDate: null, maxTokens: 100, weeks: [] },
    dailyModelUsage: [],
    models: [],
    tools: [],
  };
}

interface TestUsageProvider {
  id: string;
  name: string;
  enabled: boolean;
  apiKey: string;
}

function createProvider(overrides: Partial<TestUsageProvider>): TestUsageProvider {
  return {
    id: TEST_BIGMODEL_PROVIDER_ID,
    name: "BigModel",
    enabled: true,
    apiKey: "bigmodel-api-key",
    ...overrides,
  };
}

function createUsageStatsServiceForTest(params: {
  apiClient?: ApiClient;
  providers: TestUsageProvider[];
  env?: NodeJS.ProcessEnv;
  credentialTokens?: Record<string, string | null | undefined>;
  resolveAccountAuth?: (input: {
    providerId: string;
    accountAccess: ZCodeAccountAccess;
  }) => Promise<{ apiKey?: string }>;
  getAppUsageStats?: IZCodeAgentService["getAppUsageStats"];
}) {
  const service = createUsageStatsService({
    apiClient: params.apiClient ?? {
      request: vi.fn(),
    },
    accountRequestAuthService: {
      resolveAccessCurrent: vi.fn(async () => null),
      resolveCurrent: vi.fn(
        params.resolveAccountAuth ??
          (async ({ providerId, accountAccess }) => {
            if (accountAccess.planKind === "team-coding-plan") {
              return {
                apiKey:
                  providerId === BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan
                    ? "zai-team-ak.zai-team-secret"
                    : "team-ak.team-secret",
              };
            }
            return {
              apiKey: params.providers.find((provider) => provider.id === providerId)?.apiKey,
            };
          }),
      ),
      assertCurrent: vi.fn(async () => undefined),
    },
    resolveApiAuthorization: vi.fn(async ({ preferredProviderId }) => {
      const provider = params.providers.find((candidate) =>
        preferredProviderId ? candidate.id === preferredProviderId : candidate.enabled,
      );
      const apiKey = provider?.apiKey?.trim() ?? "";
      if (!provider || !apiKey) return null;
      return {
        authorization: apiKey,
        quotaUrl:
          provider.id === TEST_ZAI_PROVIDER_ID
            ? "https://api.z.ai/api/monitor/usage/quota/limit"
            : "https://bigmodel.cn/api/monitor/usage/quota/limit",
        provider: { id: provider.id, name: provider.name },
      };
    }),
    credentialService: {
      load: vi.fn(async (key) => params.credentialTokens?.[key] ?? null),
    },
    env: params.env,
    zcodeAgentService: {
      getAppUsageStats: params.getAppUsageStats ?? vi.fn(async () => createAppUsageSnapshot()),
    },
  });
  return {
    ...service,
    getCodingPlanUsageSnapshot: (
      request: Parameters<typeof service.getCodingPlanUsageSnapshot>[0],
    ) =>
      service.getCodingPlanUsageSnapshot({
        ...request,
        accountAccess:
          request.accountAccess ??
          (request.organizationId && request.projectId
            ? {
                type: "zhipu-account",
                family: request.preferredProviderId?.includes("zai") ? "zai" : "bigmodel",
                planKind: "team-coding-plan",
                productId: "test-product",
                organizationId: request.organizationId,
                projectId: request.projectId,
              }
            : {
                type: "zhipu-account",
                family: request.preferredProviderId?.includes("zai") ? "zai" : "bigmodel",
                planKind: "individual-coding-plan",
              }),
      }),
    // Highspeed 的普通 TPS 查询同样按 accountAccess 鉴权；默认补个人套餐访问上下文，
    // 让用例专注缓存与诊断行为，需要 Team scope 的用例显式传入。
    getCodingPlanRegularTps: (
      request: Omit<
        Parameters<NonNullable<typeof service.getCodingPlanRegularTps>>[0],
        "accountAccess"
      > & {
        accountAccess?: ZCodeAccountAccess;
      },
    ) =>
      service.getCodingPlanRegularTps?.({
        ...request,
        accountAccess:
          request.accountAccess ??
          ({
            type: "zhipu-account",
            family: request.preferredProviderId.includes("zai") ? "zai" : "bigmodel",
            planKind: "individual-coding-plan",
          } satisfies ZCodeAccountAccess),
      }),
  };
}

describe("createUsageStatsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });





  it("Coding Plan 按当日/7日/30日生成稳定时间轴", () => {
    vi.useFakeTimers({ now: new Date("2026-05-19T10:00:00.000Z") });

    const today = resolveCodingPlanUsageTimeRange({
      range: "today",
      preferredProviderId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    });
    const sevenDays = resolveCodingPlanUsageTimeRange({
      range: "7d",
      preferredProviderId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    });

    expect(today.granularity).toBe("hour");
    expect(today.xTime[0]).toBe("00:00:00");
    expect(today.xTime.at(-1)).toBe("23:00:00");
    expect(sevenDays.granularity).toBe("day");
    expect(sevenDays.xTime).toEqual([
      "2026-05-13",
      "2026-05-14",
      "2026-05-15",
      "2026-05-16",
      "2026-05-17",
      "2026-05-18",
      "2026-05-19",
    ]);
  });

  it("Coding Plan 时间范围按调用端 timeZone 生成自然日边界", () => {
    vi.useFakeTimers({ now: new Date("2026-05-19T23:30:00.000Z") });

    const utc = resolveCodingPlanUsageTimeRange({
      range: "today",
      preferredProviderId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      timeZone: "UTC",
    });
    const shanghai = resolveCodingPlanUsageTimeRange({
      range: "today",
      preferredProviderId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      timeZone: "Asia/Shanghai",
    });

    expect(utc.startTime).toBe("2026-05-19 00:00:00");
    expect(utc.endTime).toBe("2026-05-19 23:59:59");
    expect(shanghai.startTime).toBe("2026-05-20 00:00:00");
    expect(shanghai.endTime).toBe("2026-05-20 23:59:59");
  });

  it("Coding Plan 自定义日期范围限制为 30 个自然日并生成日粒度时间轴", () => {
    const custom = resolveCodingPlanUsageTimeRange({
      range: "custom",
      customStartDate: "2026-05-01",
      customEndDate: "2026-05-03",
      preferredProviderId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      timeZone: "UTC",
    });

    expect(custom.startTime).toBe("2026-05-01 00:00:00");
    expect(custom.endTime).toBe("2026-05-03 23:59:59");
    expect(custom.granularity).toBe("day");
    expect(custom.xTime).toEqual(["2026-05-01", "2026-05-02", "2026-05-03"]);

    expect(() =>
      resolveCodingPlanUsageTimeRange({
        range: "custom",
        customStartDate: "2026-05-01",
        customEndDate: "2026-06-01",
        preferredProviderId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
        timeZone: "UTC",
      }),
    ).toThrow("coding_plan_usage_custom_range_too_long");
  });

  it("App Usage 经 ZCode Protocol 读取 agent 数据库统计", async () => {
    const getAppUsageStats = vi.fn(async () => createAppUsageSnapshot());
    const apiClient: ApiClient = {
      request: vi.fn(),
    };
    const service = createUsageStatsServiceForTest({
      apiClient,
      providers: [],
      getAppUsageStats,
    });

    const snapshot = await service.getAppUsageSnapshot({
      range: "30d",
      timeZone: "UTC",
    });

    // App Usage 不走 monitor HTTP，只走 agent 协议。
    expect(apiClient.request).not.toHaveBeenCalled();
    expect(getAppUsageStats).toHaveBeenCalledWith({
      range: "30d",
      timeZone: "UTC",
    });
    expect(snapshot.source).toBe("agent-db");
    expect(snapshot.summary.totalSessions).toBe(1);
    expect(snapshot.summary.totalTokens).toBe(104);
  });

  it("App Usage 不会因为存在 Coding Plan key 而切到 monitor 接口", async () => {
    const getAppUsageStats = vi.fn(async () => createAppUsageSnapshot());
    const apiClient: ApiClient = {
      request: vi.fn(),
    };
    const service = createUsageStatsServiceForTest({
      apiClient,
      providers: [
        createProvider({
          id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
          name: "BigModel - Coding Plan",
        }),
      ],
      getAppUsageStats,
    });

    const snapshot = await service.getAppUsageSnapshot({
      range: "7d",
      timeZone: "UTC",
    });

    expect(apiClient.request).not.toHaveBeenCalled();
    expect(getAppUsageStats).toHaveBeenCalledWith({
      range: "7d",
      timeZone: "UTC",
    });
    expect(snapshot.source).toBe("agent-db");
  });

  it("App Usage 全量概览用 all range 透传到 agent 数据库统计", async () => {
    const getAppUsageStats = vi.fn(async () => ({
      ...createAppUsageSnapshot(),
      range: "all",
    }));
    const service = createUsageStatsServiceForTest({
      providers: [],
      getAppUsageStats,
    });

    const snapshot = await service.getAppUsageSnapshot({
      range: "all",
      timeZone: "Asia/Shanghai",
    });

    expect(getAppUsageStats).toHaveBeenCalledWith({
      range: "all",
      timeZone: "Asia/Shanghai",
    });
    expect(snapshot.range).toBe("all");
  });










  // CR-01 回归：activity / usage-detail / model-performance-day 是可选数据面。
  // 任一接口传输层失败（HTTP 非 2xx、超时、断网）时只清空对应区域，
  // 不能让 Promise.all 提前 reject 拖垮整张 Coding Plan Usage 面板。






});
