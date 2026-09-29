import type {
  ApiClient,
  AppUsageRequest,
  AppUsageSnapshot,
  CodingPlanUsageRequest,
  CodingPlanUsageSnapshot,
  CodingPlanResetOpportunityRequest,
  CodingPlanResetOpportunityResult,
  CodingPlanResetScopeRequest,
  CodingPlanResetStatusSnapshot,
  CodingPlanResetUseRequest,
  CodingPlanResetUseResult,
  UsageEntitlementRequest,
  UsageEntitlementSnapshot,
  UsageStatsRequest,
  UsageStatsSnapshot,
} from "@zcode/shared";
import type { ICredentialService } from "../credential/credential.js";
import type { IAccountRequestAuthService } from "../model-provider/accountRequestAuthService.js";
import type { IZCodeAgentService } from "../zcode-agent/zcodeAgent.js";
import type { IUsageStatsService } from "./usageStats.js";
import type {
  UsageApiAuthorization,
  UsageApiAuthorizationRequest,
} from "./providers/bigmodelUsageQuotaProvider.js";
import type { OfficialMcpCredentialSource } from "./providers/zcodeMcpQuotaProvider.js";

interface UsageStatsServiceDependencies {
  apiClient: ApiClient;
  accountRequestAuthService: Pick<
    IAccountRequestAuthService,
    "resolveAccessCurrent" | "resolveCurrent" | "assertCurrent"
  >;
  resolveApiAuthorization?: (
    request: UsageApiAuthorizationRequest,
  ) => Promise<UsageApiAuthorization | null>;
  credentialService?: Pick<ICredentialService, "load">;
  env?: NodeJS.ProcessEnv;
  /** App Usage 经 ZCode Protocol 读取 agent 数据库真实统计。 */
  zcodeAgentService: Pick<IZCodeAgentService, "getAppUsageStats">;
  /**
   * 官方 Server MCP 额度的凭证来源（与 server MCP 调用同一套 5 个身份头）。
   * 缺省时 entitlement 快照不含 MCP 额度。
   */
  officialMcpCredentialSource?: OfficialMcpCredentialSource;
}

/**
 * FORK(local-mode): 云账号额度链路下线后，仍有方法被调到时给出明确失败，而不是静默返回空数据。
 * 见 FEATURES.md 的 local-mode 条目与 AGENTS.md 的错误处理约定（错误必须携带上下文，不得隐瞒包装）。
 */
function rejectRemovedCloudUsageMethod(method: string): never {
  throw new Error(
    `usage-stats.${method} 不可用：本 fork 已移除云账号额度链路（FORK_LOCAL_MODE）。` +
      `该方法只服务 Z.AI / BigModel Coding Plan 账号，调用方应改用本地统计 getAppUsageSnapshot。`,
  );
}

/**
 * 云账号额度查询被移除后，权益快照一律按「未配置」收敛。
 * 这是 UI 已正确处理的一等状态：`hasActiveCodingPlanSnapshot` 会因此判定为无有效套餐，
 * 相关 Coding Plan 数据源自然消失；本地的 App Usage（getAppUsageSnapshot）不受影响。
 */
function createRemovedCloudEntitlementSnapshot(): UsageEntitlementSnapshot {
  return {
    generatedAt: Date.now(),
    authenticated: false,
    unavailableReason: "not_configured",
    context: null,
    provider: null,
    remaining: null,
    subscription: null,
    quota: null,
  };
}

export function createUsageStatsService(
  dependencies: UsageStatsServiceDependencies,
): IUsageStatsService {
  return {
    async getAppUsageSnapshot(request: AppUsageRequest): Promise<AppUsageSnapshot> {
      // App Usage 现读取 agent 数据库真实统计（model_usage/turn_usage/tool_usage），
      // 经 ZCode Protocol usage/stats 取回。不再读本地 session JSON 估算。
      // FORK(local-mode): 本地统计保留，不依赖云账号；云额度方法已下线（见下）。
      return dependencies.zcodeAgentService.getAppUsageStats({
        range: request.range,
        timeZone: request.timeZone,
      });
    },
    async getEntitlementSnapshot(
      _request: UsageEntitlementRequest = {},
    ): Promise<UsageEntitlementSnapshot> {
      return createRemovedCloudEntitlementSnapshot();
    },
    // FORK(local-mode): 以下方法原由 BigModelUsageQuotaProvider 实现，会请求 Z.AI / BigModel 云端。
    // 现在不再构造该 provider，整条链路（含 /zcode-plan/billing/balance）成为死代码，不再出网。
    async getCodingPlanUsageSnapshot(
      _request: CodingPlanUsageRequest,
    ): Promise<CodingPlanUsageSnapshot> {
      return rejectRemovedCloudUsageMethod("getCodingPlanUsageSnapshot");
    },
    async getCodingPlanResetStatus(
      _request: CodingPlanResetScopeRequest,
    ): Promise<CodingPlanResetStatusSnapshot> {
      return rejectRemovedCloudUsageMethod("getCodingPlanResetStatus");
    },
    async requestCodingPlanResetOpportunity(
      _request: CodingPlanResetOpportunityRequest,
    ): Promise<CodingPlanResetOpportunityResult> {
      return rejectRemovedCloudUsageMethod("requestCodingPlanResetOpportunity");
    },
    async useCodingPlanReset(
      _request: CodingPlanResetUseRequest,
    ): Promise<CodingPlanResetUseResult> {
      return rejectRemovedCloudUsageMethod("useCodingPlanReset");
    },
    async markCodingPlanResetHistoryRead(_request: CodingPlanResetScopeRequest): Promise<void> {
      return rejectRemovedCloudUsageMethod("markCodingPlanResetHistoryRead");
    },
    async getSnapshot(_request: UsageStatsRequest): Promise<UsageStatsSnapshot> {
      // App Usage 已迁移到 getAppUsageSnapshot（agent 数据库）。getSnapshot 仅服务 Coding Plan monitor 链路，
      // 随云账号一起下线。
      return rejectRemovedCloudUsageMethod("getSnapshot");
    },
  };
}
