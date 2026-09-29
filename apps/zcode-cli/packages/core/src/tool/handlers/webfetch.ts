// ============================================================
// WebFetch Tool Handler
// ============================================================

import { STATUS_CODES } from "node:http";
import {
  WebFetchInputJsonSchema,
  WebFetchInputSchema,
  WebFetchOutputJsonSchema,
  WebFetchOutputSchema,
  type WebFetchInput,
  type WebFetchOutput,
} from "@zcode/contracts";
import type { ToolEntry, ToolHandler } from "../types.js";
import {
  clearWebFetchCacheForTests as clearWebFetchContentCacheForTests,
  getWebFetchCache,
  putWebFetchCache,
} from "./webfetch-cache.js";
import {
  DEFAULT_WEBFETCH_TIMEOUT_MS,
  MAX_WEBFETCH_INLINE_BYTES,
  MAX_WEBFETCH_MODEL_BYTES,
  WEBFETCH_TOOL_NAME,
} from "./webfetch-constants.js";
import { fetchAndExtractContent } from "./webfetch-network.js";
import type {
  FetchAndExtractContentResult,
  HttpErrorFetchContent,
  RedirectFetchContent,
} from "./webfetch-types.js";
import { normalizeWebFetchUrl } from "./webfetch-url.js";

export function clearWebFetchCacheForTests(): void {
  clearWebFetchContentCacheForTests();
}

const WEBFETCH_DESCRIPTION = [
  "Fetches a URL and returns the page content as markdown (plain text for non-HTML).",
  "",
  "- Fails on authenticated/private URLs — use an authenticated MCP tool or `gh` for those instead.",
  "- HTTP is upgraded to HTTPS. Cross-host redirects are returned to you rather than followed; call again with the redirect URL.",
  "- Responses are cached for 15 minutes per URL.",
  "- Very large pages are truncated to a preview; the full content is saved to a file and its path is reported in the result.",
].join("\n");

const webFetchHandler: ToolHandler = async (input, context) => {
  const parsed = WebFetchInputSchema.parse(input) as WebFetchInput;
  const startedAt = Date.now();
  const normalizedUrl = normalizeWebFetchUrl(parsed.url);
  const cacheKey = parsed.url;
  const cached = getWebFetchCache(cacheKey);
  // FORK(webfetch-direct-return): 抽取结果直接作为工具结果返回，不再经过「加工模型」二次总结；
  // 上下文封顶交给 resultBudget。见 FEATURES.md 的 webfetch-direct-return 条目。
  const fetched =
    cached === undefined
      ? await fetchAndExtractContent({
          context,
          originalUrl: cacheKey,
          url: normalizedUrl,
        })
      : cached;

  if (isTerminalFetchContent(fetched)) {
    return formatTerminalOutput(parsed, fetched, Math.max(0, Date.now() - startedAt));
  }

  if (cached === undefined) {
    putWebFetchCache(cacheKey, fetched);
  }

  const durationMs = Math.max(0, Date.now() - startedAt);

  return {
    url: parsed.url,
    finalUrl: fetched.finalUrl,
    status: fetched.status,
    statusText: httpStatusText(fetched.status, fetched.statusText),
    contentType: fetched.contentType,
    bytes: fetched.bytes,
    durationMs,
    result: fetched.content,
    cacheHit: cached !== undefined,
    redirects: fetched.redirects,
    artifactUri: fetched.artifactUri,
    artifactPath: fetched.artifactPath,
    truncated: false,
  } satisfies WebFetchOutput;
};

function formatTerminalOutput(
  input: WebFetchInput,
  fetched: HttpErrorFetchContent | RedirectFetchContent,
  durationMs: number,
): WebFetchOutput {
  if (fetched.type === "redirect") {
    return formatRedirectOutput(input, fetched, durationMs);
  }
  return formatHttpErrorOutput(fetched, durationMs);
}

function formatRedirectOutput(
  input: WebFetchInput,
  redirect: RedirectFetchContent,
  durationMs: number,
): WebFetchOutput {
  const statusText = httpStatusText(redirect.status, redirect.statusText);
  const result = [
    "REDIRECT DETECTED: The URL redirects to a different host.",
    "",
    `Original URL: ${redirect.originalUrl}`,
    `Redirect URL: ${redirect.redirectUrl}`,
    `Status: ${redirect.status} ${statusText}`,
    "",
    "To complete your request, I need to fetch content from the redirected URL. Please use WebFetch again with these parameters:",
    `- url: "${redirect.redirectUrl}"`,
  ].join("\n");

  return {
    url: input.url,
    finalUrl: redirect.originalUrl,
    status: redirect.status,
    statusText,
    contentType: "text/plain",
    bytes: Buffer.byteLength(result, "utf8"),
    durationMs,
    result,
    cacheHit: false,
    redirects: redirect.redirects,
    truncated: false,
  };
}

function formatHttpErrorOutput(error: HttpErrorFetchContent, durationMs: number): WebFetchOutput {
  const statusText = httpStatusText(error.status, error.statusText);
  const retryAfter = error.retryAfter ? `\nRetry-After: ${error.retryAfter}` : "";
  const result = [
    `The server returned HTTP ${error.status} ${statusText}.${retryAfter}`,
    "",
    "The response body was not retrieved. If this URL requires authentication, use an authenticated tool (e.g. `gh` for GitHub, or an MCP-provided fetch tool) instead of WebFetch.",
  ].join("\n");

  return {
    url: error.originalUrl,
    finalUrl: error.finalUrl,
    status: error.status,
    statusText,
    contentType: "text/plain",
    bytes: 0,
    durationMs,
    result,
    cacheHit: false,
    redirects: error.redirects,
    truncated: false,
  };
}

function httpStatusText(status: number, statusText: string): string {
  return statusText.trim() || STATUS_CODES[status] || "Unknown Status";
}

function isTerminalFetchContent(
  value: FetchAndExtractContentResult,
): value is HttpErrorFetchContent | RedirectFetchContent {
  return "type" in value;
}

export const webFetchToolEntry: ToolEntry = {
  capability: "Fetch a public URL and return its readable content as markdown",
  metadata: {
    name: WEBFETCH_TOOL_NAME,
    description: WEBFETCH_DESCRIPTION,
    readOnly: true,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: DEFAULT_WEBFETCH_TIMEOUT_MS,
    maxOutputBytes: MAX_WEBFETCH_MODEL_BYTES,
    sideEffectScope: "network",
    riskLevel: "medium",
    needsApproval: true,
  },
  handler: webFetchHandler,
  formatModelContent: formatWebFetchModelContent,
  inputSchema: WebFetchInputJsonSchema,
  outputSchema: WebFetchOutputJsonSchema,
  runtimeInputSchema: WebFetchInputSchema,
  runtimeOutputSchema: WebFetchOutputSchema,
  permission: {
    permission: "webfetch",
    reason: "WebFetch performs an outbound network GET request to the requested domain",
    riskLevel: "medium",
    sideEffectScope: "network",
    needsApproval: true,
    patternSources: ["network"],
    alwaysAllowPatternSources: ["network"],
    denyPriority: "beforeAsk",
  },
  // FORK(webfetch-direct-return): 正文直接进上下文，封顶只能靠这里。此前跟着加工模型的
  // 4096 token 输出上限，这道闸门从未触发过；现在按内联上限落盘并只给头部预览。
  // 见 FEATURES.md 的 webfetch-direct-return 条目。
  resultBudget: {
    maxInlineBytes: MAX_WEBFETCH_INLINE_BYTES,
    maxModelBytes: MAX_WEBFETCH_INLINE_BYTES,
    strategy: "artifact",
    preview: {
      maxBytes: MAX_WEBFETCH_INLINE_BYTES,
      direction: "head",
    },
    artifact: {
      enabled: true,
      retention: "session",
    },
  },
  timeout: {
    defaultMs: DEFAULT_WEBFETCH_TIMEOUT_MS,
    maxMs: DEFAULT_WEBFETCH_TIMEOUT_MS,
    allowCallOverride: false,
  },
  cancellation: {
    supported: true,
    cleanup: "bestEffort",
    userVisibleMessage: "WebFetch was cancelled before the page could be processed",
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
};

function formatWebFetchModelContent(output: unknown): string {
  if (isWebFetchOutput(output)) {
    return output.result;
  }
  return typeof output === "string" ? output : (JSON.stringify(output) ?? "");
}

function isWebFetchOutput(value: unknown): value is WebFetchOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as WebFetchOutput).result === "string" &&
    typeof (value as WebFetchOutput).finalUrl === "string"
  );
}
