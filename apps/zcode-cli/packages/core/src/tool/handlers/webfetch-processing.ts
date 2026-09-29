import {
  CoreErrorType,
  createCoreError,
  runWithModelInvocationContext,
  type ModelInputMessage,
  type WebFetchInput,
} from "@zcode/contracts";
import type { ToolExecutionContext } from "../types.js";
import { auxiliaryModelOptions } from "../../model/auxiliary-model-options.js";
// FORK(webfetch-direct-passthrough): 短正文不再经过加工模型；见 FEATURES.md 的 webfetch-direct-passthrough 条目
import { decideForkWebfetchDirectPassThrough } from "../../fork/webfetch-direct-passthrough/policy.js";
import { MAX_MODEL_INPUT_CHARS, WEBFETCH_TOOL_NAME } from "./webfetch-constants.js";
import { truncateContentForModel } from "./webfetch-content.js";
import { webFetchError } from "./webfetch-errors.js";
import { traceFromContext } from "./webfetch-trace.js";
import type { CachedFetchContent } from "./webfetch-types.js";

interface WebFetchProcessingOptions {
  preapprovedUrl?: boolean;
}

export async function processFetchedContent(
  input: WebFetchInput,
  fetched: CachedFetchContent,
  context: ToolExecutionContext,
  options: WebFetchProcessingOptions = {},
): Promise<{ result: string; truncated: boolean }> {
  if (shouldReturnMarkdownDirectly(fetched, options)) {
    return { result: fetched.content, truncated: false };
  }

  // FORK-BEGIN(webfetch-direct-passthrough)
  // 为什么必须在这里：上游把「是否需要压成摘要」当成常量（永远压），
  // 而短正文压缩是纯损失——加工往返可能失败并让整页内容丢失，摘要还会丢表格/代码细节。
  // 判定参数由 runtime 逐级透传（context.remainingContextTokens），缺席即回落上游行为。
  const directPassThrough = decideForkWebfetchDirectPassThrough({
    content: fetched.content,
    remainingContextTokens: context.remainingContextTokens,
  });
  if (directPassThrough.direct) {
    return { result: fetched.content, truncated: false };
  }
  // FORK-END(webfetch-direct-passthrough)

  const model = context.model;
  if (!model) {
    throw createCoreError(
      CoreErrorType.ConfigurationError,
      "Model is not configured for WebFetch prompt processing",
      {
        context: {
          toolCallId: context.toolCallId,
          toolName: WEBFETCH_TOOL_NAME,
        },
        recoverable: false,
      },
    );
  }

  const { content, truncated } = truncateContentForModel(fetched.content);
  const messages: ModelInputMessage[] = [
    {
      role: "user",
      content: buildProcessingPrompt(content, input.prompt, options.preapprovedUrl === true),
    },
  ];

  try {
    const result = await runWithModelInvocationContext(
      {
        metadata: {
          querySource: "web_fetch_processing",
          traceId: context.traceId,
          toolCallId: context.toolCallId,
          toolName: WEBFETCH_TOOL_NAME,
        },
        modelRequestSessionType: "other",
        modelCall: { operation: "web_fetch_processing" },
        traceContext: traceFromContext(context),
      },
      () =>
        model.generateText({
          messages,
          tools: [],
          options: {
            ...auxiliaryModelOptions(model),
            maxOutputTokens: Math.min(4096, model.optionSpecs.maxOutputTokens.max),
          },
          abortSignal: context.abortSignal,
        }),
    );

    return {
      result:
        result.text.trim() || "WebFetch completed, but the extraction model returned no text.",
      truncated,
    };
  } catch (error) {
    throw webFetchError(
      "ProcessingFailed",
      error instanceof Error ? error.message : "WebFetch prompt processing failed",
      {
        url: fetched.finalUrl,
      },
      error,
    );
  }
}

function shouldReturnMarkdownDirectly(
  fetched: CachedFetchContent,
  options: WebFetchProcessingOptions,
): boolean {
  return (
    options.preapprovedUrl === true &&
    fetched.contentType.toLowerCase().includes("text/markdown") &&
    fetched.content.length < MAX_MODEL_INPUT_CHARS
  );
}

function buildProcessingPrompt(content: string, prompt: string, preapprovedUrl: boolean): string {
  const instruction = preapprovedUrl
    ? "Provide a concise response based on the content above. Include relevant details, code examples, and documentation excerpts as needed."
    : [
        "Provide a concise response based only on the content above. In your response:",
        " - Enforce a strict 125-character maximum for quotes from any source document. Open Source Software is ok as long as we respect the license.",
        " - Use quotation marks for exact language from articles; any language outside of the quotation should never be word-for-word the same.",
        " - You are not a lawyer and never comment on the legality of your own prompts and responses.",
        " - Never produce or reproduce exact song lyrics.",
      ].join("\n");

  return `
Web page content:
---
${content}
---

${prompt}

${instruction}
`;
}
