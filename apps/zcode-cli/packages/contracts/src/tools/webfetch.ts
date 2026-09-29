// ============================================================
// WebFetch Tool - URL fetch and extraction
// ============================================================

import { z } from "zod";
import type { ToolCallId, TraceId } from "../interfaces/shared.js";
import { toToolJsonSchema } from "./json-schema.js";

// -----------------------------------------------
// Input Schema
// -----------------------------------------------

// FORK(webfetch-direct-return): 原 prompt 字段是交给加工模型的提问，加工阶段已整体移除，
// 正文原文直接返回给调用方模型；见 FEATURES.md 的 webfetch-direct-return 条目。
export const WebFetchInputSchema = z.object({
  url: z.string().url().describe("The URL to fetch content from"),
});

export type WebFetchInput = z.infer<typeof WebFetchInputSchema>;

export const WebFetchInputJsonSchema = toToolJsonSchema(WebFetchInputSchema);

// -----------------------------------------------
// Output Types
// -----------------------------------------------

export interface WebFetchRedirect {
  from: string;
  to: string;
  status: number;
}

export interface WebFetchOutput {
  url: string;
  finalUrl: string;
  status: number;
  statusText: string;
  contentType: string;
  bytes: number;
  durationMs: number;
  result: string;
  cacheHit: boolean;
  redirects: WebFetchRedirect[];
  artifactUri?: string;
  artifactPath?: string;
  truncated: boolean;
}

export const WebFetchRedirectSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    status: z.number().int().nonnegative(),
  })
  .strict();

export const WebFetchOutputSchema = z
  .object({
    url: z.string(),
    finalUrl: z.string(),
    status: z.number().int().nonnegative(),
    statusText: z.string(),
    contentType: z.string(),
    bytes: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    result: z.string(),
    cacheHit: z.boolean(),
    redirects: z.array(WebFetchRedirectSchema),
    artifactUri: z.string().optional(),
    artifactPath: z.string().optional(),
    truncated: z.boolean(),
  })
  .strict();

export const WebFetchOutputJsonSchema = toToolJsonSchema(WebFetchOutputSchema);

// -----------------------------------------------
// Tool Call Structure
// -----------------------------------------------

export interface WebFetchToolCall {
  id: ToolCallId;
  name: "WebFetch";
  input: WebFetchInput;
  traceId: TraceId;
  startedAt: Date;
}

export interface WebFetchToolResult {
  toolCallId: ToolCallId;
  output: WebFetchOutput;
  traceId: TraceId;
  durationMs: number;
}

// -----------------------------------------------
// WebFetch Errors
// -----------------------------------------------

export const WebFetchErrorCode = {
  InvalidUrl: "webfetch_invalid_url",
  UnsupportedProtocol: "webfetch_unsupported_protocol",
  CredentialsInUrl: "webfetch_credentials_in_url",
  MissingRedirectLocation: "webfetch_missing_redirect_location",
  UnsafeRedirect: "webfetch_unsafe_redirect",
  EgressBlocked: "webfetch_egress_blocked",
  TooManyRedirects: "webfetch_too_many_redirects",
  ResponseTooLarge: "webfetch_response_too_large",
  FetchFailed: "webfetch_fetch_failed",
  // FORK(webfetch-direct-return): 原 ProcessingFailed（webfetch_processing_failed）随加工阶段移除，
  // 不再有任何产生点，不许复活；见 FEATURES.md 的 webfetch-direct-return 条目。
} as const;

export type WebFetchErrorCode = (typeof WebFetchErrorCode)[keyof typeof WebFetchErrorCode];
