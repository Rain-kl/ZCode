// ============================================================
// WebSearch Tool
// ============================================================

import {
  CoreErrorType,
  WEBSEARCH_PROVIDER_NATIVE_SPEC,
  WEBSEARCH_TOOL_CONTRACT,
  WebSearchInputJsonSchema,
  WebSearchInputSchema,
  WebSearchOutputJsonSchema,
  WebSearchOutputSchema,
  createCoreError,
  runWithModelInvocationContext,
  toWebSearchProviderNativeArgs,
  type ModelStreamEvent,
  type ModelTextResult,
  type ModelToolCall,
  type ModelUsage,
  type ModelToolContract,
  type WebSearchInput,
  type WebSearchOutput,
} from "@zcode/contracts";
import type { ToolEntry, ToolExecutionContext, ToolHandler } from "../types.js";
import { auxiliaryModelOptions } from "../../model/auxiliary-model-options.js";
import { buildWebSearchOutput, formatWebSearchModelContent } from "./websearch-results.js";
import { webSearchTraceFromContext } from "./websearch-support.js";
// FORK-BEGIN(search-providers): 引入渠道链与路由，使 WebSearch 支持服务端与外部多渠道降级；见 FEATURES.md 的 search-providers 条目
import type { SearchChannelRequest } from "../../fork/search-providers/channel.js";
import {
  buildSearchChannelChain,
  createServerSearchChannel,
} from "../../fork/search-providers/channels.js";
import { runSearchChannels } from "../../fork/search-providers/router.js";
// FORK-END(search-providers)

// FORK(search-providers): 导出供渠道测试断言工具名未变；见 FEATURES.md 的 search-providers 条目
export const WEBSEARCH_TOOL_NAME = "WebSearch";
const PROVIDER_WEBSEARCH_TOOL_NAME = "web_search";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_USES = 8;

const WEBSEARCH_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

// FORK-BEGIN(search-providers): 导出供测试/检查，且去掉 US-only（已接入多渠道，不再仅限服务端 US-only）；见 FEATURES.md 的 search-providers 条目
export function buildWebSearchProviderDescription(now: Date = new Date()): string {
  const currentMonth = `${WEBSEARCH_MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
  return [
    "Search the web. Returns result blocks with titles and URLs.",
    "",
    `- The current month is ${currentMonth} — use this when searching for recent information.`,
    "- `allowed_domains` / `blocked_domains` filter results.",
    '- After answering from results, end with a "Sources:" list of the URLs you used as markdown links.',
  ].join("\n");
}
// FORK-END(search-providers)

// FORK-BEGIN(search-providers): 将直接调用 provider-native 改为接入渠道链（服务端搜索为第一渠道，后接配置的外部渠道）；见 FEATURES.md 的 search-providers 条目
const webSearchHandler: ToolHandler<WebSearchInput, WebSearchOutput> = async (input, context) => {
  const startedAt = Date.now();
  const parsed = WebSearchInputSchema.parse(input);

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
};

async function executeProviderNativeSearch(
  input: WebSearchInput,
  context: ToolExecutionContext,
  request: SearchChannelRequest,
): Promise<ModelTextResult> {
  const model = context.model;

  if (!model) {
    throw createCoreError(CoreErrorType.ConfigurationError, "Model is required for WebSearch", {
      context: { toolCallId: context.toolCallId, toolName: WEBSEARCH_TOOL_NAME },
      recoverable: false,
    });
  }

  if (!model.properties.supportsNativeWebSearch) {
    throw createCoreError(
      CoreErrorType.ConfigurationError,
      "Current model does not support native WebSearch",
      {
        context: { toolCallId: context.toolCallId, toolName: WEBSEARCH_TOOL_NAME },
        recoverable: true,
      },
    );
  }

  const streamRequest: Parameters<typeof model.streamText>[0] = {
    messages: [
      {
        role: "system",
        content: "You are an assistant for performing a web search tool use.",
      },
      {
        role: "user",
        content: `Perform a web search for the query: ${input.query}`,
      },
    ],
    tools: [createProviderNativeWebSearchContract(input)],
    // BigModel 的 Anthropic 兼容端点会拒绝 named forced web_search tool_choice（1210）。
    // 这里保持自动选择，依靠单工具请求和 prompt 触发 provider-native 搜索。
    options: {
      ...auxiliaryModelOptions(model),
      maxOutputTokens: Math.min(4096, model.optionSpecs.maxOutputTokens.max),
    },
    abortSignal: request.signal ?? context.abortSignal,
  };

  // BigModel Anthropic 兼容端点的非流式 JSON 会把 provider 内部
  // web_search 结果返回为 assistant-side 裸 tool_result，AI SDK 会在 schema
  // 校验阶段抛 Invalid JSON response。走流式可复用现有 SSE compat。
  return await collectWebSearchStreamResult({
    events: runWithModelInvocationContext(
      {
        metadata: {
          traceId: context.traceId,
          sessionId: context.sessionId,
          turnId: context.turnId,
          toolCallId: context.toolCallId,
          toolName: WEBSEARCH_TOOL_NAME,
          querySource: "web_search_tool",
        },
        modelRequestSessionType: "other",
        modelCall: { operation: "web_search" },
        // statusSink 不在这里设：执行器交出的 context.model 已带默认会话事件出口。
        traceContext: webSearchTraceFromContext(context),
      },
      () => model.streamText(streamRequest),
    ),
  });
}
// FORK-END(search-providers)

export const webSearchToolEntry: ToolEntry = {
  ...WEBSEARCH_TOOL_CONTRACT,
  providerNative: undefined,
  metadata: {
    name: WEBSEARCH_TOOL_NAME,
    // 写死月份会导致模型可见的 WebSearch 描述过期。
    // 每次读取时重新生成，避免长驻进程跨月后继续投递旧月份。
    get description() {
      return buildWebSearchProviderDescription();
    },
    readOnly: true,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: 20_000,
    sideEffectScope: "network",
    riskLevel: "low",
    needsApproval: false,
  },
  handler: webSearchHandler as ToolHandler,
  formatModelContent: formatWebSearchModelContent,
  inputSchema: WebSearchInputJsonSchema,
  outputSchema: WebSearchOutputJsonSchema,
  runtimeInputSchema: WebSearchInputSchema,
  runtimeOutputSchema: WebSearchOutputSchema,
};

function createProviderNativeWebSearchContract(input: WebSearchInput): ModelToolContract {
  return {
    name: PROVIDER_WEBSEARCH_TOOL_NAME,
    capability: "web_search",
    description: "Provider-native web search used internally by the WebSearch tool",
    executionMode: "providerNative",
    providerNative: {
      ...WEBSEARCH_PROVIDER_NATIVE_SPEC,
      args: toWebSearchProviderNativeArgs(input, {
        maxUses: DEFAULT_MAX_USES,
      }),
    },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
    outputSchema: { type: "object" },
  };
}

async function collectWebSearchStreamResult(input: {
  events: AsyncIterable<ModelStreamEvent>;
}): Promise<ModelTextResult> {
  let text = "";
  let finishReason = "unknown";
  let providerMetadata: Record<string, unknown> | undefined;
  let usage: ModelUsage = {};
  const toolCalls: ModelToolCall[] = [];

  for await (const event of input.events) {
    switch (event.type) {
      case "text_delta":
        text += event.text;
        break;
      case "tool_call":
        toolCalls.push(event.toolCall);
        break;
      case "finish":
        finishReason = event.finishReason;
        usage = event.usage;
        providerMetadata = event.providerMetadata;
        break;
      case "error":
        throw normalizeStreamError(event.error);
    }
  }

  return {
    finishReason,
    providerMetadata,
    text,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage,
  };
}

function normalizeStreamError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return createCoreError(CoreErrorType.ModelError, "WebSearch stream failed", {
    context: { error },
    recoverable: true,
  });
}
