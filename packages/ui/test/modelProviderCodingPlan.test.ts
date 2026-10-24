import * as enterpriseProductsHook from "@/settings/model-provider-section/useEnterpriseCodingPlanProducts.js";
import { createElement, type ReactElement } from "react";
import { type ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BIGMODEL_PROVIDER_ID,
  BUILTIN_MODEL_PROVIDER_IDS,
  ZAI_PROVIDER_ID,
  type UsageEntitlementSnapshot,
} from "@zcode/shared";
import {
  TID_MODEL_PROVIDER_ADD_MODEL_BUTTON,
  TID_MODEL_PROVIDER_MODEL_DELETE_BUTTON,
} from "@zcode/shared/test-ids";
import {
  resolveCodingPlanProviderSyncAttemptKey,
  shouldRetryUnchangedCodingPlanProviderSync,
  resolveModelProviderSideSelectionKey,
} from "@/settings/ModelProviderSection.js";
import {
  beginCodingPlanUpgradeLogin,
  isCodingPlanPurchaseAuthPending,
  closeAndRefreshCodingPlanUpgradeFromWebview,
  refreshCodingPlanUpgradeCompletion,
  resolvePendingCodingPlanUpgradeAfterLogin,
} from "@/settings/CodingPlanUpgradeDialog.js";
import {
  refreshModelProviderSection,
  refreshProviderPanelAfterAuthChange,
} from "@/settings/model-provider-section/modelProviderActions.js";
import { resolveCodingPlanStatusPanelViewState } from "@/settings/model-provider-section/codingPlanStatusPanelViewState.js";
import {
  ModelProviderSectionDetail,
  resolveEnterprisePurchaseChoiceBannerPrice,
  resolvePurchaseChoiceBannerProductsProviderId,
  resolvePurchaseChoiceBannerPrice,
  resolvePurchaseChoiceSelectionIntent,
  resolveTeamScopedPlanNavItem,
  resolveTeamPlanInspectionAccess,
} from "@/settings/model-provider-section/Detail.js";
import { resolveCodingPlanEntitlementState } from "@/settings/model-provider-section/providerFamilyConnectionVisibility.js";
import { groupEnterpriseCodingPlanProductsByTier } from "@/settings/model-provider-section/codingPlanEnterpriseTiers.js";
import { ModelProviderSectionNavigation } from "@/settings/model-provider-section/Navigation.js";
import {
  buildProviderFamilyConnectionOptions,
  ProviderFamilyPlanModeSwitch,
} from "@/settings/model-provider-section/ProviderFamilyModeHeader.js";
import { resolveCodingPlanUpgradeProductsProviderId } from "@/settings/model-provider-section/codingPlanPricingCards.js";
import { CodingPlanUpgradeAction } from "@/settings/model-provider-section/CodingPlanStatusActions.js";
import {
  formatStartPlanEffectiveDate,
  formatStartPlanExpireDate,
  resolvePendingStartPlanEffectiveTime,
} from "@/settings/model-provider-section/CodingPlanStatusMeta.js";
import { StartPlanCard } from "@/settings/model-provider-section/StartPlanCard.js";
import {
  CodingPlanStatusPanel,
  hasStartPlanEntitlementQuota,
  resolveCodingPlanStatusCardTitle,
} from "@/settings/model-provider-section/StatusCards.js";
import {
  resolveFallbackModelProviderNodeKey,
  resolveSelectedFamilyModeNodeKey,
  useModelProviderNavigation,
} from "@/settings/model-provider-section/useModelProviderNavigation.js";
import {
  clearStartPlanPreviewCacheForTest,
  primeStartPlanPreviewCacheForTest,
} from "@/settings/model-provider-section/useStartPlanPreview.js";
import { type ModelProviderNavGroup } from "@/settings/model-provider-section/constants.js";
import type { ModelProviderNavItem } from "@/settings/model-provider-section/constants.js";
import type { ProviderSettingsView } from "@zcode/services";

it("付费下拉按完整保存选择显示团队，不读取复制的个人 current", () => {
  const provider = createProvider({ id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan });
  provider.accountState = { availability: "available", entitled: true, current: false };
  const coding = {
    key: "coding",
    type: "codingPlan",
    presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    oauthProviderId: BIGMODEL_PROVIDER_ID,
    label: "个人",
    providerName: "BigModel",
    provider,
    status: "purchased",
    statusActive: false,
  } as ModelProviderNavItem;
  const team = {
    ...coding,
    key: "team",
    type: "teamPlan",
    presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
    teamPlanName: "测试团队",
    organizationId: "org",
    projectId: "project",
    currentProductId: "product",
  } as ModelProviderNavItem;
  const selection = {
    kind: "team-coding-plan" as const,
    organizationId: "org",
    projectId: "project",
    productId: "product",
  };
  const render = (organizationId: string, navigationItems = [coding, team]) =>
    renderWithTooltipProvider(
      createElement(ProviderFamilyPlanModeSwitch, {
        selectedNavItem: team,
        navigationItems,
        connectionSelections: { bigmodel: { ...selection, organizationId } },
        onSelectNavItem: vi.fn(),
      }),
    );
  expect(render("org")).not.toContain('data-placeholder=""');
  expect(render("wrong-org")).toContain("settings.modelProvider.codingPlan.purchase.selectPlan");
  expect(render("wrong-org")).toContain("data-placeholder");
  expect(render("org", [team])).not.toContain(
    'data-testid="model-provider-connection-mode-trigger"',
  );
});
it("旧 Start 连接下，唯一未选中的个人套餐仍提供显式选择入口", () => {
  const provider = createProvider({ id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan });
  provider.accountState = { availability: "available", entitled: true, current: false };
  const coding: ModelProviderNavItem = {
    key: `coding-plan:${provider.providerId}`,
    type: "codingPlan",
    presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    oauthProviderId: BIGMODEL_PROVIDER_ID,
    label: "个人套餐",
    providerName: "BigModel",
    provider,
    status: "purchased",
    statusActive: false,
  };
  const html = renderWithTooltipProvider(
    createElement(ProviderFamilyPlanModeSwitch, {
      selectedNavItem: coding,
      navigationItems: [coding],
      onSelectNavItem: vi.fn(),
    }),
  );
  expect(html).toContain('data-testid="model-provider-connection-mode-trigger"');
  expect(html).toContain("data-placeholder");
});
import {
  clearCodingPlanBillingDiscountCacheForTest,
  CodingPlanBillingDiscountBadge,
  CodingPlanBillingDiscountBanner,
  primeCodingPlanBillingDiscountCacheForTest,
  resolveCodingPlanBillingDiscountCopy,
} from "@/CodingPlanBillingDiscount.js";
import zhCN from "@/i18n/locales/zh-CN.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";

const intlMockState = vi.hoisted(() => ({ locale: "en-US" }));

function renderWithTooltipProvider(element: ReactElement) {
  return renderToStaticMarkup(createElement(TooltipProvider, null, element));
}

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    locale: intlMockState.locale,
    intl: {
      formatMessage: (descriptor: { id: string }, values?: Record<string, string>) => {
        const isZh = intlMockState.locale.toLowerCase().startsWith("zh");
        let message =
          (isZh
            ? {
                "settings.modelProvider.startPlan.meta.today": "Today",
                "settings.modelProvider.startPlan.meta.tomorrow": "Tomorrow",
                "settings.modelProvider.startPlan.balance.used": "已用 {value}",
                "settings.modelProvider.startPlan.preview.unit.tokens": "tokens",
                "settings.modelProvider.startPlan.preview.period.daily": "{unit}/日",
                "settings.modelProvider.startPlan.preview.entitlementSummary.daily":
                  "每日额度 · {details}",
                "settings.modelProvider.startPlan.preview.entitlementSummary.generic":
                  "额度 · {details}",
                "settings.modelProvider.startPlan.preview.entitlementGroup.single":
                  "{model} {quota}",
                "settings.modelProvider.startPlan.preview.entitlementGroup.each":
                  "{models} 各{quota}",
                "settings.modelProvider.codingPlan.purchase.fromPrice": "{price} 起",
                "settings.modelProvider.codingPlan.purchase.fromPriceSuffix": "起",
                "settings.modelProvider.codingPlan.purchaseBanner.startPlanTitle": "体验套餐",
                "settings.modelProvider.connectionMode.startPlanCount": "体验套餐 × {count}",
                "settings.modelProvider.connectionMode.switchToStartPlan": "切换至体验套餐",
                "settings.modelProvider.codingPlan.enterprise.tier.lite": "基础版",
                "settings.modelProvider.codingPlan.enterprise.tier.pro": "标准版",
                "settings.modelProvider.codingPlan.enterprise.tier.max": "高级版",
              }
            : {
                "settings.modelProvider.startPlan.meta.today": "Today",
                "settings.modelProvider.startPlan.meta.tomorrow": "Tomorrow",
                "settings.modelProvider.startPlan.balance.used": "Used {value}",
                "settings.modelProvider.startPlan.preview.unit.tokens": "tokens",
                "settings.modelProvider.startPlan.preview.period.daily": "{unit} per day",
                "settings.modelProvider.startPlan.preview.entitlementSummary.daily":
                  "Daily quota · {details}",
                "settings.modelProvider.startPlan.preview.entitlementSummary.generic":
                  "Quota · {details}",
                "settings.modelProvider.startPlan.preview.entitlementGroup.single":
                  "{model} {quota}",
                "settings.modelProvider.startPlan.preview.entitlementGroup.each":
                  "{models} {quota} each",
                "settings.modelProvider.codingPlan.purchase.fromPrice": "{price}+",
                "settings.modelProvider.codingPlan.purchase.fromPriceSuffix": "",
                "settings.modelProvider.codingPlan.purchaseBanner.startPlanTitle": "Start Plan",
                "settings.modelProvider.connectionMode.startPlanCount": "Start Plan × {count}",
                "settings.modelProvider.connectionMode.switchToStartPlan": "Switch to Start Plan",
                "settings.modelProvider.codingPlan.enterprise.tier.lite": "Lite",
                "settings.modelProvider.codingPlan.enterprise.tier.pro": "Pro",
                "settings.modelProvider.codingPlan.enterprise.tier.max": "Max",
              })[descriptor.id] ?? descriptor.id;
        for (const [key, value] of Object.entries(values ?? {})) {
          message = message.replace(`{${key}}`, value);
        }
        if (values?.date && !message.includes(values.date)) {
          message = `${message} ${values.date}`;
        }
        return message;
      },
    },
  }),
}));

vi.mock("@/hooks/usePlatform.js", () => ({
  useOptionalPlatform: () => ({
    openExternal: vi.fn(),
  }),
  usePlatform: () => ({
    openExternal: vi.fn(),
  }),
}));

vi.mock("@/hooks/useServices.js", () => ({
  useServices: () => ({}),
  useOptionalServices: () => null,
}));

vi.mock("@/settings/CodingPlanUpgradeDialogProvider.js", () => ({
  useOptionalCodingPlanUpgradeDialog: () => null,
  useCodingPlanUpgradeDialog: () => ({
    openCodingPlanUpgrade: vi.fn(),
  }),
}));

beforeEach(() => {
  clearStartPlanPreviewCacheForTest();
  clearCodingPlanBillingDiscountCacheForTest();
  intlMockState.locale = "en-US";
});

afterEach(() => {
  vi.useRealTimers();
});

type LegacyProviderOverrides = Partial<ProviderSettingsFormProvider> & {
  id?: string;
  name?: string;
  apiKey?: string;
  apiKeyUrl?: string;
  apiFormat?: "anthropic-messages" | "openai-chat-completions" | "openai-responses";
  endpoints?: { baseURL?: string; paths?: Record<string, string> };
  models?: unknown[];
  systemDisabledReason?: string;
  updatedAt?: number;
};

function createModelProviderModelConfig(input: {
  id: string;
  builtin?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  supportsJsonSchemaOutput?: boolean;
  kinds?: string[];
  defaultKind?: string;
}): ProviderSettingsFormProvider["models"][number] {
  const maxOutputTokens = input.maxOutputTokens;
  const config = {
    properties: {
      requiresMfjsToolSchema: false,
      contextWindow: input.contextWindow ?? 200_000,
      inputFormat: {
        supportsText: true,
        supportsImage: false,
        supportsVideo: false,
        supportsAudio: false,
        supportsPdf: false,
      },
      outputFormat: { supportsText: true },
      supportsToolCall: input.supportsTools ?? true,
      supportsJsonSchemaOutput: input.supportsJsonSchemaOutput ?? true,
      supportsNativeWebSearch: false,
      supportsMidConversationSystem: false,
    },
    optionSpecs:
      maxOutputTokens === undefined
        ? {}
        : {
            maxOutputTokens: {
              max: maxOutputTokens,
            },
          },
  };
  return {
    kind: "candidate",
    modelId: input.id,
    builtin: input.builtin ?? false,
    personalConfig: structuredClone(config),
    hasPersonalConfig: true,
    executable: true,
    selectable: true,
    config,
  };
}

function createProvider(overrides: LegacyProviderOverrides = {}): ProviderSettingsFormProvider {
  const providerId =
    overrides.providerId ?? overrides.id ?? BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan;
  const accountAccess = (() => {
    const family = providerId.includes("bigmodel") ? "bigmodel" : "zai";
    if (providerId.includes("start-plan")) {
      return {
        type: "zhipu-account" as const,
        family,
        mode: "start-plan" as const,
        entitled: true,
      };
    }
    if (providerId.includes("team-coding-plan")) {
      return {
        type: "zhipu-account" as const,
        family,
        mode: "team-coding-plan" as const,
        entitled: true,
      };
    }
    if (providerId.includes("individual-coding-plan")) {
      return {
        type: "zhipu-account" as const,
        family,
        mode: "individual-coding-plan" as const,
        entitled: true,
      };
    }
    return null;
  })();
  const legacyModels = overrides.models ?? ["glm-5"];
  const hasPersonalConfig =
    overrides.hasPersonalConfig ?? overrides.config?.group === "standard-personal";
  const models = legacyModels.map((model) => {
    if (typeof model === "object" && model !== null && "modelId" in model && "config" in model) {
      return model as ProviderSettingsFormProvider["models"][number];
    }
    if (typeof model === "string") {
      // Settings View 总会提供 Personal 空覆盖；不完整模型也应遵循完整 DTO 外壳。
      return {
        kind: "candidate" as const,
        modelId: model,
        builtin: !hasPersonalConfig,
        config: {},
        personalConfig: {},
        hasPersonalConfig: false,
        executable: false,
        selectable: false,
      };
    }
    throw new Error("测试 Provider models 只接受当前 candidate 或 modelId 字符串");
  });
  return {
    providerId,
    executable: overrides.selectable ?? overrides.enabled !== false,
    enabled: overrides.enabled ?? true,
    hasPersonalConfig,
    personalConfig: hasPersonalConfig
      ? {
          group: "standard-personal",
          personalModelIds: models.map((model) => model.modelId),
          enabled: overrides.enabled ?? true,
        }
      : {},
    providerName: overrides.name ?? overrides.providerName ?? "Z.ai",
    config: {
      group:
        overrides.config?.group ??
        (providerId.includes("bigmodel") ? "bigmodel-family" : "zai-family"),
      access: accountAccess ?? {
        type: "api-key",
        apiKey: overrides.apiKey ?? "sk-demo",
        ...(overrides.apiKeyUrl ? { apiKeyManagementUrl: overrides.apiKeyUrl } : {}),
      },
      api: {
        type: overrides.apiFormat ?? overrides.config?.api?.type ?? "openai-chat-completions",
        baseUrl:
          overrides.endpoints?.baseURL ??
          overrides.config?.api?.baseUrl ??
          "https://example.com/openai",
      },
      ...(hasPersonalConfig
        ? { personalModelIds: models.map((model) => model.modelId) }
        : { builtinModelIds: models.map((model) => model.modelId) }),
      enabled: overrides.enabled ?? true,
      ...overrides.config,
    },
    models,
  };
}

function createProviderSettingsView(provider: ProviderSettingsFormProvider): ProviderSettingsView {
  return {
    revision: 17,
    addableProviders: [],
    providerOrder: [provider.providerId],
    providers: [
      {
        providerId: provider.providerId,
        providerName: provider.providerName,
        enabled: provider.enabled,
        executable: provider.executable,
        effectiveBuiltinConfig: structuredClone(provider.config),
        personalConfig: structuredClone(provider.personalConfig),
        effectiveConfig: structuredClone(provider.config),
        issues: provider.issues ?? [],
        models: provider.models.map((model) => ({
          kind: "candidate" as const,
          modelId: model.modelId,
          builtin: model.builtin ?? true,
          effectiveBuiltinConfig: structuredClone(model.inheritedConfig ?? model.config),
          ...(model.hasPersonalConfig
            ? { personalExactConfig: structuredClone(model.personalConfig) }
            : {}),
          effectiveConfig: structuredClone(model.config),
          enabled: model.config.enabled !== false,
          executable: model.executable ?? true,
          selectable: model.selectable ?? true,
          issues: model.issues ?? [],
        })),
      },
    ],
  };
}

function renderDetail(
  selectedNavItem: Parameters<typeof ModelProviderSectionDetail>[0]["selectedNavItem"],
  overrides: Partial<Parameters<typeof ModelProviderSectionDetail>[0]> = {},
) {
  return renderToStaticMarkup(
    createElement(ModelProviderSectionDetail, {
      selectedNavItem,
      activeWorkspacePath: null,
      presetLoading: false,
      officialLoginProviderId: null,
      presetSubscriptionProviderId: null,
      codingPlanStatusSyncProviderId: null,
      codingPlanDisconnectProviderId: null,
      onSave: vi.fn(),
      onDelete: vi.fn(async () => {}),
      onTestModel: vi.fn(async () => ({ results: [] })),
      onOfficialLogin: vi.fn(async () => {}),
      onCodingPlanLogin: vi.fn(async () => {}),
      onCodingPlanDisconnect: vi.fn(),
      onOpenPresetApiKey: vi.fn(),
      onOpenApiKeyUrl: vi.fn(),
      onOpenBigModelRegistration: vi.fn(),
      onCodingPlanPurchaseComplete: vi.fn(),
      codingPlanPurchaseTokenAuthenticatedByProviderId: {},
      ...overrides,
    }),
  );
}

function expectConnectionApiFormatVisible(html: string): void {
  expect(html).toMatch(/<label[^>]*>settings\.modelProvider\.apiFormat<\/label>/);
}

function expectConnectionApiFormatHidden(html: string): void {
  expect(html).not.toMatch(/<label[^>]*>settings\.modelProvider\.apiFormat<\/label>/);
}

function createEntitlementSnapshot(
  overrides: Partial<UsageEntitlementSnapshot> = {},
): UsageEntitlementSnapshot {
  return {
    generatedAt: 1,
    authenticated: true,
    provider: {
      id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      name: "BigModel - Coding Plan",
    },
    remaining: {
      count: 100,
      isShow: true,
      percentage: 0.2,
      nextResetTime: 1_779_000_000_000,
    },
    subscription: {
      identityType: "unknown",
      identityMasked: null,
      details: [
        {
          productId: "pro",
          productName: "Pro",
          purchaseTime: null,
          beginTime: null,
          billingCycle: "monthly",
          renewTime: null,
          expireTime: "2026-12-31T00:00:00.000Z",
        },
      ],
    },
    quota: {
      level: "pro",
      limits: [],
    },
    ...overrides,
  };
}

describe("model provider coding plan", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["unknown", "loading"] as const)("购买登录态为 %s 时保持 Select 不可用", (status) => {
    expect(isCodingPlanPurchaseAuthPending(status)).toBe(true);
  });

  it.each(["authenticated", "unauthenticated", "error"] as const)(
    "购买登录态明确为 %s 时允许 Select 决策",
    (status) => {
      expect(isCodingPlanPurchaseAuthPending(status)).toBe(false);
    },
  );

  it("套餐选择发起的同一次登录成功后只恢复升级页面", () => {
    const target = {
      providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      initialAudience: "personal" as const,
    };
    expect(
      resolvePendingCodingPlanUpgradeAfterLogin({
        pending: { loginAttemptId: 7, target },
        loginAttempt: {
          id: 7,
          providerId: ZAI_PROVIDER_ID,
          status: "succeeded",
        },
      }),
    ).toEqual({ action: "reopen", target });
  });

  it("套餐登录恢复只记录 audience 并重开 Plan 首页", () => {
    const requestLoginEntry = vi.fn(() => 7);
    const onClose = vi.fn();
    const pending = beginCodingPlanUpgradeLogin({
      target: {
        providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
        initialAudience: "team",
      },
      oauthProviderId: ZAI_PROVIDER_ID,
      audience: "personal",
      requestLoginEntry,
      onClose,
    });
    expect(pending).toEqual({
      loginAttemptId: 7,
      target: {
        providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
        initialAudience: "personal",
      },
    });
    expect(requestLoginEntry).toHaveBeenCalledWith(ZAI_PROVIDER_ID);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each(["cancelled", "failed"] as const)(
    "套餐选择登录为 %s 时丢弃升级页面恢复意图",
    (status) => {
      expect(
        resolvePendingCodingPlanUpgradeAfterLogin({
          pending: {
            loginAttemptId: 7,
            target: {
              providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
              initialAudience: "team",
            },
          },
          loginAttempt: { id: 7, providerId: ZAI_PROVIDER_ID, status },
        }),
      ).toEqual({ action: "discard" });
    },
  );

  it("普通登录或另一条登录 attempt 成功时不恢复升级页面", () => {
    expect(
      resolvePendingCodingPlanUpgradeAfterLogin({
        pending: {
          loginAttemptId: 7,
          target: {
            providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
            initialAudience: "personal",
          },
        },
        loginAttempt: {
          id: 8,
          providerId: ZAI_PROVIDER_ID,
          status: "succeeded",
        },
      }),
    ).toEqual({ action: "discard" });
  });

  it.each([true, false])(
    "未购买套餐同步中=%s 时 Subscribe 的加载反馈与禁用状态一致",
    (loginLoading) => {
      const html = renderToStaticMarkup(
        createElement(CodingPlanStatusPanel, {
          providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelCodingPlan,
          providerName: "BigModel",
          status: "notPurchased",
          viewState: {
            displayStatus: "notPurchased",
            actionStatus: "notPurchased",
            balanceStatus: "notPurchased",
            loginLoading,
          },
        }),
      );
      const button = html.match(
        /<button[^>]*>(?:(?!<\/button>)[\s\S])*settings\.modelProvider\.codingPlan\.subscribe<\/button>/,
      )?.[0];
      expect(button).toBeDefined();
      expect(button?.includes("animate-spin")).toBe(loginLoading);
      expect(button?.includes('disabled=""')).toBe(loginLoading);
    },
  );

  it.each(["purchased", "notPurchased"] as const)(
    "后台同步时保留已有 %s entitlement，避免详情闪烁",
    (status) => {
      expect(
        resolveCodingPlanStatusPanelViewState({
          status,
          loginPending: true,
        }),
      ).toEqual({
        displayStatus: status,
        actionStatus: status,
        balanceStatus: status,
        loginLoading: true,
      });
    },
  );

  it("uses a stable provider/auth identity for Z.ai and BigModel plan transitions", () => {
    expect(
      resolveCodingPlanProviderSyncAttemptKey({
        activeOAuthProvider: ZAI_PROVIDER_ID,
        oauthProviderId: ZAI_PROVIDER_ID,
        providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      }),
    ).toBe(`${BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan}:${ZAI_PROVIDER_ID}`);
    expect(
      resolveCodingPlanProviderSyncAttemptKey({
        activeOAuthProvider: BIGMODEL_PROVIDER_ID,
        oauthProviderId: BIGMODEL_PROVIDER_ID,
        providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      }),
    ).toBe(`${BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan}:${BIGMODEL_PROVIDER_ID}`);
    expect(
      resolveCodingPlanProviderSyncAttemptKey({
        activeOAuthProvider: ZAI_PROVIDER_ID,
        oauthProviderId: BIGMODEL_PROVIDER_ID,
        providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      }),
    ).toBeNull();
  });

  it("连接项未变化但上次同步未完成时允许再次刷新 Plan", () => {
    const attemptKey = `${BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan}:${BIGMODEL_PROVIDER_ID}`;

    expect(
      shouldRetryUnchangedCodingPlanProviderSync({
        attemptKey,
        attemptStatus: "failed",
        modeUnchanged: true,
        selectedKeyUnchanged: true,
      }),
    ).toBe(true);
    expect(
      shouldRetryUnchangedCodingPlanProviderSync({
        attemptKey,
        attemptStatus: "succeeded",
        modeUnchanged: true,
        selectedKeyUnchanged: true,
      }),
    ).toBe(false);
  });






  it("已落盘的 Coding Plan 不进入自定义供应商分组", () => {
    let capturedGroups: ModelProviderNavGroup[] = [];

    function Harness() {
      const { navigationGroups } = useModelProviderNavigation({
        presetProviders: [],
        modelProviders: [
          createProvider({
            id: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
            name: "Z.ai - Coding Plan",
          }),
          createProvider({
            id: "custom-provider",
            name: "Custom Provider",
            config: { group: "standard-personal" },
          }),
        ],
        selectedNodeKey: null,
        setSelectedNodeKey: vi.fn(),
        intl: {
          formatMessage: ({ id }: { id: string }) =>
            id === "settings.modelProvider.connectionMode.codingPlan" ? "Individual Plan" : id,
        } as never,
      });
      capturedGroups = navigationGroups;
      return createElement("div");
    }

    renderToStaticMarkup(createElement(Harness));

    const customGroup = capturedGroups.find((group) => group.id === "custom");
    expect(customGroup?.items.map((item) => item.label)).toEqual(["Custom Provider"]);
  });

  it("Provider Template 和新增入口不混入已配置 Provider 导航", () => {
    let capturedGroups: ModelProviderNavGroup[] = [];

    function Harness() {
      const { navigationGroups } = useModelProviderNavigation({
        presetProviders: [],
        modelProviders: [
          createProvider({
            id: "custom-provider",
            name: "Custom Provider",
            config: { group: "standard-personal" },
          }),
        ],
        selectedNodeKey: null,
        setSelectedNodeKey: vi.fn(),
        intl: { formatMessage: ({ id }: { id: string }) => id } as never,
      });
      capturedGroups = navigationGroups;
      return createElement("div");
    }

    renderToStaticMarkup(createElement(Harness));

    const items = capturedGroups.find((group) => group.id === "custom")?.items ?? [];
    expect(items.map((item) => item.type)).toEqual(["custom"]);
  });


  it.each([undefined, "credential-unavailable"] as const)(
    "已登录团队失败（%s）显示重试而不是连接账号",
    (availabilityReason) => {
      for (const hasProvider of [true, false]) {
        const html = renderDetail(
          {
            key: "team:bigmodel:product:org:project",
            type: "teamPlan",
            presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
            oauthProviderId: BIGMODEL_PROVIDER_ID,
            label: "团队",
            providerName: "BigModel",
            teamPlanName: "团队",
            organizationId: "org",
            projectId: "project",
            currentProductId: "product",
            provider: hasProvider
              ? createProvider({ id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan })
              : null,
            status: "unavailable",
            statusActive: false,
            availabilityReason,
            statusMessage: availabilityReason ? "无法创建API Key" : undefined,
          },
          { onRetryCodingPlan: vi.fn() },
        );
        expect(html).toContain("common.retry");
        expect(html).not.toContain("settings.modelProvider.codingPlan.connect");
        expect(html).not.toContain("login.expired.action");
      }
    },
  );

  it("自定义供应商详情仍展示可配置的 API 格式", () => {
    const html = renderDetail({
      key: "custom:provider-a",
      type: "custom",
      label: "Provider A",
      provider: createProvider({ id: "provider-a" }),
      statusActive: false,
    });

    expectConnectionApiFormatVisible(html);
  });

  it.each(["zai", "bigmodel"] as const)(
    "%s 个人套餐失败重新登录，Start 套餐失败保留重试",
    (family) => {
      for (const plan of ["individual-coding-plan", "start-plan"] as const) {
        const providerId = `account:${family}-${plan}` as const;
        const provider = {
          ...createProvider({ id: providerId }),
          accountState: {
            availability: "unavailable" as const,
            entitled: false,
            unavailableReason: "credential-failed" as const,
          },
        };
        const html = renderDetail(
          {
            key: `coding-plan:${providerId}`,
            type: "codingPlan",
            presetId: providerId,
            oauthProviderId: family,
            label: family,
            providerName: family,
            provider,
            status: "unavailable",
            statusActive: false,
          },
          { onRetryCodingPlan: vi.fn() },
        );
        if (plan === "individual-coding-plan") {
          expect(html).toContain("login.expired.action");
          expect(html).toContain("settings.modelProvider.codingPlan.description.credentialFailed");
          expect(html).not.toContain("settings.modelProvider.codingPlan.connect");
        } else {
          expect(html).toContain("common.retry");
          expect(html).not.toContain("login.expired.action");
          expect(html).not.toContain("settings.modelProvider.codingPlan.connect");
        }
      }
    },
  );

  it("内置 GLM-5.2 模型按 1M 上下文窗口展示", () => {
    const html = renderDetail({
      key: `coding-plan:${BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan}`,
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
        name: "Z.ai - Coding Plan",
        defaultKind: "anthropic",
        endpoints: {
          baseURL: "https://zcode.z.ai/api/v1/zcode-plan/anthropic",
          paths: { anthropic: "/v1/messages" },
        },
        models: [
          createModelProviderModelConfig({
            id: "GLM-5.2",
            kinds: ["anthropic"],
            defaultKind: "anthropic",
            contextWindow: 1_000_000,
          }),
        ],
      }),
      status: "purchased",
      statusActive: true,
    });

    expect(html).toContain("GLM-5.2");
    expect(html).toContain(">1M<");
    expect(html).not.toContain(">200K<");
  });

  it("Account Provider 的 Effective 模型列表允许通过 Personal modelOrder 调序", () => {
    const html = renderDetail(
      {
        key: `coding-plan:${BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan}`,
        type: "codingPlan",
        presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
        oauthProviderId: BIGMODEL_PROVIDER_ID,
        label: "BigModel - Coding Plan",
        providerName: "BigModel",
        provider: createProvider({
          id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
          models: [
            createModelProviderModelConfig({ id: "GLM-5.2" }),
            createModelProviderModelConfig({ id: "GLM-5-Turbo" }),
          ],
        }),
        status: "purchased",
        statusActive: true,
      },
      { onReorderProviderModels: vi.fn(async () => undefined) },
    );

    expect(html.match(/aria-label="settings\.modelProvider\.reorderModel"/g)).toHaveLength(2);
  });

  it("体验套餐详情允许标准模型配置，但 Built-in 成员不可删除", () => {
    const primaryModel = "start-plan-cloud-primary";
    const secondaryModel = "start-plan-cloud-secondary";
    const html = renderDetail({
      key: `coding-plan:${BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan}`,
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel - Start Plan",
      providerName: "BigModel",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
        name: "BigModel - Start Plan",
        defaultKind: "anthropic",
        endpoints: {
          baseURL: "https://zcode.z.ai/api/v1/zcode-plan/anthropic",
          paths: { anthropic: "/v1/messages" },
        },
        models: [
          createModelProviderModelConfig({
            id: primaryModel,
            builtin: true,
            kinds: ["anthropic"],
            defaultKind: "anthropic",
          }),
          createModelProviderModelConfig({
            id: secondaryModel,
            builtin: true,
            kinds: ["anthropic"],
            defaultKind: "anthropic",
          }),
        ],
      }),
      status: "purchased",
      statusActive: true,
    });

    expect(html).toContain(primaryModel);
    expect(html).toContain(secondaryModel);
    expect(html).toContain(TID_MODEL_PROVIDER_ADD_MODEL_BUTTON);
    expect(html).not.toContain(TID_MODEL_PROVIDER_MODEL_DELETE_BUTTON);
  });

  it("Todo89：Account 已确认可用时，Start 额度卡临时刷新不隐藏模型编辑区", () => {
    const providerId = BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan;
    const provider = createProvider({
      id: providerId,
      models: ["start-dynamic-model"],
    });
    const view = createProviderSettingsView(provider);
    const item = {
      key: `coding-plan:${providerId}`,
      type: "codingPlan" as const,
      presetId: providerId,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "Start",
      providerName: "BigModel",
      provider,
      status: "checking" as const,
      statusActive: false,
    };
    const availableView = {
      ...view,
      providers: view.providers.map((p) => ({
        ...p,
        accountState: {
          availability: "available" as const,
          entitled: true,
          current: true,
        },
      })),
    };
    expect(renderDetail(item, { providerSettingsView: availableView })).toContain(
      "start-dynamic-model",
    );
    const unavailableView = {
      ...view,
      providers: view.providers.map((p) => ({
        ...p,
        accountState: {
          availability: "unavailable" as const,
          entitled: false,
          current: true,
        },
      })),
    };
    expect(renderDetail(item, { providerSettingsView: unavailableView })).not.toContain(
      "start-dynamic-model",
    );
  });

  it("自定义供应商详情按单一 runtime config 展示可编辑 API 格式且不展示接口路径编辑", () => {
    const html = renderDetail({
      key: "custom:provider-a",
      type: "custom",
      label: "Provider A",
      provider: createProvider({
        id: "provider-a",
        apiFormat: "openai-chat-completions",
        defaultKind: "openai-compatible",
        endpoints: {
          baseURL: "https://api.example.com/v1",
          paths: {
            "openai-compatible": "/chat/completions",
          },
        },
        models: [
          createModelProviderModelConfig({
            id: "glm-5",
            kinds: ["openai-compatible"],
            defaultKind: "openai-compatible",
          }),
        ],
      }),
      statusActive: false,
    });

    expect(html).toContain('value="https://api.example.com/v1"');
    expectConnectionApiFormatVisible(html);
    expect(html).not.toContain("settings.modelProvider.endpointPath");
  });

  it("自定义供应商详情隐藏 Claude 映射和自定义 Headers", () => {
    const html = renderDetail({
      key: "custom:provider-a",
      type: "custom",
      label: "Provider A",
      provider: createProvider({
        id: "provider-a",
      }),
      statusActive: false,
    });

    expect(html).not.toContain("settings.modelProvider.claudeMapping");
    expect(html).not.toContain("settings.modelProvider.customHeaders");
  });


  it("套餐连接入口点击时仍映射回 provider family side key", () => {
    expect(
      resolveModelProviderSideSelectionKey({
        key: "coding-plan:account:zai-individual-coding-plan",
        type: "codingPlan",
        presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
        oauthProviderId: ZAI_PROVIDER_ID,
        label: "Z.ai - Coding Plan",
        providerName: "Z.ai",
        provider: createProvider({
          id: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
          name: "Z.ai - Coding Plan",
        }),
        status: "purchased",
        planLevel: "Coding Pro",
        currentProductId: "product-zai-pro",
        subscriptionBillingCycle: null,
        subscriptionRenewTime: null,
        subscriptionExpireTime: null,
        quotaLimits: [],
        purchaseUrl: "https://z.ai/manage-apikey/subscription",
        statusActive: true,
      }),
    ).toBe("preset:account:zai-start-plan");
  });

  it("Z.ai family 导航保持品牌图标，不借用 Start 图标", () => {
    const html = renderWithTooltipProvider(
      createElement(ModelProviderSectionNavigation, {
        navigationGroups: [
          {
            id: "preset",
            title: "Preset",
            items: [
              {
                key: "preset:account:zai-start-plan",
                type: "preset",
                logo: { type: "builtin", key: "zai" },
                presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
                label: "Z.ai - API Key",
                displayName: "Z.ai - API Key",
                provider: createProvider({
                  id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
                  name: "Z.ai - API Key",
                  config: { logo: { type: "builtin", key: "start-plan" } },
                }),
                statusActive: true,
              },
            ],
          },
        ],
        selectedNodeKey: "preset:account:zai-start-plan",
        presetLoading: false,
        customLoading: false,
        onSelectNavItem: vi.fn(),
      }),
    );

    expect(html).toContain("Z.ai");
    expect(html).toContain("<img ");
    expect(html).toContain("model-provider-zai-app.png");
    expect(html).not.toContain("model-provider-start-plan.png");
    expect(html).not.toContain("settings.modelProvider.connectionMode.startPlan");
    expect(html).not.toContain("settings.modelProvider.codingPlan.start.freeBadge");
  });

  it("仅有个人付费选项时不显示冗余套餐下拉", () => {
    const startPlanItem = {
      key: "coding-plan:account:zai-start-plan",
      type: "codingPlan" as const,
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Start Plan",
      providerName: "Z.ai",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
        name: "Z.ai - Start Plan",
      }),
      status: "purchased" as const,
      statusActive: true,
    };
    const oauthItem = {
      key: "coding-plan:account:zai-individual-coding-plan",
      type: "codingPlan" as const,
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      }),
      status: "purchased" as const,
      statusActive: true,
    };

    const html = renderDetail(oauthItem, {
      navigationItems: [startPlanItem, oauthItem],
      connectionSelections: { zai: { kind: "individual-coding-plan" } },
      onSelectNavItem: vi.fn(),
    });

    expect(html).toContain(">Z.ai<");
    expect(html).toContain("settings.modelProvider.planCard.codingPlan");
    expect(html).not.toContain("settings.modelProvider.connectionMode");
    expect(html).not.toContain('role="combobox"');
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('role="tab"');
  });

  it("Start 详情不展示付费连接获取失败提示", () => {
    const startPlanItem = {
      key: "coding-plan:account:zai-start-plan",
      type: "codingPlan" as const,
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Start Plan",
      providerName: "Z.ai",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
        name: "Z.ai - Start Plan",
      }),
      status: "purchased" as const,
      statusActive: true,
    };
    const oauthItem = {
      key: "coding-plan:account:zai-individual-coding-plan",
      type: "codingPlan" as const,
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: null,
      status: "disconnected" as const,
      purchaseUrl: "https://z.ai/",
      statusActive: false,
    };

    const html = renderDetail(startPlanItem, {
      navigationItems: [startPlanItem, oauthItem],
      connectionSettingsFailed: true,
      onSelectNavItem: vi.fn(),
    });

    expect(html).not.toContain("settings.modelProvider.connectionMode.loadFailed");
    expect(html).not.toContain("text-warning");
    expect(html).toContain("settings.modelProvider.planCard.startPlan");
  });

  it("付费连接方式下拉平铺 Coding 和多个 Team Plan，排除 Start", () => {
    const startPlanItem = {
      key: "coding-plan:account:bigmodel-start-plan",
      type: "codingPlan" as const,
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel - Start Plan",
      providerName: "BigModel",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
      }),
      status: "purchased" as const,
      statusActive: true,
    };
    const codingPlanItem = {
      key: "coding-plan:account:bigmodel-individual-coding-plan",
      type: "codingPlan" as const,
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel - Coding Plan",
      providerName: "BigModel",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      }),
      status: "purchased" as const,
      statusActive: true,
    };
    const teamAItem = {
      ...codingPlanItem,
      key: "team-plan:team-a",
      type: "teamPlan" as const,
      teamPlanName: "TeamA",
      organizationId: "org-a",
      projectId: "proj-a",
    };
    const teamBItem = {
      ...codingPlanItem,
      key: "team-plan:team-b",
      type: "teamPlan" as const,
      teamPlanName: "TeamB Plan",
      organizationId: "org-b",
      projectId: "proj-b",
    };

    const options = buildProviderFamilyConnectionOptions({
      familyId: "bigmodel",
      navigationItems: [teamBItem, codingPlanItem, startPlanItem, teamAItem],
      startPlanLabel: "体验套餐",
      codingPlanLabel: "个人套餐",
      teamPlanFallbackLabel: "Team Plan",
    });

    expect(options.map((option) => option.label)).toEqual(["个人套餐", "TeamB Plan", "TeamA"]);
  });


  it("初始化 fallback 只选中 BigModel family 侧栏入口", () => {
    const codingPlanItem = {
      key: "coding-plan:account:bigmodel-individual-coding-plan",
      type: "codingPlan" as const,
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel - Coding Plan",
      providerName: "BigModel",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      }),
      status: "purchased" as const,
      statusActive: true,
    };
    const teamPlanItem = {
      ...codingPlanItem,
      key: "team:bigmodel:product-team-max:org-team:project-team",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
      type: "teamPlan" as const,
      teamPlanName: "TeamA",
      currentProductId: "product-team-max",
      organizationId: "org-team",
      projectId: "project-team",
    };

    expect(
      resolveFallbackModelProviderNodeKey({
        selectedNodeKey: null,
        selectableNavigationItems: [codingPlanItem, teamPlanItem],
        connectionSelections: {
          bigmodel: {
            kind: "team-coding-plan",
            productId: "product-team-max",
            organizationId: "org-team",
            projectId: "project-team",
          },
        },
      }),
    ).toBe("preset:account:bigmodel-start-plan");
  });

  it("Team Plan 异步出现后从默认 Coding Plan 纠偏到已保存连接方式", () => {
    const codingPlanItem = {
      key: "coding-plan:account:bigmodel-individual-coding-plan",
      type: "codingPlan" as const,
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel - Coding Plan",
      providerName: "BigModel",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      }),
      status: "purchased" as const,
      statusActive: true,
    };
    const teamPlanItem = {
      ...codingPlanItem,
      key: "team:bigmodel:product-team-max:org-team:project-team",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
      type: "teamPlan" as const,
      teamPlanName: "TeamA",
      currentProductId: "product-team-max",
      organizationId: "org-team",
      projectId: "project-team",
    };

    expect(
      resolveSelectedFamilyModeNodeKey({
        selectedNavItem: codingPlanItem,
        selectableNavigationItems: [codingPlanItem, teamPlanItem],
        connectionSelections: {
          bigmodel: {
            kind: "team-coding-plan",
            productId: "product-team-max",
            organizationId: "org-team",
            projectId: "project-team",
          },
        },
      }),
    ).toBe("team:bigmodel:product-team-max:org-team:project-team");
  });

  it("Team Plan 商品 ID 变化时仍按项目 key 恢复已保存连接方式", () => {
    const codingPlanItem = {
      key: "coding-plan:account:bigmodel-individual-coding-plan",
      type: "codingPlan" as const,
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel - Coding Plan",
      providerName: "BigModel",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      }),
      status: "purchased" as const,
      statusActive: true,
    };
    const teamPlanItem = {
      ...codingPlanItem,
      key: "team:bigmodel:product-current:org-team:proj-team",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
      type: "teamPlan" as const,
      teamPlanName: "TeamA",
      currentProductId: "product-current",
      organizationId: "org-team",
      projectId: "proj-team",
    };

    expect(
      resolveSelectedFamilyModeNodeKey({
        selectedNavItem: codingPlanItem,
        selectableNavigationItems: [codingPlanItem, teamPlanItem],
        connectionSelections: {
          bigmodel: {
            kind: "team-coding-plan",
            productId: "product-current",
            organizationId: "org-team",
            projectId: "proj-team",
          },
        },
      }),
    ).toBe("team:bigmodel:product-current:org-team:proj-team");
  });

  it("手动选择 Coding Plan 的 pending selectedKey 不被已保存 Team Plan 纠偏", () => {
    const codingPlanItem = {
      key: "coding-plan:account:bigmodel-individual-coding-plan",
      type: "codingPlan" as const,
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel - Coding Plan",
      providerName: "BigModel",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      }),
      status: "purchased" as const,
      statusActive: true,
    };
    const teamPlanItem = {
      ...codingPlanItem,
      key: "team:bigmodel:product-team-max:org-team:project-team",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
      type: "teamPlan" as const,
      teamPlanName: "TeamA",
      currentProductId: "product-team-max",
      organizationId: "org-team",
      projectId: "project-team",
    };

    expect(
      resolveSelectedFamilyModeNodeKey({
        selectedNavItem: codingPlanItem,
        selectableNavigationItems: [codingPlanItem, teamPlanItem],
        connectionSelections: {
          bigmodel: {
            kind: "team-coding-plan",
            productId: "product-team-max",
            organizationId: "org-team",
            projectId: "project-team",
          },
        },
        pendingConnectionSelections: {
          bigmodel: { kind: "individual-coding-plan" },
        },
      }),
    ).toBeNull();
  });


  it("外部打开 Model Settings 时等待连接方式设置 hydrate，避免先闪成 Start Plan", () => {
    let capturedSelectedNavItem: ReturnType<typeof useModelProviderNavigation>["selectedNavItem"] =
      null;

    function Harness() {
      const { selectedNavItem } = useModelProviderNavigation({
        presetProviders: [
          {
            id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
            displayName: "Z.ai - API Key",
            provider: createProvider({
              id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
            }),
          },
        ],
        modelProviders: [
          createProvider({
            id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
            name: "Z.ai - Start Plan",
            apiKey: "start-token",
          }),
        ],
        codingPlanEntitlements: {
          [BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan]: {
            loading: false,
            error: null,
            snapshot: createEntitlementSnapshot({
              provider: { id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan },
              remaining: null,
              subscription: {
                identityType: "unknown",
                identityMasked: null,
                details: [
                  {
                    productId: "zcode-v3-start-plan",
                    productName: "Start Plan",
                    purchaseTime: null,
                    beginTime: null,
                    billingCycle: null,
                    renewTime: null,
                    expireTime: null,
                  },
                ],
              },
              quota: null,
            }),
          },
        },
        selectedNodeKey: "preset:account:zai-start-plan",
        modelProviderFamilyModes: {},
        modelProviderFamilySelectedKeys: {},
        familyConnectionSettingsLoading: true,
        setSelectedNodeKey: vi.fn(),
        intl: {
          formatMessage: ({ id }: { id: string }) => id,
        } as never,
      });
      capturedSelectedNavItem = selectedNavItem;
      return createElement("div");
    }

    renderToStaticMarkup(createElement(Harness));

    expect(capturedSelectedNavItem).toBeNull();
  });

  it("OAuth family 的 Plan 连接项未生成时右侧保持 loading，不先显示 API Key", () => {
    let capturedSelectedNavItem: ReturnType<typeof useModelProviderNavigation>["selectedNavItem"] =
      null;

    function Harness() {
      const { selectedNavItem } = useModelProviderNavigation({
        presetProviders: [
          {
            id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
            displayName: "BigModel - API Key",
            provider: createProvider({
              id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
              name: "BigModel - API Key",
            }),
          },
        ],
        modelProviders: [
          createProvider({
            id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
            name: "BigModel - API Key",
          }),
        ],
        codingPlanEntitlements: {},
        modelProvidersLoading: true,
        selectedNodeKey: "preset:account:bigmodel-start-plan",
        modelProviderFamilyModes: { bigmodel: "oauth" },
        modelProviderFamilySelectedKeys: {},
        setSelectedNodeKey: vi.fn(),
        intl: {
          formatMessage: ({ id }: { id: string }) => id,
        } as never,
      });
      capturedSelectedNavItem = selectedNavItem;
      return createElement("div");
    }

    renderToStaticMarkup(createElement(Harness));

    expect(capturedSelectedNavItem).toBeNull();
  });




  it("Start 详情不因没有付费套餐显示连接控件", () => {
    const startPlanItem = {
      key: "coding-plan:account:zai-start-plan",
      type: "codingPlan" as const,
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Start Plan",
      providerName: "Z.ai",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
        name: "Z.ai - Start Plan",
      }),
      status: "notPurchased" as const,
      statusActive: false,
    };
    const oauthItem = {
      key: "coding-plan:account:zai-individual-coding-plan",
      type: "codingPlan" as const,
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      }),
      status: "notPurchased" as const,
      purchaseUrl: "https://z.ai/",
      statusActive: false,
    };

    const html = renderDetail(startPlanItem, {
      navigationItems: [startPlanItem, oauthItem],
      connectionSelections: { zai: { kind: "individual-coding-plan" } },
      onSelectNavItem: vi.fn(),
    });

    expect(html).not.toContain("settings.modelProvider.connectionMode");
    expect(html).not.toContain('role="combobox"');
    expect(html).not.toContain("settings.modelProvider.connectionMode.noAvailablePlan");
    expect(html).not.toContain('disabled=""');
  });

  it("Coding Plan 状态同步中展示 checking，避免停留在旧的未连接状态", () => {
    const oauthItem = {
      key: "coding-plan:account:zai-individual-coding-plan",
      type: "codingPlan" as const,
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
        apiKey: "",
      }),
      status: "disconnected" as const,
      purchaseUrl: "https://z.ai/",
      statusActive: false,
    };

    const html = renderDetail(oauthItem, {
      codingPlanStatusSyncProviderId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
    });

    expect(html).toContain("settings.modelProvider.codingPlan.status.checking");
    expect(html).not.toContain("settings.modelProvider.codingPlan.status.disconnected");
    expect(html).not.toContain("settings.modelProvider.codingPlan.connect");
  });

  it("StartPlanCard 使用远端 startPlanPreview 展示体验套餐权益", () => {
    const html = renderToStaticMarkup(
      createElement(StartPlanCard, {
        preview: {
          planId: "zcode-v3-start-plan",
          name: "ZCode V3 Start Plan",
          entitlements: [
            {
              grantUnits: 3_000_000,
              meter: "model_usage",
              period: "daily",
              showName: "GLM-5.2",
              unitType: "token",
            },
            {
              grantUnits: 4_000_000,
              meter: "model_usage",
              period: "daily",
              showName: "GLM-5-Turbo",
              unitType: "token",
            },
          ],
        },
      }),
    );

    expect(html).toContain("settings.modelProvider.startPlan.quotaSectionTitle");
    expect(html).toContain("ZCode V3 Start Plan");
    expect(html).toContain("7 Million");
    expect(html).toContain("tokens per day");
    expect(html).toContain("GLM-5.2");
    expect(html).toContain("GLM-5-Turbo");
    expect(html).not.toContain("10M");
    expect(html).not.toContain(">7M<");
    expect(html.match(/3M/g)?.length).toBe(1);
    expect(html.match(/4M/g)?.length).toBe(1);
    expect(html.match(/tokens per day/g)?.length).toBe(1);
    expect(html).toContain("Daily quota · GLM-5.2 3M · GLM-5-Turbo 4M");
    expect(html).toContain("settings.modelProvider.startPlan.eligibleNewUser");
  });

  it("StartPlanCard 在模型额度相同时合并为 each 文案", () => {
    const html = renderToStaticMarkup(
      createElement(StartPlanCard, {
        preview: {
          planId: "zcode-v3-start-plan",
          name: "ZCode V3 Start Plan",
          entitlements: [
            {
              grantUnits: 10_000_000,
              meter: "model_usage",
              period: "daily",
              showName: "GLM-5.2",
              unitType: "token",
            },
            {
              grantUnits: 10_000_000,
              meter: "model_usage",
              period: "daily",
              showName: "GLM-5-Turbo",
              unitType: "token",
            },
          ],
        },
      }),
    );

    expect(html).toContain("20 Million");
    expect(html).toContain("Daily quota · GLM-5.2 / GLM-5-Turbo 10M each");
    expect(html.match(/10M/g)?.length).toBe(1);
  });

  it("StartPlanCard 英文主额度使用完整 Million 文案", () => {
    const html = renderToStaticMarkup(
      createElement(StartPlanCard, {
        preview: {
          planId: "zcode-v3-start-plan",
          name: "ZCode V3 Start Plan",
          entitlements: [
            {
              grantUnits: 5_000_000,
              meter: "model_usage",
              period: "daily",
              showName: "GLM-5.2",
              unitType: "token",
            },
          ],
        },
      }),
    );

    expect(html).toContain("5 Million");
    expect(html).toContain("tokens per day");
    expect(html).toContain("Daily quota · GLM-5.2 5M");
    expect(html).not.toContain(">5M<");
  });

  it("StartPlanCard 缺少远端权益时不展示本地硬编码 Trial plan", () => {
    const html = renderToStaticMarkup(
      createElement(StartPlanCard, {
        preview: {
          planId: "zcode-v3-start-plan",
          name: "ZCode V3 Start Plan",
          entitlements: [],
        },
      }),
    );

    expect(html).toBe("");
  });

  it("StartPlanCard 中文界面使用本地化紧凑单位展示体验套餐额度", () => {
    intlMockState.locale = "zh-CN";
    try {
      const html = renderToStaticMarkup(
        createElement(StartPlanCard, {
          preview: {
            planId: "zcode-v3-start-plan",
            name: "ZCode V3 Start Plan",
            entitlements: [
              {
                grantUnits: 30_000_000,
                meter: "model_usage",
                period: "daily",
                showName: "GLM-5.2",
                unitType: "token",
              },
              {
                grantUnits: 10_000_000,
                meter: "model_usage",
                period: "daily",
                showName: "GLM-5-Turbo",
                unitType: "token",
              },
            ],
          },
        }),
      );

      expect(html).toContain("4000万");
      expect(html).toContain("每日额度 · GLM-5.2 3000万 · GLM-5-Turbo 1000万");
      expect(html).not.toContain("40M");
      expect(html).not.toContain("30M");
      expect(html).not.toContain("10M");
    } finally {
      intlMockState.locale = "en-US";
    }
  });

  it("StartPlanCard 中文界面单模型每日额度使用本地化紧凑单位", () => {
    intlMockState.locale = "zh-CN";
    try {
      const html = renderToStaticMarkup(
        createElement(StartPlanCard, {
          preview: {
            planId: "zcode-v3-start-plan",
            name: "ZCode V3 Start Plan",
            entitlements: [
              {
                grantUnits: 5_000_000,
                meter: "model_usage",
                period: "daily",
                showName: "GLM-5.2",
                unitType: "token",
              },
            ],
          },
        }),
      );

      expect(html).toContain("500万");
      expect(html).toContain("tokens/日");
      expect(html).toContain("每日额度 · GLM-5.2 500万");
      expect(html).not.toContain("5 Million");
      expect(html).not.toContain("5M");
    } finally {
      intlMockState.locale = "en-US";
    }
  });

  it("Z.ai Start Plan 编程套餐列表复用 Coding Plan 商品来源", () => {
    expect(
      resolveCodingPlanUpgradeProductsProviderId(BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan),
    ).toBe(BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan);
  });

  it("Z.ai Start Plan 未登录且无远端 preview 时不显示 Trial plan 卡片", () => {
    const html = renderDetail({
      key: "coding-plan:account:zai-start-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: null,
      status: "disconnected",
      purchaseUrl: "https://z.ai/",
      statusActive: false,
    });

    expect(html).toContain("settings.modelProvider.planCard.startPlan");
    expect(html).not.toContain("settings.modelProvider.startPlan.summaryTitle");
    expect(html).not.toContain("settings.modelProvider.startPlan.quotaSectionTitle");
    expect(html).not.toContain("settings.modelProvider.startPlan.heroMetric");
    expect(html).not.toContain("settings.modelProvider.startPlan.heroMetricUnit");
    expect(html).not.toContain("settings.modelProvider.startPlan.summaryDescription");
    expect(html).not.toContain("settings.modelProvider.startPlan.eligibleNewUser");
    expect(html).not.toContain("settings.modelProvider.models");
    expect(html).not.toContain("glm-4.7");
    expect(html).not.toContain("settings.modelProvider.codingPlan.connect");
    expect(html).not.toContain("settings.modelProvider.codingPlan.login");
    expect(html).toContain("settings.modelProvider.startPlan.status.loginRequired");
    expect(html).not.toContain("settings.modelProvider.codingPlan.description.disconnected");
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.personalTitle");
    expect(html).not.toContain(
      "settings.modelProvider.codingPlan.purchaseBanner.personalDescription",
    );
    expect(html).not.toContain("CN¥49.00+");
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.teamTitle");
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.teamDescription");
    expect(html).not.toContain("CN¥598.00+");
    expect(html).not.toContain("settings.modelProvider.codingPlan.productsLoading");
    expect(html).not.toContain("settings.modelProvider.baseUrl");
    expectConnectionApiFormatHidden(html);
    expect(html).not.toContain("settings.modelProvider.apiKeyPlaceholder");
    expect(html).not.toContain("settings.modelProvider.disableAction");
    expect(html).not.toContain("settings.modelProvider.addModel");
  });

  it("Z.ai Start 详情不显示体验套餐推广横幅", () => {
    primeStartPlanPreviewCacheForTest({
      planId: "zcode-v3-start-plan",
      name: "ZCode V3 Start Plan",
      entitlements: [
        {
          grantUnits: 5_000_000,
          meter: "model_usage",
          period: "daily",
          showName: "GLM-5.2",
          unitType: "token",
        },
      ],
    });

    const html = renderDetail({
      key: "coding-plan:account:zai-start-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: null,
      status: "disconnected",
      purchaseUrl: "https://z.ai/",
      statusActive: false,
    });

    expect(html).not.toContain("ZCode V3 Start Plan");
    expect(html).not.toContain("5 Million");
    expect(html).not.toContain("Daily quota · GLM-5.2 5M");
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.personalTitle");
    expect(html).not.toContain("CN¥49.00+");
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.teamTitle");
    expect(html).not.toContain("CN¥598.00+");
  });

  it("Z.ai Coding Plan 未连接时显示 Plan Card 且不显示 API Key 字段", () => {
    const html = renderDetail({
      key: "coding-plan:account:zai-individual-coding-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: null,
      status: "disconnected",
      purchaseUrl: "https://z.ai/",
      statusActive: false,
    });

    expect(html).toContain("settings.modelProvider.planCard.codingPlan");
    expect(html).toContain("settings.modelProvider.codingPlan.status.disconnected");
    expect(html).toContain("settings.modelProvider.codingPlan.connect");
    expect(html).not.toContain("settings.modelProvider.codingPlan.dynamicUnsupportedTitle");
    expect(html).not.toContain("settings.modelProvider.codingPlan.productsLoading");
    expect(html).not.toContain("settings.modelProvider.codingPlan.zai.plan.lite.name");
    expect(html).not.toContain("settings.modelProvider.codingPlan.zai.plan.pro.name");
    expect(html).not.toContain("settings.modelProvider.codingPlan.zai.plan.max.name");
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.personalTitle");
    expect(html).not.toContain(
      "settings.modelProvider.codingPlan.purchaseBanner.personalDescription",
    );
    expect(html).not.toContain("CN¥49.00+");
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.teamTitle");
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.teamDescription");
    expect(html).not.toContain("CN¥598.00+");
    expect(html).not.toContain("settings.modelProvider.codingPlan.useApiKeyProvider");
    expect(html).not.toContain("settings.modelProvider.apiKey");
  });





  it("未登录 Start/Coding 时仍允许保持 Coding Plan 选中项", () => {
    const apiKeyItem = {
      key: "preset:account:zai-start-plan",
      type: "preset" as const,
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
      label: "Z.ai - API Key",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
        name: "Z.ai - API Key",
      }),
      displayName: "Z.ai - API Key",
      statusActive: true,
    };
    const startItem = {
      key: "coding-plan:account:zai-start-plan",
      type: "codingPlan" as const,
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: null,
      status: "disconnected" as const,
      planLevel: null,
      currentProductId: null,
      subscriptionBillingCycle: null,
      subscriptionRenewTime: null,
      subscriptionExpireTime: null,
      quotaLimits: [],
      purchaseUrl: "https://z.ai/",
      statusActive: false,
    };

    const selectedNodeKey = resolveSelectedFamilyModeNodeKey({
      selectedNavItem: startItem,
      selectableNavigationItems: [apiKeyItem, startItem],
      modelProviderFamilyModes: {
        zai: "oauth",
      },
    });

    expect(selectedNodeKey).toBeNull();
  });




  it("Start 过期快照显示过期提示且隐藏余额和模型，即使旧 Account 仍 available", () => {
    const providerId = BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan;
    const state = resolveCodingPlanEntitlementState({
      providerId,
      accountEntitled: true,
      modelProvidersLoading: false,
      entitlement: {
        loading: false,
        error: null,
        snapshot: createEntitlementSnapshot({
          unavailableReason: "no_plan",
          startPlanExpired: true,
          subscription: null,
          quota: null,
          remaining: null,
        }),
      },
    });
    expect(state.status).toBe("notPurchased");
    expect(state.statusLabelId).toBe("settings.modelProvider.startPlan.status.expired");
    const provider = createProvider({ id: providerId, models: ["expired-start-model"] });
    const html = renderDetail(
      {
        key: `coding-plan:${providerId}`,
        type: "codingPlan",
        presetId: providerId,
        oauthProviderId: BIGMODEL_PROVIDER_ID,
        providerName: "BigModel",
        label: "Start Plan",
        provider,
        ...state,
        statusActive: false,
      },
      { providerSettingsView: createProviderSettingsView(provider) },
    );
    expect(html).toContain("settings.modelProvider.startPlan.status.expired");
    expect(html).not.toContain("expired-start-model");
    expect(html).not.toContain("settings.modelProvider.startPlan.balance.title");
  });




  it("Z.ai Start 登录后入口互斥时回落到可见的 Z.ai plan", () => {
    const fallbackNodeKey = resolveFallbackModelProviderNodeKey({
      selectedNodeKey: "coding-plan:account:zai-start-plan",
      selectableNavigationItems: [
        {
          key: "preset:account:zai-start-plan",
          type: "preset",
          presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
          label: "Z.ai - API Key",
          provider: createProvider({
            id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
          }),
          displayName: "Z.ai - API Key",
          statusActive: true,
        },
        {
          key: "coding-plan:account:zai-individual-coding-plan",
          type: "codingPlan",
          presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
          oauthProviderId: ZAI_PROVIDER_ID,
          label: "Z.ai - Coding Plan",
          providerName: "Z.ai",
          provider: createProvider({
            id: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
            apiKey: "zai-coding-plan-key",
          }),
          status: "purchased",
          planLevel: "pro",
          currentProductId: "product-zai-pro-monthly",
          subscriptionBillingCycle: null,
          subscriptionRenewTime: null,
          subscriptionExpireTime: null,
          quotaLimits: [],
          purchaseUrl: "https://z.ai/manage-apikey/subscription",
          statusActive: true,
        },
      ],
    });

    expect(fallbackNodeKey).toBe("preset:account:zai-start-plan");
  });

  it("BigModel 登录后当前选中项不可见时回落到 BigModel Coding Plan", () => {
    const fallbackNodeKey = resolveFallbackModelProviderNodeKey({
      selectedNodeKey: "coding-plan:account:zai-individual-coding-plan",
      selectableNavigationItems: [
        {
          key: "preset:account:bigmodel-start-plan",
          type: "preset",
          presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
          label: "BigModel - API Key",
          provider: createProvider({
            id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
          }),
          displayName: "BigModel - API Key",
          statusActive: true,
        },
        {
          key: "coding-plan:account:bigmodel-individual-coding-plan",
          type: "codingPlan",
          presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
          oauthProviderId: BIGMODEL_PROVIDER_ID,
          label: "BigModel - Coding Plan",
          providerName: "BigModel",
          provider: createProvider({
            id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
            apiKey: "bigmodel-coding-plan-key",
          }),
          status: "purchased",
          planLevel: "pro",
          currentProductId: "product-bigmodel-pro-monthly",
          subscriptionBillingCycle: null,
          subscriptionRenewTime: null,
          subscriptionExpireTime: null,
          quotaLimits: [],
          purchaseUrl: "https://bigmodel.cn/",
          statusActive: true,
        },
      ],
    });

    expect(fallbackNodeKey).toBe("preset:account:bigmodel-start-plan");
  });

  it("首次进入 Model Providers 默认选中可见的 Z.ai Coding Plan", () => {
    const fallbackNodeKey = resolveFallbackModelProviderNodeKey({
      selectedNodeKey: null,
      selectableNavigationItems: [
        {
          key: "preset:account:zai-start-plan",
          type: "preset",
          presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
          label: "Z.ai - API Key",
          provider: createProvider({
            id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
          }),
          displayName: "Z.ai - API Key",
          statusActive: true,
        },
        {
          key: "coding-plan:account:zai-individual-coding-plan",
          type: "codingPlan",
          presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
          oauthProviderId: ZAI_PROVIDER_ID,
          label: "Z.ai - Coding Plan",
          providerName: "Z.ai",
          provider: createProvider({
            id: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
            apiKey: "zai-coding-plan-key",
          }),
          status: "purchased",
          planLevel: "pro",
          currentProductId: "product-zai-pro-monthly",
          subscriptionBillingCycle: null,
          subscriptionRenewTime: null,
          subscriptionExpireTime: null,
          quotaLimits: [],
          purchaseUrl: "https://z.ai/manage-apikey/subscription",
          statusActive: true,
        },
      ],
    });

    expect(fallbackNodeKey).toBe("preset:account:zai-start-plan");
  });

  it("首次进入 Model Providers Start 和个人 Coding 都有权益时仍选中 family 节点", () => {
    const fallbackNodeKey = resolveFallbackModelProviderNodeKey({
      selectedNodeKey: null,
      selectableNavigationItems: [
        {
          key: "preset:account:zai-start-plan",
          type: "preset",
          presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
          label: "Z.ai - API Key",
          provider: createProvider({
            id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
          }),
          displayName: "Z.ai - API Key",
          statusActive: true,
        },
        {
          key: "coding-plan:account:zai-individual-coding-plan",
          type: "codingPlan",
          presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
          oauthProviderId: ZAI_PROVIDER_ID,
          label: "Z.ai - Coding Plan",
          providerName: "Z.ai",
          provider: createProvider({
            id: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
            apiKey: "zai-coding-plan-key",
          }),
          status: "purchased",
          planLevel: "pro",
          currentProductId: "product-zai-pro-monthly",
          subscriptionBillingCycle: null,
          subscriptionRenewTime: null,
          subscriptionExpireTime: null,
          quotaLimits: [],
          purchaseUrl: "https://z.ai/manage-apikey/subscription",
          statusActive: true,
        },
        {
          key: "coding-plan:account:zai-start-plan",
          type: "codingPlan",
          presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
          oauthProviderId: ZAI_PROVIDER_ID,
          label: "Z.ai - 体验套餐",
          providerName: "Z.ai",
          provider: createProvider({
            id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
            apiKey: "zcode-jwt",
          }),
          status: "purchased",
          planLevel: "Free",
          currentProductId: "zcode-v3-start-plan",
          subscriptionBillingCycle: null,
          subscriptionRenewTime: null,
          subscriptionExpireTime: null,
          quotaLimits: [],
          purchaseUrl: "https://z.ai/manage-apikey/subscription",
          statusActive: true,
        },
      ],
    });

    expect(fallbackNodeKey).toBe("preset:account:zai-start-plan");
  });

  it("首次进入 Model Providers 个人 Coding 不可用时默认选中第一个 Team Plan", () => {
    const teamPlanItemA = {
      key: "team:bigmodel:product-team-a",
      type: "teamPlan" as const,
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel - Team A",
      providerName: "BigModel",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      }),
      status: "purchased" as const,
      planLevel: "team",
      teamPlanName: "Team A",
      organizationId: "org-a",
      projectId: "proj-a",
      currentProductId: "product-team-a",
      subscriptionBillingCycle: null,
      subscriptionRenewTime: null,
      subscriptionExpireTime: null,
      quotaLimits: [],
      statusActive: true,
    };
    const teamPlanItemB = {
      ...teamPlanItemA,
      key: "team:bigmodel:product-team-b",
      label: "BigModel - Team B",
      teamPlanName: "Team B",
      organizationId: "org-b",
      projectId: "proj-b",
      currentProductId: "product-team-b",
    };
    const fallbackNodeKey = resolveFallbackModelProviderNodeKey({
      selectedNodeKey: null,
      selectableNavigationItems: [
        {
          key: "preset:account:bigmodel-start-plan",
          type: "preset",
          presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
          label: "BigModel - API Key",
          provider: createProvider({
            id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
          }),
          displayName: "BigModel - API Key",
          statusActive: true,
        },
        {
          key: "coding-plan:account:bigmodel-individual-coding-plan",
          type: "codingPlan",
          presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
          oauthProviderId: BIGMODEL_PROVIDER_ID,
          label: "BigModel - Coding Plan",
          providerName: "BigModel",
          provider: createProvider({
            id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
          }),
          status: "notPurchased",
          planLevel: null,
          currentProductId: null,
          subscriptionBillingCycle: null,
          subscriptionRenewTime: null,
          subscriptionExpireTime: null,
          quotaLimits: [],
          purchaseUrl: "https://bigmodel.cn/",
          statusActive: true,
        },
        teamPlanItemA,
        teamPlanItemB,
      ],
    });

    expect(fallbackNodeKey).toBe("preset:account:bigmodel-start-plan");
  });

  it("首次进入 Model Providers 没有套餐权益时默认选中 API Key", () => {
    const fallbackNodeKey = resolveFallbackModelProviderNodeKey({
      selectedNodeKey: null,
      selectableNavigationItems: [
        {
          key: "preset:account:zai-start-plan",
          type: "preset",
          presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
          label: "Z.ai - API Key",
          provider: createProvider({
            id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
          }),
          displayName: "Z.ai - API Key",
          statusActive: true,
        },
        {
          key: "coding-plan:account:zai-start-plan",
          type: "codingPlan",
          presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
          oauthProviderId: ZAI_PROVIDER_ID,
          label: "Z.ai - 体验套餐",
          providerName: "Z.ai",
          provider: null,
          status: "disconnected",
          planLevel: null,
          currentProductId: null,
          subscriptionBillingCycle: null,
          subscriptionRenewTime: null,
          subscriptionExpireTime: null,
          quotaLimits: [],
          purchaseUrl: "https://z.ai/manage-apikey/subscription",
          statusActive: false,
        },
        {
          key: "coding-plan:account:zai-individual-coding-plan",
          type: "codingPlan",
          presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
          oauthProviderId: ZAI_PROVIDER_ID,
          label: "Z.ai - Coding Plan",
          providerName: "Z.ai",
          provider: null,
          status: "disconnected",
          planLevel: null,
          currentProductId: null,
          subscriptionBillingCycle: null,
          subscriptionRenewTime: null,
          subscriptionExpireTime: null,
          quotaLimits: [],
          purchaseUrl: "https://z.ai/manage-apikey/subscription",
          statusActive: false,
        },
      ],
    });

    expect(fallbackNodeKey).toBe("preset:account:zai-start-plan");
  });

  it("Z.ai Coding Plan 不可见时首次进入默认选中 Z.ai Start Plan", () => {
    const fallbackNodeKey = resolveFallbackModelProviderNodeKey({
      selectedNodeKey: null,
      selectableNavigationItems: [
        {
          key: "preset:account:zai-start-plan",
          type: "preset",
          presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
          label: "Z.ai - API Key",
          provider: createProvider({
            id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
          }),
          displayName: "Z.ai - API Key",
          statusActive: true,
        },
        {
          key: "coding-plan:account:zai-start-plan",
          type: "codingPlan",
          presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
          oauthProviderId: ZAI_PROVIDER_ID,
          label: "Z.ai - 体验计划",
          providerName: "Z.ai",
          provider: createProvider({
            id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
            apiKey: "zcode-jwt",
          }),
          status: "purchased",
          planLevel: "Free",
          currentProductId: "zcode-v3-start-plan",
          subscriptionBillingCycle: null,
          subscriptionRenewTime: null,
          subscriptionExpireTime: null,
          quotaLimits: [],
          purchaseUrl: "https://z.ai/manage-apikey/subscription",
          statusActive: true,
        },
      ],
    });

    expect(fallbackNodeKey).toBe("preset:account:zai-start-plan");
  });











  it("Z.ai Coding Plan 未连接时在 Plan Card 右侧显示 Connect 入口", () => {
    const apiKeyItem = {
      key: "preset:account:zai-start-plan",
      type: "preset" as const,
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
      label: "Z.ai - API Key",
      displayName: "Z.ai - API Key",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
        name: "Z.ai - API Key",
      }),
      statusActive: true,
    };
    const oauthItem = {
      key: "coding-plan:account:zai-individual-coding-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: createProvider({ apiKey: "", models: [] }),
      status: "disconnected",
      purchaseUrl: "https://z.ai/",
      statusActive: false,
    } as const;
    const html = renderDetail(oauthItem, {
      navigationItems: [oauthItem, apiKeyItem],
      onSelectNavItem: vi.fn(),
    });

    expect(html).toContain("settings.modelProvider.planCard.codingPlan");
    expect(html).toContain("settings.modelProvider.codingPlan.status.disconnected");
    expect(html).toContain("settings.modelProvider.codingPlan.connect");
    expect(html).not.toContain('data-testid="model-provider-enabled-switch"');
    expect(html).not.toContain("settings.modelProvider.codingPlan.productsLoading");
    expect(html).not.toContain("GLM Coding Lite");
    expect(html).not.toContain("GLM Coding Pro");
    expect(html).not.toContain("GLM Coding Max");
    expect(html).not.toContain("lucide-loader-circle");
    expect(html).not.toContain("settings.modelProvider.codingPlan.dynamicUnsupportedTitle");
    expect(html).not.toContain("settings.modelProvider.models");
    expect(html).not.toContain("settings.modelProvider.apiKeyPlaceholder");
  });

  it("Z.ai Coding Plan 连接等待时状态卡片显示 loading", () => {
    const html = renderDetail(
      {
        key: "coding-plan:account:zai-individual-coding-plan",
        type: "codingPlan",
        presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
        oauthProviderId: ZAI_PROVIDER_ID,
        label: "Z.ai - Coding Plan",
        providerName: "Z.ai",
        provider: createProvider({ apiKey: "", models: [] }),
        status: "disconnected",
        purchaseUrl: "https://z.ai/",
        statusActive: false,
      },
      {
        presetSubscriptionProviderId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      },
    );

    expect(html).toContain("settings.modelProvider.codingPlan.status.checking");
    expect(html).toContain("lucide-loader-circle");
    expect(html).toContain("settings.modelProvider.codingPlan.connect");
  });

  it("Z.ai Start Plan 连接等待时不提前显示今日余额", () => {
    const html = renderDetail(
      {
        key: "coding-plan:account:zai-start-plan",
        type: "codingPlan",
        presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
        oauthProviderId: ZAI_PROVIDER_ID,
        label: "Z.ai - Coding Plan",
        providerName: "Z.ai",
        provider: createProvider({
          id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
          apiKey: "",
          models: [],
        }),
        status: "disconnected",
        purchaseUrl: "https://z.ai/",
        statusActive: false,
      },
      {
        presetSubscriptionProviderId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
      },
    );

    expect(html).toContain("settings.modelProvider.codingPlan.status.checking");
    expect(html).toContain("lucide-loader-circle");
    expect(html).not.toContain("settings.modelProvider.codingPlan.connect");
    expect(html).not.toContain("settings.modelProvider.startPlan.quotaSectionTitle");
    expect(html).not.toContain("settings.modelProvider.startPlan.balance.title");
  });

  it("Z.ai Coding Plan 权益查询中时状态卡片不空白", () => {
    const html = renderDetail({
      key: "coding-plan:account:zai-individual-coding-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: createProvider({ apiKey: "zai-coding-plan-key" }),
      status: "checking",
      planLevel: null,
      purchaseUrl: "https://z.ai/",
      statusActive: false,
    });

    expect(html).toContain("settings.modelProvider.codingPlan.status.checking");
    expect(html).toContain("lucide-loader-circle");
    expect(html).not.toContain("settings.modelProvider.codingPlan.manage");
    expect(html).not.toContain("settings.modelProvider.codingPlan.upgrade");
  });

  it("Z.ai Coding Plan 有 apiKey 但无静态商品时隐藏个人套餐横幅", () => {
    const html = renderDetail({
      key: "coding-plan:account:zai-individual-coding-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: createProvider({ apiKey: "zai-coding-plan-key" }),
      status: "notPurchased",
      purchaseUrl: "https://z.ai/",
      statusActive: false,
    });

    expect(html).toContain("settings.modelProvider.codingPlan.status.notPurchased");
    expect(html).not.toContain("settings.modelProvider.codingPlan.description.notPurchased");
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.personalTitle");
    expect(html).not.toContain(
      "settings.modelProvider.codingPlan.purchaseBanner.personalDescription",
    );
    expect(html).not.toContain("CN¥49.00+");
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.teamTitle");
    expect(html).not.toContain("CN¥598.00+");
    expect(html).not.toContain("settings.modelProvider.codingPlan.upgrade");
    expect(html).not.toContain("settings.modelProvider.codingPlan.productsLoading");
    expect(html).not.toContain("settings.modelProvider.models");
    expect(html).not.toContain("settings.modelProvider.apiKey");
  });

  it("Z.ai Coding Plan 入口价格跟随 Z.ai 商品币种", () => {
    expect(
      resolvePurchaseChoiceBannerPrice({
        providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
        audience: "personal",
        products: [
          {
            productId: "zai-lite-month",
            productName: "GLM Coding Lite",
            productEquityList: [],
            priceCurrency: "USD",
            payAmount: 18,
          },
        ],
      }),
    ).toEqual({ kind: "price", price: 18, currency: "USD" });
  });

  it("个人套餐入口价格在全部售罄时显示售罄状态", () => {
    expect(
      resolvePurchaseChoiceBannerPrice({
        providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
        audience: "personal",
        products: [
          {
            productId: "zai-lite-month",
            productName: "GLM Coding Lite",
            productEquityList: [],
            priceCurrency: "USD",
            payAmount: 18,
            soldOut: true,
          },
          {
            productId: "zai-pro-month",
            productName: "GLM Coding Pro",
            productEquityList: [],
            priceCurrency: "USD",
            payAmount: 88,
            soldOut: true,
          },
        ],
      }),
    ).toEqual({ kind: "soldOut" });
  });

  it("未登录个人套餐入口不前置显示售罄状态", () => {
    expect(
      resolvePurchaseChoiceBannerPrice({
        providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
        audience: "personal",
        soldOutVisible: false,
        products: [
          {
            productId: "bigmodel-lite-month",
            productName: "GLM Coding Lite",
            productEquityList: [],
            priceCurrency: "CNY",
            payAmount: 49,
            soldOut: true,
          },
        ],
      }),
    ).toBeNull();
  });

  it("Z.ai Start Plan 入口价格读取付费 Coding Plan 商品源", () => {
    expect(
      resolvePurchaseChoiceBannerProductsProviderId(BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan),
    ).toBe(BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan);
  });

  it("BigModel Coding Plan 无静态商品时不补固定价格", () => {
    expect(
      resolvePurchaseChoiceBannerPrice({
        providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
        audience: "personal",
        products: [],
      }),
    ).toBeNull();
  });

  it("BigModel 登录后团队入口按企业套餐分组显示标准版和高级版价格", () => {
    const groups = groupEnterpriseCodingPlanProductsByTier(
      [
        {
          productId: "team-pro-year",
          productName: "Pro",
          productEquityList: [],
          priceCurrency: "CNY",
          payAmount: 598,
          tier: "PRO",
          subscribeMode: "CONTINUOUS",
          subscribePeriod: "YEARLY",
          purchaseMethodName: "Auto renew",
          enterpriseProduct: {
            productId: "team-pro-year",
            tier: "PRO",
            subscribeMode: "CONTINUOUS",
            subscribePeriod: "YEARLY",
            payAmount: 598,
          },
        },
        {
          productId: "team-max-year",
          productName: "Max",
          productEquityList: [],
          priceCurrency: "CNY",
          payAmount: 1298,
          tier: "MAX",
          subscribeMode: "CONTINUOUS",
          subscribePeriod: "YEARLY",
          purchaseMethodName: "Auto renew",
          enterpriseProduct: {
            productId: "team-max-year",
            tier: "MAX",
            subscribeMode: "CONTINUOUS",
            subscribePeriod: "YEARLY",
            payAmount: 1298,
          },
        },
      ],
      {
        locale: "zh-CN",
        formatMessage: (id, fallback) => (zhCN as Record<string, string>)[id] ?? fallback,
      },
    );

    expect(groups.map((group) => group.title)).toEqual(["标准版", "高级版"]);
    expect(groups.map(resolveEnterprisePurchaseChoiceBannerPrice)).toEqual([
      { kind: "price", price: 598, currency: "CNY" },
      { kind: "price", price: 1298, currency: "CNY" },
    ]);
  });

  it("Z.ai Coding Plan 已购买时显示 Plan Card、用量卡和解绑入口", () => {
    // Bugfix：用例运行日在 8 月 10 日时，产品会把额度重置时间识别为“今天”并省略日期。
    // 只在同步渲染期间固定到同年的 1 月 15 日，稳定验证“日期 + 时间”展示，并保证断言失败时恢复时钟。
    const currentYear = 2026;
    vi.useFakeTimers();
    let html = "";
    try {
      vi.setSystemTime(new Date(currentYear, 0, 15, 12, 0));
      html = renderDetail({
        key: "coding-plan:account:zai-individual-coding-plan",
        type: "codingPlan",
        presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
        oauthProviderId: ZAI_PROVIDER_ID,
        label: "Z.ai - Coding Plan",
        providerName: "Z.ai",
        provider: createProvider(),
        status: "purchased",
        planLevel: "pro",
        subscriptionBillingCycle: "monthly",
        subscriptionRenewTime: `${currentYear}-07-10T00:00:00.000Z`,
        subscriptionExpireTime: "2026-12-31T00:00:00.000Z",
        purchaseUrl: "https://z.ai/",
        quotaLimits: [
          {
            type: "TOKENS_LIMIT",
            unit: 3,
            number: 5,
            usage: 250_000,
            remaining: 750_000,
            percentage: 25,
            nextResetTime: new Date(currentYear, 7, 10, 9, 30).getTime(),
            usageDetails: [
              {
                modelCode: "glm-coding-lite",
                displayName: "GLM CODING LITE",
                usage: 250_000,
              },
            ],
          },
          {
            type: "TOKENS_LIMIT",
            unit: 6,
            currentValue: 500_000,
            remaining: 500_000,
            percentage: 50,
            nextResetTime: new Date(currentYear, 7, 11).getTime(),
            usageDetails: [],
          },
          {
            type: "TIME_LIMIT",
            unit: 5,
            number: 1,
            usage: 1_000,
            remaining: 9_000,
            percentage: 10,
            nextResetTime: new Date(currentYear, 7, 12).getTime(),
            usageDetails: [
              {
                modelCode: "search-prime",
                displayName: "Search Prime",
                usage: 500,
              },
              {
                modelCode: "web-reader",
                displayName: "Web Reader",
                usage: 300,
              },
              { modelCode: "zr", displayName: "Zr", usage: 200 },
            ],
          },
        ],
        statusActive: true,
      });
    } finally {
      vi.useRealTimers();
    }

    expect(html).not.toContain("settings.modelProvider.codingPlan.status.purchased");
    expect(html).not.toContain("settings.modelProvider.enabledStatus");
    // 套餐卡不提供 Provider 启停；下方模型行仍应提供自己的启停控件。
    expect(html.split("settings.modelProvider.models")[0]).not.toContain(
      "settings.modelProvider.disableAction",
    );
    expect(html).toContain(">PRO<");
    expect(html).toContain("settings.usage.entitlementFiveHourUsage");
    expect(html).toContain("settings.usage.entitlementWeeklyUsage");
    expect(html).toContain("settings.usage.entitlementMonthlyMcpUsage");
    expect(html).toContain("GLM Coding Lite");
    expect(html).not.toContain("GLM CODING LITE");
    expect(html).not.toContain("Search Prime");
    expect(html).not.toContain("Web Reader");
    expect(html).not.toContain(">Zr<");
    expect(html).toContain("75%");
    expect(html).toContain("50%");
    expect(html).toContain("90%");
    expect(html).toContain("Aug 10, 09:30");
    expect(html).toContain("Aug 11");
    expect(html).toContain("Aug 12");
    expect(html.indexOf("75%")).toBeLessThan(html.indexOf("Aug 10, 09:30"));
    expect(html).not.toContain("settings.modelProvider.startPlan.balance.used");
    expect(html).not.toContain("settings.modelProvider.codingPlan.period.monthly");
    expect(html).toContain("settings.modelProvider.codingPlan.renewsAt");
    expect(html).toContain("settings.modelProvider.codingPlan.manage");
    expect(html).toContain("settings.modelProvider.codingPlan.upgrade");
    expect(html).toContain("Jul 10");
    expect(html).not.toContain(`Jul 10, ${currentYear}`);
    expect(html).not.toContain("settings.modelProvider.codingPlan.expiresAt");
    expect(html).toContain("settings.modelProvider.codingPlan.disconnect");
    expect(html).not.toContain("settings.modelProvider.codingPlan.resetItem");
    expect(html).toContain("settings.modelProvider.models");
    expect(html).not.toContain("settings.modelProvider.codingPlan.zai.plan.lite.name");
    expect(html).not.toContain("settings.modelProvider.connectionMode");
    expect(html).not.toContain("settings.modelProvider.apiKey");
  });

  it("Z.ai Coding Plan 已购买时升级入口不替换下方模型配置", () => {
    const html = renderDetail({
      key: "coding-plan:account:zai-individual-coding-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: createProvider(),
      status: "purchased",
      planLevel: "PRO",
      currentProductId: "zai-coding-pro-monthly",
      purchaseUrl: "https://z.ai/",
      statusActive: true,
    });

    expect(html).toContain("settings.modelProvider.codingPlan.upgrade");
    expect(html).toContain("settings.modelProvider.models");
    expect(html).not.toContain("settings.modelProvider.codingPlan.description.notPurchased");
  });

  it("Z.ai Coding Plan 已购买时允许在官方模型列表添加模型", () => {
    const html = renderDetail({
      key: "coding-plan:account:zai-individual-coding-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: createProvider(),
      status: "purchased",
      planLevel: "PRO",
      currentProductId: "zai-coding-pro-monthly",
      purchaseUrl: "https://z.ai/",
      statusActive: true,
    });

    expect(html).toContain("settings.modelProvider.models");
    expect(html).toContain("settings.modelProvider.addModel");
  });

  it("Coding Plan 用量卡 percentage 按已用百分比反转成剩余百分比", () => {
    const html = renderDetail({
      key: "coding-plan:account:zai-individual-coding-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: createProvider(),
      status: "purchased",
      planLevel: "pro",
      quotaLimits: [
        {
          type: "TOKENS_LIMIT",
          unit: 3,
          number: 5,
          usage: 100_000,
          remaining: 900_000,
          percentage: 1,
          usageDetails: [],
        },
      ],
      statusActive: true,
    });

    expect(html).toContain("99%");
    expect(html).not.toContain(">0%</");
  });

  it("Team Plan 复用 Coding Plan 用量卡展示 quota/limit 数据", () => {
    const html = renderDetail({
      key: "team:bigmodel:product-team:proj-team",
      type: "teamPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel - Team Plan",
      providerName: "BigModel",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      }),
      status: "purchased",
      planLevel: "pro",
      teamPlanName: "Team A",
      organizationId: "org-team",
      projectId: "proj-team",
      currentProductId: "product-team",
      quotaLimits: [
        {
          type: "TOKENS_LIMIT",
          unit: 3,
          number: 5,
          usage: 100_000,
          remaining: 900_000,
          percentage: 10,
          usageDetails: [],
        },
        {
          type: "TIME_LIMIT",
          unit: 5,
          number: 1,
          usage: 1_000,
          remaining: 9_000,
          percentage: 10,
          usageDetails: [],
        },
      ],
      statusActive: true,
    });

    expect(html).toContain("settings.usage.entitlementFiveHourUsage");
    expect(html).toContain("settings.usage.entitlementMonthlyMcpUsage");
    expect(html).not.toContain("settings.modelProvider.startPlan.balance.title");
  });

  it("Team Plan 未分配时不显示获取失败 access banner", () => {
    const providerId = BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan;
    const html = renderDetail({
      key: "team:bigmodel:product-team:org-team:proj-team",
      type: "teamPlan",
      presetId: providerId,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel - Team A",
      providerName: "BigModel",
      provider: createProvider({
        id: providerId,
        models: ["glm-team-visible"],
      }),
      status: "unavailable",
      statusLabelId: "settings.modelProvider.codingPlan.status.teamUnavailable",
      availabilityReason: "not-allocated",
      inactivePlanTitle: "Team A",
      planLevel: "Team A",
      teamPlanName: "Team A",
      organizationId: "org-team",
      projectId: "proj-team",
      currentProductId: "product-team",
      quotaLimits: [],
      statusActive: false,
    });

    expect(html).toContain("settings.modelProvider.codingPlan.status.teamUnavailable");
    expect(html).not.toContain("settings.modelProvider.codingPlan.status.unavailable");
    expect(html).not.toContain("settings.modelProvider.codingPlan.description.unavailable");
    expect(html).not.toContain("glm-team-visible");
    expectConnectionApiFormatHidden(html);
    expect(html).not.toContain("settings.modelProvider.baseUrl");
  });

  it("Team Plan 只从 Settings View 读取 Effective Provider，套餐状态不能覆盖模型列表", () => {
    const providerId = BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan;
    const effectiveProvider = createProvider({
      id: providerId,
      models: ["effective-team-model"],
      endpoints: { baseURL: "https://effective.example.com/v1" },
    });
    const html = renderDetail(
      {
        key: "team:bigmodel:product-team:org-team:proj-team",
        type: "teamPlan",
        presetId: providerId,
        oauthProviderId: BIGMODEL_PROVIDER_ID,
        label: "BigModel - Team A",
        providerName: "BigModel",
        provider: createProvider({
          id: providerId,
          models: ["stale-nav-model"],
        }),
        status: "checking",
        inactivePlanTitle: "Team A",
        planLevel: "Team A",
        teamPlanName: "Team A",
        organizationId: "org-team",
        projectId: "proj-team",
        currentProductId: "product-team",
        quotaLimits: [],
        statusActive: false,
      },
      { providerSettingsView: createProviderSettingsView(effectiveProvider) },
    );

    expect(html).toContain("effective-team-model");
    expect(html).not.toContain("stale-nav-model");
    expectConnectionApiFormatHidden(html);
    expect(html).not.toContain("settings.modelProvider.baseUrl");
  });

  it("Team Plan 明确无权益且缺少 Provider 时不显示模型配置异常", () => {
    const providerId = BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan;
    const html = renderDetail(
      {
        key: "team:bigmodel:product-team:org-team:proj-team",
        type: "teamPlan",
        presetId: providerId,
        oauthProviderId: BIGMODEL_PROVIDER_ID,
        label: "BigModel - Team A",
        providerName: "BigModel",
        provider: createProvider({
          id: providerId,
          models: ["stale-team-model"],
        }),
        status: "unavailable",
        availabilityReason: "not-allocated",
        teamPlanName: "Team A",
        organizationId: "org-team",
        projectId: "proj-team",
        currentProductId: "product-team",
        statusActive: false,
      },
      {
        providerSettingsView: {
          revision: 18,
          addableProviders: [],
          providerOrder: [],
          providers: [],
        },
      },
    );

    expect(html).not.toContain("settings.modelProvider.accountProviderConfigMissing");
    expect(html).not.toContain("stale-team-model");
  });

  it("Individual Coding Plan 在不可用状态仍显示 Effective 模型，但隐藏 Endpoint 与 API Schema", () => {
    const providerId = BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan;
    const html = renderDetail({
      key: `coding-plan:${providerId}`,
      type: "codingPlan",
      presetId: providerId,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel - Coding Plan",
      providerName: "BigModel",
      provider: createProvider({
        id: providerId,
        models: ["individual-visible-model"],
      }),
      status: "unavailable",
      statusActive: false,
    });

    expect(html).toContain("individual-visible-model");
    expectConnectionApiFormatHidden(html);
    expect(html).not.toContain("settings.modelProvider.baseUrl");
  });

  it.each(["disconnected", "notPurchased", "purchased", "checking", "unavailable"] as const)(
    "个人套餐 %s 按明确权益决定模型设置是否展示",
    (status) => {
      const providerId = BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan;
      const html = renderDetail({
        key: `coding-plan:${providerId}`,
        type: "codingPlan",
        presetId: providerId,
        oauthProviderId: BIGMODEL_PROVIDER_ID,
        label: "BigModel",
        providerName: "BigModel",
        provider: createProvider({ id: providerId, models: ["entitlement-model"] }),
        status,
        statusActive: status === "purchased",
      });
      expect(html.includes("entitlement-model")).toBe(
        status !== "notPurchased" && status !== "disconnected",
      );
    },
  );

  it("Team Plan 同步 loading 时不显示未分配管理员提示", () => {
    const providerId = BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan;
    const html = renderDetail(
      {
        key: "team:bigmodel:product-team:org-team:proj-team",
        type: "teamPlan",
        presetId: providerId,
        oauthProviderId: BIGMODEL_PROVIDER_ID,
        label: "BigModel - Team A",
        providerName: "BigModel",
        provider: createProvider({ id: providerId }),
        status: "unavailable",
        statusLabelId: "settings.modelProvider.codingPlan.status.teamUnavailable",
        teamPlanAvailabilityReason: "not-allocated",
        inactivePlanTitle: "Team A",
        planLevel: "Team A",
        teamPlanName: "Team A",
        organizationId: "org-team",
        projectId: "proj-team",
        currentProductId: "product-team",
        quotaLimits: [],
        statusActive: false,
      },
      { codingPlanStatusSyncProviderId: providerId },
    );

    expect(html).toContain("settings.modelProvider.codingPlan.status.checking");
    expect(html).not.toContain("settings.modelProvider.codingPlan.status.teamUnavailable");
  });

  it("Team Plan 有效订阅在 quota 缺失时仍保持已启用", () => {
    const item = {
      key: "team:bigmodel:product-team:proj-team",
      type: "teamPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel - Team A",
      providerName: "BigModel",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      }),
      status: "purchased",
      statusLabelId: "settings.modelProvider.codingPlan.status.teamUnavailable",
      availabilityReason: "not-allocated",
      planLevel: "PRO",
      teamPlanName: "Team A",
      organizationId: "org-team",
      projectId: "proj-team",
      currentProductId: "product-team",
      quotaLimits: [],
      statusActive: true,
    } as const;

    const resolved = resolveTeamScopedPlanNavItem(item, {
      loading: false,
      error: null,
      snapshot: createEntitlementSnapshot({
        subscription: {
          identityType: "unknown",
          identityMasked: null,
          details: [
            {
              productId: "product-team",
              productName: "团队套餐高级版",
              purchaseTime: null,
              beginTime: null,
              billingCycle: "quarterly",
              renewTime: "2026-08-01T00:00:00.000Z",
              expireTime: null,
            },
          ],
        },
        quota: null,
      }),
      refresh: vi.fn(),
    } as never);

    expect(resolved.statusActive).toBe(true);
    expect(resolved.planLevel).toBe("Team A");
    expect(resolved.currentProductId).toBe("product-team");
    expect(resolved.subscriptionBillingCycle).toBeNull();
    expect(resolved.subscriptionRenewTime).toBeNull();
    expect(resolved.teamPlanName).toBe("Team A");
    expect(resolved.statusLabelId).toBeUndefined();
    expect(resolved.availabilityReason).toBeUndefined();
  });

  it("Team Plan 明确无订阅时不继续显示已启用或个人续费日期", () => {
    const item = {
      key: "team:bigmodel:product-team:org-team:proj-team",
      type: "teamPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel - GY的组织",
      providerName: "BigModel",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      }),
      status: "purchased",
      planLevel: "PRO",
      teamPlanName: "GY的组织",
      organizationId: "org-team",
      projectId: "proj-team",
      currentProductId: "product-team",
      subscriptionRenewTime: "2026-09-15T00:00:00.000Z",
      subscriptionBillingCycle: "monthly",
      quotaLimits: [],
      statusActive: true,
    } as const;

    const resolved = resolveTeamScopedPlanNavItem(item, {
      loading: false,
      error: null,
      snapshot: createEntitlementSnapshot({
        context: {
          scope: "team",
          organizationId: "org-team",
          projectId: "proj-team",
          productId: "product-team",
          displayName: "GY的组织",
        },
        remaining: null,
        quota: null,
        subscription: null,
        unavailableReason: "no_plan",
      }),
      refresh: vi.fn(),
    } as never);

    expect(resolved.status).toBe("unavailable");
    expect(resolved.statusActive).toBe(false);
    expect(resolved.statusLabelId).toBe("settings.modelProvider.codingPlan.status.teamUnavailable");
    expect(resolved.subscriptionRenewTime).toBeNull();
    expect(resolved.subscriptionBillingCycle).toBeNull();
  });

  it.each(["expired", "unassigned"] as const)("团队明确 %s 不显示查询失败或登录重试", (reason) => {
    const item = {
      key: "team:bigmodel:product:org:project",
      type: "teamPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "团队",
      providerName: "BigModel",
      teamPlanName: "团队",
      organizationId: "org",
      projectId: "project",
      currentProductId: "product",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
        models: ["expired-hidden-model"],
      }),
      status: "unavailable",
      statusActive: false,
      availabilityReason: "credential-unavailable",
      statusMessage: "旧 Key 错误",
    } as const;
    expect(resolveTeamPlanInspectionAccess(item)).toEqual({
      type: "zhipu-account",
      family: "bigmodel",
      planKind: "team-coding-plan",
      productId: "product",
      organizationId: "org",
      projectId: "project",
    });
    expect(resolveTeamPlanInspectionAccess({ ...item, projectId: "" })).toBeUndefined();
    const resolved = resolveTeamScopedPlanNavItem(item, {
      loading: false,
      error: null,
      refresh: vi.fn(),
      snapshot: {
        ...createEntitlementSnapshot(),
        subscription: null,
        unavailableReason: "no_plan",
        teamPlanUnavailableReason: reason,
      },
    } as never);
    const label =
      reason === "expired"
        ? "settings.modelProvider.codingPlan.status.teamExpired"
        : "settings.modelProvider.codingPlan.status.teamUnavailable";
    expect(resolved.statusLabelId).toBe(label);
    const html = renderDetail(resolved, { onRetryCodingPlan: vi.fn() });
    expect(html).toContain(label);
    expect(html).not.toContain("旧 Key 错误");
    expect(html).not.toContain("expired-hidden-model");
    expect(html).not.toContain("common.retry");
    expect(html).not.toContain("settings.modelProvider.codingPlan.connect");
    expect(html).not.toContain("settings.modelProvider.codingPlan.description.unavailable");
  });

  it("Team Plan quota 正在刷新时显示 checking，而不是误报未分配", () => {
    const item = {
      key: "team:bigmodel:product-team:org-team:proj-team",
      type: "teamPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel - Team A",
      providerName: "BigModel",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
      }),
      status: "unavailable",
      statusLabelId: "settings.modelProvider.codingPlan.status.teamUnavailable",
      planLevel: "Team A",
      teamPlanName: "Team A",
      organizationId: "org-team",
      projectId: "proj-team",
      currentProductId: "product-team",
      quotaLimits: [],
      statusActive: false,
    } as const;

    const resolved = resolveTeamScopedPlanNavItem(item, {
      loading: true,
      error: null,
      snapshot: null,
      refresh: vi.fn(),
    } as never);

    expect(resolved.status).toBe("checking");
    expect(resolved.statusLabelId).toBeUndefined();
    expect(resolved.statusActive).toBe(false);
  });

  it("Team Plan quota 查询报错时显示通用获取失败，而不是误报未分配", () => {
    const item = {
      key: "team:bigmodel:product-team:org-team:proj-team",
      type: "teamPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel - Team A",
      providerName: "BigModel",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
      }),
      status: "unavailable",
      statusLabelId: "settings.modelProvider.codingPlan.status.teamUnavailable",
      planLevel: "Team A",
      teamPlanName: "Team A",
      organizationId: "org-team",
      projectId: "proj-team",
      currentProductId: "product-team",
      quotaLimits: [],
      statusActive: false,
    } as const;

    const resolved = resolveTeamScopedPlanNavItem(item, {
      loading: false,
      error: new Error("network failed"),
      snapshot: null,
      refresh: vi.fn(),
    } as never);

    expect(resolved.status).toBe("unavailable");
    expect(resolved.statusLabelId).toBeUndefined();
    expect(resolved.statusActive).toBe(false);
  });

  it("Coding Plan 用量卡只展示接口返回且可识别的额度项", () => {
    const html = renderDetail({
      key: "coding-plan:account:zai-individual-coding-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: createProvider(),
      status: "purchased",
      planLevel: "pro",
      quotaLimits: [
        {
          type: "TOKENS_LIMIT",
          unit: 3,
          number: 5,
          usage: 100_000,
          remaining: 900_000,
          percentage: 10,
          usageDetails: [],
        },
        {
          type: "TOKENS_LIMIT",
          unit: 6,
          usage: 200_000,
          remaining: 800_000,
          percentage: 20,
          usageDetails: [],
        },
      ],
      statusActive: true,
    });

    expect(html).toContain("settings.usage.entitlementFiveHourUsage");
    expect(html).toContain("settings.usage.entitlementWeeklyUsage");
    expect(html).not.toContain("settings.usage.entitlementMonthlyMcpUsage");
    expect(html).toContain("90%");
    expect(html).toContain("80%");
  });

  it("Team Plan 非标准额度项也会展示用量卡", () => {
    const html = renderDetail({
      key: "team:bigmodel:product-team-pro",
      type: "teamPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel - Pro Plan",
      providerName: "BigModel",
      teamPlanName: "Pro",
      organizationId: "org-team-a",
      projectId: "proj-team-a",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      }),
      status: "purchased",
      planLevel: "Pro",
      quotaLimits: [
        {
          type: "team_model_usage",
          number: 2_000_000,
          remaining: 1_500_000,
          usage: 500_000,
          usageDetails: [{ modelCode: "glm-5.2", displayName: "GLM-5.2", usage: 500_000 }],
        },
      ],
      statusActive: true,
    });

    expect(html).toContain("settings.modelProvider.planCard.usage.totalTokens");
    expect(html).toContain("GLM-5.2");
    expect(html).toContain("75%");
  });

  it("Z.ai Coding Plan Upgrade 等待 OAuth 时显示 loading", () => {
    const html = renderDetail(
      {
        key: "coding-plan:account:zai-individual-coding-plan",
        type: "codingPlan",
        presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
        oauthProviderId: ZAI_PROVIDER_ID,
        label: "Z.ai - Coding Plan",
        providerName: "Z.ai",
        provider: createProvider(),
        status: "purchased",
        planLevel: "Start",
        currentProductId: "zai-start-free-monthly",
        purchaseUrl: "https://z.ai/",
        statusActive: true,
      },
      {
        presetSubscriptionProviderId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      },
    );

    expect(html).toContain("settings.modelProvider.codingPlan.upgrade");
    expect(html).toContain("lucide-loader-circle");
  });

  it("Coding Plan 已开通但套餐详情为空时状态卡片不空白", () => {
    const html = renderDetail({
      key: "coding-plan:account:zai-individual-coding-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: createProvider(),
      status: "purchased",
      planLevel: null,
      subscriptionRenewTime: null,
      subscriptionExpireTime: null,
      statusActive: true,
    });

    expect(html).not.toContain("settings.modelProvider.codingPlan.status.purchased");
    expect(html).toContain("settings.modelProvider.codingPlan.upgrade");
    expect(html).not.toContain("settings.modelProvider.codingPlan.manage");
  });

  it("系统关闭的 Coding Plan 状态卡片不显示启用状态或开关", () => {
    const html = renderDetail({
      key: "coding-plan:account:zai-individual-coding-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: createProvider({
        enabled: false,
        systemDisabledReason: "coding_plan_auth_failed",
      }),
      status: "purchased",
      planLevel: "pro",
      purchaseUrl: "https://z.ai/",
      statusActive: false,
    });

    expect(html).not.toContain("settings.modelProvider.disabledStatus");
    expect(html).not.toContain("settings.modelProvider.enableAction");
    expect(html.split("settings.modelProvider.models")[0]).not.toContain(
      "settings.modelProvider.disableAction",
    );
  });

  it("用户关闭的 Start Plan 未连接卡片不显示启用开关", () => {
    const html = renderDetail({
      key: "coding-plan:account:zai-start-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
        name: "Z.ai - Coding Plan",
        apiKey: "",
        enabled: false,
        systemDisabledReason: undefined,
      }),
      status: "disconnected",
      purchaseUrl: "https://z.ai/",
      statusActive: false,
    });

    expect(html).not.toContain("settings.modelProvider.enableAction");
  });

  it("系统关闭的 Start Plan 未连接卡片不显示启用开关", () => {
    const html = renderDetail({
      key: "coding-plan:account:zai-start-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
        name: "Z.ai - Coding Plan",
        apiKey: "",
        enabled: false,
        systemDisabledReason: "coding_plan_not_authenticated",
      }),
      status: "disconnected",
      purchaseUrl: "https://z.ai/",
      statusActive: false,
    });

    expect(html).not.toContain("settings.modelProvider.enableAction");
    expect(html).not.toContain("settings.modelProvider.disableAction");
  });

  it("Z.ai Start Plan 状态卡片隐藏续期时间且不展示管理和解绑入口", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 6, 10, 12, 0));
      const html = renderDetail({
        key: "coding-plan:account:zai-start-plan",
        type: "codingPlan",
        presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
        oauthProviderId: ZAI_PROVIDER_ID,
        label: "Z.ai - Coding Plan",
        providerName: "Z.ai",
        provider: createProvider({
          id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
          name: "Z.ai - Coding Plan",
        }),
        status: "purchased",
        planLevel: "Start",
        subscriptionRenewTime: new Date(2026, 6, 10, 0, 23).toISOString(),
        subscriptionExpireTime: new Date(2026, 6, 10, 23, 59).toISOString(),
        purchaseUrl: "https://z.ai/",
        statusActive: true,
      });

      expect(html.match(/settings\.modelProvider\.planCard\.startPlan/g)?.length).toBe(1);
      expect(html).not.toContain("settings.modelProvider.enabledStatus");
      expect(html.split("settings.modelProvider.models")[0]).not.toContain(
        "settings.modelProvider.disableAction",
      );
      expect(html).not.toContain("settings.modelProvider.codingPlan.start.freeBadge");
      expect(html).toContain("settings.modelProvider.startPlan.expiresAt");
      expect(html).toContain("Jul 10");
      expect(html).not.toContain("settings.modelProvider.codingPlan.renewsAt");
      expect(html).not.toContain("Jul 10 00:23");
      expect(html).not.toContain("Today 00:23");
      expect(html).not.toContain("settings.modelProvider.codingPlan.title");
      // 语义变更:体验套餐卡片不再提供「管理」「解绑」操作,只保留升级 Coding Plan 入口。
      expect(html).not.toContain("settings.modelProvider.codingPlan.manage");
      expect(html).not.toContain("settings.modelProvider.codingPlan.disconnect");
      expect(html).toContain("settings.modelProvider.codingPlan.upgrade");
      expect(html).not.toContain("settings.modelProvider.baseUrl");
      expectConnectionApiFormatHidden(html);
      expect(html).not.toContain("settings.modelProvider.apiKey");
      expect(html).not.toContain("settings.modelProvider.codingPlan.productsLoading");
      expect(html).not.toContain("settings.modelProvider.startPlan.summaryTitle");
      expect(html).not.toContain("settings.modelProvider.startPlan.heroMetric");
      expect(html).not.toContain("settings.modelProvider.startPlan.summaryDescription");
    } finally {
      vi.useRealTimers();
    }
  });

  it("Z.ai Start Plan 状态卡片只显示过期日期", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 5, 3, 12, 0));
      const html = renderDetail({
        key: "coding-plan:account:zai-start-plan",
        type: "codingPlan",
        presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
        oauthProviderId: ZAI_PROVIDER_ID,
        label: "Z.ai - Coding Plan",
        providerName: "Z.ai",
        provider: createProvider({
          id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
          name: "Z.ai - Coding Plan",
        }),
        status: "purchased",
        planLevel: "Start",
        subscriptionRenewTime: new Date(2026, 5, 8, 0, 23).toISOString(),
        subscriptionExpireTime: new Date(2026, 5, 8, 23, 59).toISOString(),
        purchaseUrl: "https://z.ai/",
        statusActive: true,
      });

      expect(html).toContain("settings.modelProvider.startPlan.expiresAt");
      expect(html).toContain("Jun 8");
      expect(html).not.toContain("settings.modelProvider.codingPlan.renewsAt");
      expect(html).not.toContain("Jun 8 00:23");
      expect(html).not.toContain("Jun 8, 00:23");
      expect(html).not.toContain("Jun 8 23:59");
    } finally {
      vi.useRealTimers();
    }
  });

  it("Z.ai Start Plan 显示余额卡片", () => {
    const html = renderDetail({
      key: "coding-plan:account:zai-start-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
        name: "Z.ai - Coding Plan",
      }),
      status: "purchased",
      planLevel: "Start",
      subscriptionRenewTime: new Date(2026, 5, 8, 23, 2).toISOString(),
      subscriptionExpireTime: new Date(2026, 5, 8, 23, 59).toISOString(),
      // 生产数据形态：purchased 快照必带 active 套餐详情，额度桶带 plan_id。
      subscriptionDetails: [
        {
          productId: "zcode-v3-start-plan",
          productName: "ZCode V3 Start Plan",
          purchaseTime: null,
          beginTime: null,
          billingCycle: "daily",
          renewTime: null,
          expireTime: new Date(2026, 5, 8, 23, 59).toISOString(),
        },
      ],
      quotaLimits: [
        {
          type: "ent_zcode_v3_glm_52",
          planId: "zcode-v3-start-plan",
          number: 3_000_000,
          usage: 500_000,
          remaining: 2_500_000,
          nextResetTime: new Date(2026, 5, 8, 23, 2).getTime(),
          usageDetails: [{ modelCode: "glm-5.2", displayName: "GLM-5.2", usage: 500_000 }],
        },
        {
          type: "ent_zcode_v3_glm_5turbo",
          planId: "zcode-v3-start-plan",
          number: 1_000_000,
          usage: 0,
          remaining: 1_000_000,
          nextResetTime: new Date(2026, 5, 8, 23, 2).getTime(),
          usageDetails: [
            {
              modelCode: "glm-5-turbo",
              displayName: "GLM-5-Turbo",
              usage: 0,
            },
          ],
        },
        {
          type: "ent_zcode_v3_glm_coding_lite",
          planId: "zcode-v3-start-plan",
          number: 2_000_000,
          usage: 0,
          remaining: 2_000_000,
          nextResetTime: new Date(2026, 5, 8, 23, 2).getTime(),
          usageDetails: [
            {
              modelCode: "glm-coding-lite",
              displayName: "GLM CODING LITE",
              usage: 0,
            },
          ],
        },
      ],
      purchaseUrl: "https://z.ai/",
      statusActive: true,
    });

    expect(html).toContain("settings.modelProvider.startPlan.balance.title");
    // 体验套餐用量卡片不展示「管理」「解绑」操作,只保留升级 Coding Plan 入口。
    expect(html).not.toContain("settings.modelProvider.codingPlan.manage");
    expect(html).not.toContain("settings.modelProvider.codingPlan.disconnect");
    expect(html).toContain("settings.modelProvider.codingPlan.upgrade");
    // 多卡路径下套餐到期时间只在 StartPlanStatusMeta 渲染一次；
    // 余额卡不再重复展示套餐级 expireTime。
    expect(html.match(/settings\.modelProvider\.startPlan\.expiresAt/g)?.length).toBe(1);
    expect(html).not.toContain("settings.modelProvider.startPlan.balance.remaining");
    expect(html).toContain("GLM-5.2");
    expect(html).toContain("GLM-5-Turbo");
    expect(html).toContain("GLM Coding Lite");
    expect(html).not.toContain("GLM CODING LITE");
    expect(html.indexOf("GLM-5.2")).toBeLessThan(html.indexOf("GLM-5-Turbo"));
    expect(html).not.toContain("GLM-5Turbo");
    expect(html).toContain("83%");
    // 桶刷新时间非当日仅展示日期（Jun 8），与 Coding Plan 重置时间格式对齐。
    expect(html).not.toContain("23:02");
    expect(html).toContain("2,500,000 / 3,000,000");
    expect(html).toContain("1,000,000 / 1,000,000");
    expect(html).not.toContain("2.5M / 3M");
    expect(html).not.toContain("Used 500K");
  });

  it("Start Plan 按服务端顺序展示多个套餐并按 plan id 隔离额度桶", () => {
    const html = renderToStaticMarkup(
      createElement(CodingPlanStatusPanel, {
        providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
        providerName: "Z.ai",
        status: "purchased",
        planLevel: "Welcome Plan",
        subscriptionDetails: [
          {
            productId: "plan-welcome",
            productName: "Welcome Plan",
            purchaseTime: null,
            beginTime: null,
            billingCycle: "daily",
            renewTime: null,
            expireTime: new Date(2026, 5, 8, 23, 59).toISOString(),
          },
          {
            productId: "plan-bonus",
            productName: "Bonus Plan",
            purchaseTime: null,
            beginTime: null,
            billingCycle: "daily",
            renewTime: null,
            expireTime: new Date(2026, 5, 15, 23, 59).toISOString(),
            entitlements: [
              {
                entitlementId: "bonus-glm-5-turbo",
                showName: "GLM-5-Turbo",
                effectiveTime: "2096-08-28T07:00:00.000Z",
              },
            ],
          },
        ],
        quotaLimits: [
          {
            type: "welcome-glm-52",
            planId: "plan-welcome",
            number: 3_000_000,
            remaining: 2_500_000,
            nextResetTime: new Date(2026, 5, 8, 10, 11).getTime(),
            usageDetails: [{ modelCode: "glm-5.2", displayName: "GLM-5.2", usage: 500_000 }],
          },
          {
            type: "bonus-glm-5-turbo",
            planId: "plan-bonus",
            number: 1_000_000,
            remaining: 750_000,
            nextResetTime: new Date(2026, 5, 15, 12, 22).getTime(),
            usageDetails: [
              {
                modelCode: "glm-5-turbo",
                displayName: "GLM-5-Turbo",
                usage: 250_000,
              },
            ],
          },
        ],
      }),
    );

    expect(html.indexOf("Welcome Plan")).toBeLessThan(html.indexOf("Bonus Plan"));
    expect(html).toContain("Jun 8");
    expect(html).toContain("Jun 15");
    // 桶刷新时间与 Coding Plan 对齐：非当日仅展示日期，不携带小时分钟。
    expect(html).not.toContain("10:11");
    expect(html).not.toContain("12:22");
    expect(html).toContain("GLM-5.2");
    expect(html).toContain("GLM-5-Turbo");
    const welcomeIndex = html.indexOf("Welcome Plan");
    const bonusIndex = html.indexOf("Bonus Plan");
    expect(html.slice(welcomeIndex, bonusIndex)).toContain("GLM-5.2");
    expect(html.slice(welcomeIndex, bonusIndex)).not.toContain("GLM-5-Turbo");
    expect(html.slice(bonusIndex)).toContain("GLM-5-Turbo");
    expect(html.slice(bonusIndex)).toContain("settings.modelProvider.startPlan.pendingUntil");
    expect(html.slice(bonusIndex)).toContain('class="whitespace-nowrap text-success"');
    expect(html.slice(bonusIndex)).toContain("settings.modelProvider.startPlan.expiresAt");
    expect(html.slice(bonusIndex)).toContain(">·</span>");
  });

  it("Start Plan 只为尚未生效的 entitlement 展示最早生效时间", () => {
    const now = Date.parse("2026-08-27T00:00:00.000Z");

    expect(
      resolvePendingStartPlanEffectiveTime(
        [
          {
            entitlementId: "immediate",
            effectiveTime: "1970-01-01T00:00:00.000Z",
          },
          { entitlementId: "past", effectiveTime: "2026-08-26T00:00:00.000Z" },
          { entitlementId: "later", effectiveTime: "2026-08-29T00:00:00.000Z" },
          {
            entitlementId: "earlier",
            effectiveTime: "2026-08-28T00:00:00.000Z",
          },
        ],
        now,
      ),
    ).toBe("2026-08-28T00:00:00.000Z");
    expect(
      resolvePendingStartPlanEffectiveTime(
        [
          {
            entitlementId: "immediate",
            effectiveTime: "1970-01-01T00:00:00.000Z",
          },
        ],
        now,
      ),
    ).toBeNull();
  });

  it("Start Plan 刷新完成只认当前 entitlement 对应的额度桶", () => {
    const entitlements = [
      {
        entitlementId: "ent-weekend-glm-53-flash",
        effectiveTime: "2026-09-01T12:00:00.000Z",
      },
    ];

    expect(
      hasStartPlanEntitlementQuota(entitlements, [
        {
          type: "ent-old-glm-52",
          planId: "weekend-build",
          number: 1,
          remaining: 1,
          usageDetails: [],
        },
      ]),
    ).toBe(false);
    expect(
      hasStartPlanEntitlementQuota(entitlements, [
        {
          type: "ent-weekend-glm-53-flash",
          planId: "weekend-build",
          number: 1,
          remaining: 1,
          usageDetails: [],
        },
      ]),
    ).toBe(true);
  });

  it("Start Plan 待生效元信息明确表达尚未生效", () => {
    const now = new Date(2026, 8, 1, 10, 0).getTime();
    const todayEffectiveTime = new Date(2026, 8, 1, 22, 0).toISOString();
    const tomorrowEffectiveTime = new Date(2026, 8, 2, 22, 0).toISOString();
    const laterEffectiveTime = new Date(2026, 8, 4, 22, 0).toISOString();

    expect(formatStartPlanEffectiveDate(todayEffectiveTime, "zh-CN", now)).toBe("今天 22:00");
    expect(formatStartPlanEffectiveDate(todayEffectiveTime, "en-US", now)).toBe("Today 22:00");
    expect(formatStartPlanEffectiveDate(tomorrowEffectiveTime, "zh-CN", now)).toBe("明天 22:00");
    expect(formatStartPlanEffectiveDate(tomorrowEffectiveTime, "en-US", now)).toBe(
      "Tomorrow 22:00",
    );
    expect(formatStartPlanEffectiveDate(laterEffectiveTime, "zh-CN", now)).toBe("9月4日 22:00");
    expect(formatStartPlanEffectiveDate(laterEffectiveTime, "en-US", now)).toBe("Sep 4, 22:00");
    expect(formatStartPlanExpireDate(laterEffectiveTime, "zh-CN", now)).toBe("9月4日 22:00");
    expect(formatStartPlanExpireDate(laterEffectiveTime, "en-US", now)).toBe("Sep 4, 22:00");
  });

  it("Start Plan 余额卡片不从剩余量反推已用量", () => {
    const html = renderDetail({
      key: "coding-plan:account:zai-start-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
      oauthProviderId: ZAI_PROVIDER_ID,
      label: "Z.ai - Coding Plan",
      providerName: "Z.ai",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
        name: "Z.ai - Coding Plan",
      }),
      status: "purchased",
      planLevel: "Start",
      subscriptionExpireTime: new Date(2026, 5, 8, 23, 59).toISOString(),
      // 生产数据形态：purchased 快照必带 active 套餐详情，额度桶带 plan_id。
      subscriptionDetails: [
        {
          productId: "zcode-v3-start-plan",
          productName: "ZCode V3 Start Plan",
          purchaseTime: null,
          beginTime: null,
          billingCycle: "daily",
          renewTime: null,
          expireTime: new Date(2026, 5, 8, 23, 59).toISOString(),
        },
      ],
      quotaLimits: [
        {
          type: "ent_zcode_v3_glm_52",
          planId: "zcode-v3-start-plan",
          number: 3_000_000,
          remaining: 2_734_000,
          usageDetails: [{ modelCode: "glm-5.2", displayName: "GLM-5.2", usage: 0 }],
        },
      ],
      purchaseUrl: "https://z.ai/",
      statusActive: true,
    });

    expect(html).toContain("2,734,000 / 3,000,000");
    expect(html).not.toContain("2.7M");
    expect(html).not.toContain("Used 266K");
  });

  it("BigModel Start Plan 按余额接口顺序和 show_name 显示余额卡片", () => {
    const html = renderDetail({
      key: "coding-plan:account:bigmodel-start-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel- Coding Plan",
      providerName: "BigModel",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
        name: "BigModel- Coding Plan",
      }),
      status: "purchased",
      planLevel: "Start",
      subscriptionExpireTime: new Date(2026, 5, 8, 23, 59).toISOString(),
      subscriptionDetails: [
        {
          productId: "bigmodel-start",
          productName: "Start",
          purchaseTime: null,
          beginTime: null,
          billingCycle: "daily",
          renewTime: null,
          expireTime: new Date(2026, 5, 8, 23, 59).toISOString(),
        },
      ],
      quotaLimits: [
        {
          type: "ent_bigmodel_glm_52",
          planId: "bigmodel-start",
          number: 3_000_000,
          usage: 0,
          remaining: 3_000_000,
          usageDetails: [{ modelCode: "glm-5.2", displayName: "GLM-5.2", usage: 0 }],
        },
        {
          type: "ent_bigmodel_glm_5turbo",
          planId: "bigmodel-start",
          number: 1_000_000,
          usage: 0,
          remaining: 1_000_000,
          usageDetails: [
            {
              modelCode: "glm-5-turbo",
              displayName: "GLM-5-Turbo",
              usage: 0,
            },
          ],
        },
      ],
      purchaseUrl: "https://bigmodel.cn/",
      statusActive: true,
    });

    expect(html).toContain("GLM-5.2");
    expect(html).toContain("GLM-5-Turbo");
    expect(html.indexOf("GLM-5.2")).toBeLessThan(html.indexOf("GLM-5-Turbo"));
    expect(html).not.toContain("GLM-5Turbo");
  });

  it("Start Plan 兜底单卡不再渲染额度桶，余额未落定时仅保留查询占位", () => {
    // 服务端契约保证 balances 只属于 active plans：purchased 快照必有套餐详情，
    // 多卡路径必然可用。兜底分支（nav item 无套餐详情）不得把全量桶塞进单卡，
    // 否则违背 spec「无匹配 plan_id 的桶不得附着到任何卡片」。
    const quotaLimits = [
      {
        type: "ent_zcode_v3_glm_52",
        planId: "zcode-v3-start-plan",
        number: 3_000_000,
        remaining: 2_734_000,
        usageDetails: [{ modelCode: "glm-5.2", displayName: "GLM-5.2", usage: 0 }],
      },
    ];

    const settledHtml = renderToStaticMarkup(
      createElement(CodingPlanStatusPanel, {
        providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
        providerName: "Z.ai",
        status: "purchased",
        subscriptionDetails: [],
        quotaLimits,
      }),
    );
    expect(settledHtml).not.toContain("settings.modelProvider.startPlan.balance.title");
    expect(settledHtml).not.toContain("2,734,000 / 3,000,000");
    // 兜底分支的套餐卡本体仍在（标题 + 升级按钮），只是不再渲染额度桶。
    expect(settledHtml).toContain("settings.modelProvider.planCard.startPlan");
    expect(settledHtml).toContain("settings.modelProvider.codingPlan.upgrade");

    const checkingHtml = renderToStaticMarkup(
      createElement(CodingPlanStatusPanel, {
        providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
        providerName: "Z.ai",
        status: "purchased",
        viewState: {
          displayStatus: "purchased",
          actionStatus: "purchased",
          balanceStatus: "checking",
          loginLoading: false,
        },
        subscriptionDetails: [],
        quotaLimits,
      }),
    );
    expect(checkingHtml).toContain("settings.modelProvider.startPlan.balance.title");
    expect(checkingHtml).not.toContain("2,734,000 / 3,000,000");
  });

  it("Start 明确要求重新登录时不走网络重试，文案不作为操作判断", () => {
    const providerId = BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan;
    const provider = createProvider({ id: providerId });
    const html = renderDetail(
      {
        key: `coding-plan:${providerId}`,
        type: "codingPlan",
        presetId: providerId,
        oauthProviderId: BIGMODEL_PROVIDER_ID,
        label: "Start",
        providerName: "BigModel",
        provider,
        status: "unavailable",
        statusActive: false,
        accountLoginRequired: true,
        statusLabelId: "custom.login.message",
      },
      { onRetryCodingPlan: vi.fn() },
    );
    expect(html).not.toContain("common.retry");
    expect(html).toContain("chat.error.action.relogin");
    const noPlanHtml = renderDetail(
      {
        key: `coding-plan:${providerId}`,
        type: "codingPlan",
        presetId: providerId,
        oauthProviderId: BIGMODEL_PROVIDER_ID,
        label: "Start",
        providerName: "BigModel",
        provider,
        status: "notPurchased",
        statusActive: false,
      },
      { providerSettingsView: createProviderSettingsView(provider) },
    );
    expect(noPlanHtml).not.toContain("settings.modelProvider.accountProviderConfigMissing");
  });

  it("Start 无套餐卡不显示付费订阅按钮", () => {
    const html = renderToStaticMarkup(
      createElement(CodingPlanStatusPanel, {
        providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
        providerName: "BigModel",
        status: "notPurchased",
        startPlanPreviewVisible: false,
      }),
    );
    expect(html).toContain("settings.modelProvider.startPlan.status.noPlan");
    expect(html).not.toContain("settings.modelProvider.codingPlan.subscribe");
  });

  it("BigModel Start Plan 未登录且无远端 preview 时显示登录入口，不伪造套餐和模型", () => {
    const html = renderDetail({
      key: "coding-plan:account:bigmodel-start-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel- Coding Plan",
      providerName: "BigModel",
      provider: null,
      status: "disconnected",
      purchaseUrl: "https://bigmodel.cn/",
      statusActive: false,
    });

    expect(html).toContain("settings.modelProvider.planCard.startPlan");
    expect(html).not.toContain("settings.modelProvider.startPlan.quotaSectionTitle");
    expect(html).not.toContain("settings.modelProvider.startPlan.summaryTitle");
    expect(html).not.toContain("settings.modelProvider.startPlan.heroMetric");
    expect(html).not.toContain("settings.modelProvider.startPlan.summaryDescription");
    expect(html).not.toContain("settings.modelProvider.startPlan.eligibleNewUser");
    expect(html).toContain("settings.modelProvider.startPlan.status.loginRequired");
    expect(html).toContain("settings.modelProvider.startPlan.login");
    expect(html).not.toContain("settings.modelProvider.codingPlan.connect");
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.startPlanTitle");
    expect(html).not.toContain(
      "settings.modelProvider.codingPlan.purchaseBanner.startPlanDescription",
    );
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.personalTitle");
    expect(html).not.toContain(
      "settings.modelProvider.codingPlan.purchaseBanner.personalDescription",
    );
    expect(html).not.toContain("CN¥49.00+");
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.teamTitle");
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.teamDescription");
    expect(html).not.toContain("CN¥598.00+");
    expect(html).not.toContain("settings.modelProvider.codingPlan.description.disconnected");
    expect(html).not.toContain("settings.modelProvider.codingPlan.productsLoading");
    expect(html).not.toContain("settings.modelProvider.models");
    expect(html).not.toContain("settings.modelProvider.apiKey");
  });

  it.each(["disconnected", "notPurchased"] as const)(
    "BigModel Start Plan %s 详情隐藏远端体验套餐推广",
    (status) => {
      primeStartPlanPreviewCacheForTest({
        planId: "zcode-v3-start-plan",
        name: "ZCode V3 Start Plan",
        entitlements: [
          {
            grantUnits: 10_000_000,
            meter: "model_usage",
            period: "daily",
            showName: "GLM-5.2",
            unitType: "token",
          },
          {
            grantUnits: 10_000_000,
            meter: "model_usage",
            period: "daily",
            showName: "GLM-5.1",
            unitType: "token",
          },
          {
            grantUnits: 10_000_000,
            meter: "model_usage",
            period: "daily",
            showName: "GLM-5-Turbo",
            unitType: "token",
          },
        ],
      });

      const html = renderDetail({
        key: "coding-plan:account:bigmodel-start-plan",
        type: "codingPlan",
        presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
        oauthProviderId: BIGMODEL_PROVIDER_ID,
        label: "BigModel- Coding Plan",
        providerName: "BigModel",
        provider: null,
        status,
        purchaseUrl: "https://bigmodel.cn/",
        statusActive: false,
      });

      expect(html).not.toContain("ZCode V3 Start Plan");
      expect(html).not.toContain("30 Million");
      expect(html).not.toContain("tokens per day");
      expect(html).not.toContain("Daily quota · GLM-5.2 / GLM-5.1 / GLM-5-Turbo 10M each");
      expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.personalTitle");
      expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.teamTitle");
    },
  );

  it("个人套餐未连接时即使缓存有体验套餐也不显示推广或模型列表", () => {
    primeStartPlanPreviewCacheForTest({
      planId: "start-preview",
      name: "cached-start-banner",
      entitlements: [
        {
          grantUnits: 8_000_000,
          meter: "model_usage",
          period: "daily",
          showName: "GLM",
          unitType: "token",
        },
      ],
    });
    const providerId = BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan;
    const html = renderDetail({
      key: `coding-plan:${providerId}`,
      type: "codingPlan",
      presetId: providerId,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel",
      providerName: "BigModel",
      provider: createProvider({ id: providerId, models: ["disconnected-model"] }),
      status: "disconnected",
      statusActive: false,
    });
    expect(html).not.toContain("cached-start-banner");
    expect(html).not.toContain("disconnected-model");
    expect(html).not.toContain("settings.modelProvider.addModel");
    expect(html).toContain("settings.modelProvider.codingPlan.connect");
  });

  it("BigModel Start Plan 中文详情不显示推广额度", () => {
    intlMockState.locale = "zh-CN";
    primeStartPlanPreviewCacheForTest({
      planId: "zcode-v3-start-plan",
      name: "ZCode V3 Start Plan",
      entitlements: [
        {
          grantUnits: 5_000_000,
          meter: "model_usage",
          period: "daily",
          showName: "GLM-5.2",
          unitType: "token",
        },
      ],
    });

    const html = renderDetail({
      key: "coding-plan:account:bigmodel-start-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel- Coding Plan",
      providerName: "BigModel",
      provider: null,
      status: "disconnected",
      purchaseUrl: "https://bigmodel.cn/",
      statusActive: false,
    });

    expect(html).not.toContain("ZCode V3 Start Plan");
    expect(html).not.toContain("500万");
    expect(html).not.toContain("tokens/日");
    expect(html).not.toContain("每日额度 · GLM-5.2 500万");
    expect(html).not.toContain("¥49.00");
    expect(html).not.toContain("¥598.00");
    expect(html).not.toContain("人民币 起");
  });

  it("BigModel Start Plan 中文详情保留标题且不显示体验推广", () => {
    intlMockState.locale = "zh-CN";
    primeStartPlanPreviewCacheForTest({
      planId: "zcode-v3-start-plan",
      name: "Start Plan",
      entitlements: [
        {
          grantUnits: 5_000_000,
          meter: "model_usage",
          period: "daily",
          showName: "GLM-5.2",
          unitType: "token",
        },
      ],
    });

    const html = renderDetail({
      key: "coding-plan:account:bigmodel-start-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel- Coding Plan",
      providerName: "BigModel",
      provider: null,
      status: "disconnected",
      purchaseUrl: "https://bigmodel.cn/",
      statusActive: false,
    });

    expect(html).not.toContain(">体验套餐<");
    expect(html).toContain(">Start Plan<");
  });

  it("Coding Plan 权益误落到 Start provider 分支时显示权益名", () => {
    expect(
      resolveCodingPlanStatusCardTitle({
        isPurchased: true,
        isStartPlanProvider: true,
        rawPlanLevel: "GLM Coding Pro",
        displayPlanLevel: "GLM Coding Pro",
        startPlanTitle: "Start Plan",
        codingPlanTitle: "Coding Plan",
      }),
    ).toBe("GLM Coding Pro");
  });

  it("Start Plan 校验未知不会误判为未连接", () => {
    expect(
      resolveCodingPlanEntitlementState({
        providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
        accountEntitled: false,
        accountAvailability: "unknown",
        modelProvidersLoading: false,
      }).status,
    ).toBe("unavailable");
  });

  it("Start Plan 刷新失败保留套餐并显示失败和重试", () => {
    const html = renderToStaticMarkup(
      createElement(CodingPlanStatusPanel, {
        providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
        providerName: "BigModel",
        status: "purchased",
        planLevel: "Start",
        statusLabelId: "settings.modelProvider.codingPlan.status.unavailable",
        onRetry: vi.fn(),
      }),
    );
    expect(html).toContain("settings.modelProvider.planCard.startPlan");
    expect(html).toContain("settings.modelProvider.codingPlan.status.unavailable");
    expect(html).toContain("common.retry");
  });

  it("Start Plan 获取失败也保留自身标题", () => {
    expect(
      resolveCodingPlanStatusCardTitle({
        isPurchased: false,
        isUnavailable: true,
        isStartPlanProvider: true,
        rawPlanLevel: "",
        displayPlanLevel: "",
        startPlanTitle: "Start Plan",
        codingPlanTitle: "Coding Plan",
      }),
    ).toBe("Start Plan");
  });

  it("Start Plan 权益继续显示 Start Plan", () => {
    expect(
      resolveCodingPlanStatusCardTitle({
        isPurchased: true,
        isStartPlanProvider: true,
        rawPlanLevel: "ZCode V3 Start Plan",
        displayPlanLevel: "ZCode V3 Start Plan",
        startPlanTitle: "Start Plan",
        codingPlanTitle: "Coding Plan",
      }),
    ).toBe("Start Plan");
  });

  it("Team Plan 不可用时状态卡标题保留团队名", () => {
    expect(
      resolveCodingPlanStatusCardTitle({
        isPurchased: false,
        isStartPlanProvider: false,
        inactivePlanTitle: "Org A",
        rawPlanLevel: "Org A",
        displayPlanLevel: "ORG A",
        startPlanTitle: "Start Plan",
        codingPlanTitle: "Coding Plan",
      }),
    ).toBe("Org A");
  });

  it("完整活动配置在升级入口旁显示说明入口和远端徽标文案", () => {
    const html = renderToStaticMarkup(
      createElement(CodingPlanUpgradeAction, {
        loginLoading: false,
        upgradePlansVisible: false,
        codingPlanPurchaseTokenAuthenticated: true,
        billingDiscountActive: true,
        billingDiscountConfig: {
          "en-US": {
            badgeBody: "150% Quota",
            infoTitle: "Entitlement Rules",
            infoBody: "Remote campaign rules",
          },
        },
        onUpgradePlansVisibleChange: vi.fn(),
      }),
    );

    expect(html).toContain("lucide-info");
    expect(html).toContain('data-slot="dialog-trigger"');
    expect(html).toContain("150% Quota");
  });

  it("Coding Plan 活动 banner 右侧显示说明入口", () => {
    const html = renderToStaticMarkup(
      createElement(CodingPlanBillingDiscountBanner, {
        config: {
          "en-US": {
            cardTitle: "Limited-time 150% Quota Campaign",
            cardBody: "Upgrade your Coding Plan to get 150% quota during the campaign period",
            badgeBody: "150% Quota",
            infoTitle: "Entitlement Rules",
            infoBody: "Remote campaign rules",
          },
        },
      }),
    );

    expect(html).toContain("Limited-time 150% Quota Campaign");
    expect(html).toContain("150% Quota");
    expect(html).toContain("lucide-info");
    expect(html).toContain("settings.modelProvider.codingPlan.billingDiscountInfo.open");
  });

  it("完整活动配置为徽标提供说明入口", () => {
    const html = renderToStaticMarkup(
      createElement(CodingPlanBillingDiscountBadge, {
        config: {
          "en-US": {
            badgeBody: "150% Quota",
            infoTitle: "Entitlement Rules",
            infoBody: "Remote campaign rules",
          },
        },
      }),
    );

    expect(html).toContain("150% Quota");
    expect(html).toContain("lucide-info");
  });

  it("远端未下发完整活动说明时不显示 Info 入口且不使用本地兜底", () => {
    const html = renderToStaticMarkup(
      createElement(CodingPlanBillingDiscountBadge, {
        config: {
          "en-US": {
            badgeBody: "150% Quota",
            infoTitle: "Entitlement Rules",
          },
        },
      }),
    );

    expect(html).toContain("150% Quota");
    expect(html).not.toContain("lucide-info");
    expect(html).not.toContain("settings.modelProvider.codingPlan.billingDiscountInfo.title");
  });

  it("Coding Plan 活动说明标题与 Markdown 正文来自远端配置", () => {
    const copy = resolveCodingPlanBillingDiscountCopy(
      {
        "zh-CN": {
          infoTitle: "远端权益规则",
          infoBody: "- 远端规则一\n- 远端规则二",
        },
      },
      "zh-CN",
    );

    expect(copy.infoTitle).toBe("远端权益规则");
    expect(copy.infoBody).toBe("- 远端规则一\n- 远端规则二");
  });

  it("按当前 locale 读取服务端下发的 150% 活动文案", () => {
    expect(
      resolveCodingPlanBillingDiscountCopy(
        {
          "zh-CN": {
            cardTitle: "限时 150% 配额活动",
            cardBody: "升级 Coding Plan，可在活动期内获得150% 配额",
            badgeBody: "150% 配额",
            infoTitle: "权益规则说明",
            infoBody: "远端规则正文",
          },
          "en-US": {
            cardTitle: "Limited-time 150% Quota Campaign",
            cardBody: "Upgrade your Coding Plan to get 150% quota during the campaign period",
            badgeBody: "150% Quota",
          },
        },
        "zh-CN",
      ),
    ).toEqual({
      cardTitle: "限时 150% 配额活动",
      cardBody: "升级 Coding Plan，可在活动期内获得150% 配额",
      badgeBody: "150% 配额",
      infoTitle: "权益规则说明",
      infoBody: "远端规则正文",
    });
  });

  it("服务端 150% 活动文案为空时不返回硬编码兜底", () => {
    expect(
      resolveCodingPlanBillingDiscountCopy(
        {
          "en-US": {
            cardTitle: "",
            cardBody: "   ",
            infoTitle: "",
            infoBody: " ",
          },
        },
        "en-US",
      ),
    ).toEqual({
      badgeBody: undefined,
      cardTitle: undefined,
      cardBody: undefined,
      infoTitle: undefined,
      infoBody: undefined,
    });
    expect(resolveCodingPlanBillingDiscountCopy({}, "zh-CN")).toEqual({});
  });

  it("活动配置未透传到 UI 时不渲染 150% 活动入口", () => {
    const badgeHtml = renderToStaticMarkup(
      createElement(CodingPlanBillingDiscountBadge, {
        config: undefined,
      }),
    );
    const bannerHtml = renderToStaticMarkup(
      createElement(CodingPlanBillingDiscountBanner, {
        config: undefined,
      }),
    );

    expect(badgeHtml).toBe("");
    expect(bannerHtml).toBe("");
  });

  it("个人和团队 status card 名称后展示 150% 配额徽标", () => {
    primeCodingPlanBillingDiscountCacheForTest({
      "en-US": {
        badgeBody: "150% Quota",
      },
    });

    const personalHtml = renderToStaticMarkup(
      createElement(CodingPlanStatusPanel, {
        providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
        providerName: "Z.ai",
        status: "purchased",
        planLevel: "Pro",
        quotaLimits: [
          {
            type: "TOKENS_LIMIT",
            unit: 3,
            number: 5,
            usage: 100_000,
            remaining: 900_000,
            percentage: 10,
            usageDetails: [],
          },
        ],
      }),
    );
    const teamHtml = renderToStaticMarkup(
      createElement(CodingPlanStatusPanel, {
        providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
        providerName: "BigModel",
        status: "purchased",
        planLevel: "Team A",
        quotaLimits: [
          {
            type: "TOKENS_LIMIT",
            unit: 3,
            number: 5,
            usage: 100_000,
            remaining: 900_000,
            percentage: 10,
            usageDetails: [],
          },
        ],
      }),
    );

    expect(personalHtml).toContain("Pro");
    expect(personalHtml).toContain("150% Quota");
    expect(teamHtml).toContain("TEAM A");
    expect(teamHtml).toContain("150% Quota");
  });

  it.each([
    BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
    BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
  ])("%s 获取失败提供明确的重新登录操作", (providerId) => {
    const html = renderToStaticMarkup(
      createElement(CodingPlanStatusPanel, {
        providerId,
        providerName: "Provider",
        status: "unavailable",
        loginActionVisible: true,
        loginActionPlacement: "trailing",
        onLogin: vi.fn(),
        reloginOnFailure: true,
      }),
    );
    expect(html).toContain("login.expired.action");
    expect(html).not.toContain("settings.modelProvider.codingPlan.connect");
  });

  it("Team Plan 未分配时在状态行展示管理员提示", () => {
    const html = renderToStaticMarkup(
      createElement(CodingPlanStatusPanel, {
        providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
        providerName: "BigModel",
        status: "unavailable",
        planLevel: "Org A",
        inactivePlanTitle: "Org A",
        statusLabelId: "settings.modelProvider.codingPlan.status.teamUnavailable",
        teamPlanAvailabilityReason: "not-allocated",
        loginActionVisible: true,
        onLogin: vi.fn(),
      }),
    );

    expect(html).toContain("Org A");
    expect(html).toContain("settings.modelProvider.codingPlan.status.teamUnavailable");
    expect(html).toContain("text-warning");
    expect(html).not.toContain("settings.modelProvider.codingPlan.connect");
  });

  it("Team Plan 检查中不叠加旧错误图标和文案", () => {
    const html = renderToStaticMarkup(
      createElement(CodingPlanStatusPanel, {
        providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
        providerName: "BigModel",
        status: "unavailable",
        viewState: resolveCodingPlanStatusPanelViewState({
          status: "unavailable",
          loginPending: true,
        }),
        statusLabelId: "settings.modelProvider.codingPlan.status.teamUnavailable",
        statusMessage: "旧团队授权错误",
        teamPlanAvailabilityReason: "credential-unavailable",
      }),
    );
    expect(html).toContain("lucide-loader-circle");
    expect(html).toContain("settings.modelProvider.codingPlan.status.checking");
    expect(html).not.toContain("旧团队授权错误");
    expect(html).not.toContain("settings.modelProvider.codingPlan.status.teamUnavailable");
    expect(html).not.toContain("text-warning");
    expect(html).not.toMatch(/animate-spin[^]*lucide-info/);
  });

  it("Team Plan API Key 预热返回服务端 message 时状态行优先显示该 message", () => {
    const html = renderToStaticMarkup(
      createElement(CodingPlanStatusPanel, {
        providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
        providerName: "BigModel",
        status: "unavailable",
        planLevel: "GY的组织",
        inactivePlanTitle: "GY的组织",
        statusLabelId: "settings.modelProvider.codingPlan.status.teamUnavailable",
        statusMessage: "您当前暂无有效的团队套餐授权记录，无法创建API Key",
        teamPlanAvailabilityReason: "credential-unavailable",
        loginActionVisible: true,
        onLogin: vi.fn(),
      }),
    );

    expect(html).toContain("GY的组织");
    expect(html).toContain("您当前暂无有效的团队套餐授权记录，无法创建API Key");
    expect(html).not.toContain("settings.modelProvider.codingPlan.status.teamUnavailable");
    expect(html).toContain("text-warning");
  });

  it("Z.ai Start Plan 展开升级套餐时保留余额卡片", () => {
    const html = renderToStaticMarkup(
      createElement(CodingPlanStatusPanel, {
        providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
        providerName: "Z.ai",
        status: "purchased",
        planLevel: "Start",
        subscriptionExpireTime: new Date(2026, 5, 8, 23, 59).toISOString(),
        // 生产数据形态：purchased 快照必带 active 套餐详情，额度桶带 plan_id。
        subscriptionDetails: [
          {
            productId: "zcode-v3-start-plan",
            productName: "ZCode V3 Start Plan",
            purchaseTime: null,
            beginTime: null,
            billingCycle: "daily",
            renewTime: null,
            expireTime: new Date(2026, 5, 8, 23, 59).toISOString(),
          },
        ],
        quotaLimits: [
          {
            type: "ent_zcode_v3_glm_52",
            planId: "zcode-v3-start-plan",
            number: 3_000_000,
            usage: 500_000,
            remaining: 2_500_000,
            usageDetails: [{ modelCode: "glm-5.2", usage: 500_000 }],
          },
        ],
        upgradePlansVisible: true,
      }),
    );

    expect(html).toContain("settings.modelProvider.startPlan.balance.title");
  });

  it("Z.ai Coding Plan 展开升级套餐时保留剩余额度卡片", () => {
    const html = renderToStaticMarkup(
      createElement(CodingPlanStatusPanel, {
        providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
        providerName: "Z.ai",
        status: "purchased",
        planLevel: "Pro",
        quotaLimits: [
          {
            type: "TOKENS_LIMIT",
            unit: 3,
            number: 5,
            usage: 100_000,
            remaining: 900_000,
            percentage: 10,
            usageDetails: [],
          },
          {
            type: "TOKENS_LIMIT",
            unit: 6,
            usage: 200_000,
            remaining: 800_000,
            percentage: 20,
            usageDetails: [],
          },
          {
            type: "TIME_LIMIT",
            unit: 5,
            number: 1,
            usage: 1_000,
            remaining: 9_000,
            percentage: 10,
            usageDetails: [],
          },
        ],
        upgradePlansVisible: true,
      }),
    );

    expect(html).toContain("settings.usage.quotaTitle");
    expect(html.indexOf("settings.usage.quotaTitle")).toBeLessThan(
      html.indexOf("settings.usage.entitlementFiveHourUsage"),
    );
    expect(html).toContain("settings.usage.entitlementFiveHourUsage");
    expect(html).toContain("settings.usage.entitlementWeeklyUsage");
    expect(html).toContain("settings.usage.entitlementMonthlyMcpUsage");
  });

  it("BigModel Coding Plan 已购买时在状态行显示管理和解绑操作", () => {
    const currentYear = new Date().getUTCFullYear();
    const html = renderDetail({
      key: "coding-plan:account:bigmodel-individual-coding-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel - Coding Plan",
      providerName: "BigModel",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      }),
      status: "purchased",
      planLevel: "pro",
      subscriptionRenewTime: `${currentYear}-07-10T00:00:00.000Z`,
      purchaseUrl: "https://bigmodel.cn/",
      statusActive: true,
    });

    const planIndex = html.indexOf(">PRO<");
    const renewIndex = html.indexOf("settings.modelProvider.codingPlan.renewsAt");
    const manageIndex = html.indexOf("settings.modelProvider.codingPlan.manage");
    const unlinkIndex = html.indexOf("settings.modelProvider.codingPlan.disconnect");

    expect(planIndex).toBeGreaterThan(-1);
    expect(renewIndex).toBeGreaterThan(planIndex);
    expect(manageIndex).toBeGreaterThan(renewIndex);
    expect(unlinkIndex).toBeGreaterThan(manageIndex);
  });

  it("BigModel Coding Plan 未登录且无远端 preview 时隐藏 Start 套餐入口", () => {
    const html = renderDetail({
      key: "coding-plan:account:bigmodel-individual-coding-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel - Coding Plan",
      providerName: "BigModel",
      provider: null,
      status: "disconnected",
      purchaseUrl: "https://bigmodel.cn/",
      statusActive: false,
    });

    expect(html).toContain("settings.modelProvider.planCard.codingPlan");
    expect(html).toContain("settings.modelProvider.codingPlan.status.disconnected");
    expect(html).toContain("settings.modelProvider.codingPlan.connect");
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.startPlanTitle");
    expect(html).not.toContain(
      "settings.modelProvider.codingPlan.purchaseBanner.startPlanDescription",
    );
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.personalTitle");
    expect(html).not.toContain(
      "settings.modelProvider.codingPlan.purchaseBanner.personalDescription",
    );
    expect(html).not.toContain("CN¥49.00+");
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.teamTitle");
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.teamDescription");
    expect(html).not.toContain("CN¥598.00+");
    expect(html).not.toContain("settings.modelProvider.startPlan.quotaSectionTitle");
    expect(html).not.toContain("settings.modelProvider.codingPlan.productsLoading");
    expect(html).not.toContain("settings.modelProvider.codingPlan.bigmodel.plan.lite.name");
    expect(html).not.toContain("settings.modelProvider.models");
    expect(html).not.toContain("settings.modelProvider.apiKey");
  });

  it("BigModel 未登录点击个人/团队套餐时先登录，已登录未订阅才打开购买", () => {
    expect(resolvePurchaseChoiceSelectionIntent("disconnected")).toBe("login");
    expect(resolvePurchaseChoiceSelectionIntent("notPurchased")).toBe("purchase");
    expect(resolvePurchaseChoiceSelectionIntent("purchased")).toBe("purchase");
  });

  it("BigModel Coding Plan 账号未注册时在查询行显示注册链接", () => {
    const html = renderDetail(
      {
        key: "coding-plan:account:bigmodel-individual-coding-plan",
        type: "codingPlan",
        presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
        oauthProviderId: BIGMODEL_PROVIDER_ID,
        label: "BigModel - Coding Plan",
        providerName: "本地化后的智谱账号",
        provider: null,
        status: "disconnected",
        purchaseUrl: "https://bigmodel.cn/",
        statusActive: false,
      },
      {
        presetSubscriptionProviderId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
        codingPlanAuthError: "BigModel 账号未注册，请先完成 BigModel 注册后再登录。",
      },
    );

    expect(html).toContain("settings.modelProvider.codingPlan.bigmodel.unregisteredHint");
    expect(html).toContain("settings.modelProvider.codingPlan.bigmodel.registerAction");
    expect(html).not.toContain("settings.modelProvider.codingPlan.status.checking");
  });

  it("BigModel Coding Plan 已连接时显示解绑入口", () => {
    const html = renderDetail({
      key: "coding-plan:account:bigmodel-individual-coding-plan",
      type: "codingPlan",
      presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      oauthProviderId: BIGMODEL_PROVIDER_ID,
      label: "BigModel - Coding Plan",
      providerName: "BigModel",
      provider: createProvider({
        id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
        apiKey: "",
        models: [],
      }),
      status: "notPurchased",
      purchaseUrl: "https://bigmodel.cn/",
      statusActive: false,
    });

    expect(html).toContain("settings.modelProvider.codingPlan.status.notPurchased");
    expect(html).toContain("settings.modelProvider.codingPlan.disconnect");
    expect(html).toMatch(
      /settings\.modelProvider\.codingPlan\.status\.notPurchased[\s\S]*·[\s\S]*settings\.modelProvider\.codingPlan\.disconnect/,
    );
    expect(html).not.toContain("settings.modelProvider.codingPlan.upgrade");
    expect(html).toContain("settings.modelProvider.codingPlan.description.notPurchased");
    expect(html).not.toContain("settings.modelProvider.codingPlan.productsLoading");
    expect(html).not.toContain("settings.modelProvider.models");
    expect(html).not.toContain("settings.modelProvider.apiKey");
  });

  it("BigModel 已登录但无 Start/Coding 权益时等待团队套餐档位加载完成", () => {
    const html = renderDetail(
      {
        key: "coding-plan:account:bigmodel-individual-coding-plan",
        type: "codingPlan",
        presetId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
        oauthProviderId: BIGMODEL_PROVIDER_ID,
        label: "BigModel - Coding Plan",
        providerName: "BigModel",
        provider: createProvider({
          id: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
          apiKey: "",
          models: [],
        }),
        status: "notPurchased",
        purchaseUrl: "https://bigmodel.cn/",
        statusActive: false,
      },
      {
        codingPlanPurchaseTokenAuthenticatedByProviderId: {
          [BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan]: true,
        },
      },
    );

    expect(html).toContain("settings.modelProvider.codingPlan.status.notPurchased");
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.personalTitle");
    expect(html).not.toContain(
      "settings.modelProvider.codingPlan.purchaseBanner.personalDescription",
    );
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.teamTitle");
    expect(html).not.toContain("settings.modelProvider.codingPlan.purchaseBanner.teamDescription");
    expect(html).not.toContain("settings.modelProvider.startPlan.quotaSectionTitle");
    expect(html).not.toContain("settings.modelProvider.models");
    expect(html).not.toContain("settings.modelProvider.apiKey");
  });

  it.each([false, true])("个人未开通时团队 subscribed=%s 仍展示团队 banner", (subscribed) => {
    const spy = vi
      .spyOn(enterpriseProductsHook, "useEnterpriseCodingPlanProducts")
      .mockReturnValue({
        loading: false,
        error: null,
        refresh: vi.fn(),
        snapshot: {
          authenticated: true,
          staticProductIds: ["team-pro"],
          raw: { productList: [] },
          productList: [
            {
              productId: "team-pro",
              productName: "Pro",
              productEquityList: [],
              priceCurrency: "CNY",
              payAmount: 598,
              tier: "PRO",
              subscribeMode: "CONTINUOUS",
              subscribePeriod: "YEARLY",
              purchaseMethodName: "Auto renew",
              subscribed,
              enterpriseProduct: {
                productId: "team-pro",
                tier: "PRO",
                subscribeMode: "CONTINUOUS",
                subscribePeriod: "YEARLY",
                payAmount: 598,
              },
            },
          ],
        },
      });
    try {
      const providerId = BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan;
      const html = renderDetail(
        {
          key: `coding-plan:${providerId}`,
          type: "codingPlan",
          presetId: providerId,
          oauthProviderId: BIGMODEL_PROVIDER_ID,
          label: "BigModel",
          providerName: "BigModel",
          provider: createProvider({ id: providerId }),
          status: "notPurchased",
          statusActive: false,
        },
        { codingPlanPurchaseTokenAuthenticatedByProviderId: { [providerId]: true } },
      );
      expect(html).toContain("settings.modelProvider.codingPlan.purchaseBanner.teamDescription");
      expect(html).toContain("598.00");
      expect(html).not.toContain("settings.modelProvider.models");
      const startId = BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan;
      const startItem: ModelProviderNavItem = {
        key: "start-expired",
        type: "codingPlan",
        presetId: startId,
        oauthProviderId: BIGMODEL_PROVIDER_ID,
        label: "Start Plan",
        providerName: "BigModel",
        provider: createProvider({ id: startId }),
        status: "notPurchased",
        statusActive: false,
        statusLabelId: "settings.modelProvider.startPlan.status.expired",
      };
      for (const type of ["codingPlan", "teamPlan"] as const) {
        for (const available of [false, true]) {
          for (const status of ["purchased", "unavailable", "checking"] as const) {
            const paidItem: ModelProviderNavItem = {
              key: "paid",
              type,
              presetId: providerId,
              oauthProviderId: BIGMODEL_PROVIDER_ID,
              label: "Paid",
              providerName: "BigModel",
              provider: null,
              status,
              statusActive: false,
              ...(type === "teamPlan"
                ? {
                    teamPlanName: "Team",
                    organizationId: "org",
                    projectId: "project",
                    currentProductId: "product",
                  }
                : {}),
            };
            const paidView = createProviderSettingsView(createProvider({ id: providerId }));
            paidView.providers[0]!.accountState = {
              availability: available ? "available" : "unavailable",
              entitled: available,
              current: true,
            };
            const startHtml = renderDetail(startItem, {
              navigationItems: [startItem, paidItem],
              providerSettingsView: paidView,
              codingPlanPurchaseTokenAuthenticatedByProviderId: { [startId]: true },
            });
            expect(startHtml).toContain("settings.modelProvider.startPlan.status.expired");
            expect(
              startHtml.includes(
                "settings.modelProvider.codingPlan.purchaseBanner.teamDescription",
              ),
            ).toBe(!available);
            const activeStartHtml = renderDetail(
              { ...startItem, status: "purchased", statusLabelId: undefined },
              {
                navigationItems: [startItem, paidItem],
                providerSettingsView: paidView,
              },
            );
            expect(activeStartHtml.includes("settings.modelProvider.codingPlan.upgrade")).toBe(
              !available,
            );
          }
        }
      }
    } finally {
      spy.mockRestore();
    }
  });

  it("模型供应商手动刷新会同步 Team Plan 产品快照", async () => {
    const calls: string[] = [];

    await refreshModelProviderSection({
      refresh: async () => {
        calls.push("providers");
      },
      refreshTeamPlanProducts: async () => {
        calls.push("team-products");
      },
    });

    expect(calls.sort()).toEqual(["providers", "team-products"]);
  });

  it("连接方式切换只刷新 provider，不强制刷新套餐权益", async () => {
    const calls: string[] = [];

    await refreshProviderPanelAfterAuthChange({
      refreshModelProviders: async () => {
        calls.push("providers");
      },
      refreshCodingPlanEntitlements: async () => {
        calls.push("entitlements");
      },
      refreshTeamPlanProducts: async () => {
        calls.push("team-products");
      },
      refreshCodingPlanProducts: () => {
        calls.push("products");
      },
      refreshPurchaseTokenState: async () => {
        calls.push("token");
      },
      refreshPlanSnapshots: false,
    });

    expect(calls).toEqual(["token", "providers", "products"]);
  });

  it("全局购买弹窗完成 Team Plan 购买后刷新团队产品快照", async () => {
    const calls: string[] = [];

    await refreshCodingPlanUpgradeCompletion({
      providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      productsProviderId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      refreshCodingPlanEntitlements: async () => {
        calls.push("entitlements");
      },
      refreshProviderState: async () => {
        calls.push("registry");
      },
      refreshTeamPlanProducts: async () => {
        calls.push("team-products");
      },
    });

    expect(calls).toContain("team-products");
    // 改造原因：购买流程迁到 webview 后，App 不再维护 purchase token 状态
    // （oauth:active_provider 那套登录态由官网页内部处理），刷新列表里不再有 "token"。
    expect(calls.sort()).toEqual(["entitlements", "registry", "team-products"]);
  });

  it("新 Provider Runtime 购买完成后只刷新 Account Source", async () => {
    const calls: string[] = [];

    await refreshCodingPlanUpgradeCompletion({
      providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      productsProviderId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      refreshCodingPlanEntitlements: async () => {
        calls.push("entitlements");
      },
      refreshProviderState: async () => {
        calls.push("registry");
      },
    });

    expect(calls.sort()).toEqual(["entitlements", "registry"]);
  });

  it("webview 请求购买完成后先关闭升级弹窗再刷新当前 provider", async () => {
    const calls: string[] = [];

    await closeAndRefreshCodingPlanUpgradeFromWebview({
      onClose: () => {
        calls.push("close");
      },
      refresh: async () => {
        calls.push("refresh:start");
        await Promise.resolve();
        calls.push("refresh:end");
      },
    });

    expect(calls).toEqual(["close", "refresh:start", "refresh:end"]);
  });
});
