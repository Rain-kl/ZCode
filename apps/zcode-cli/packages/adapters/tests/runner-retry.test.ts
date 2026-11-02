import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import { ModelErrorCode, ModelFailureReason, ModelRetryReason } from "@zcode/contracts";
import { classifyModelFailure } from "../src/model/failure-classifier.js";
import type { ResolvedAiSdkModelRetryOptions } from "../src/model/retry-policy.js";
import { AiSdkModelAdapterError } from "../src/model/errors.js";
import {
  calculateRetryDelay,
  TerminalStreamChunkError,
  toAdapterError,
} from "../src/model/runner-retry.js";

describe("TerminalStreamChunkError", () => {
  it.each([true, false])("保留底层原因与原文案（存在 cause：%s）", (withCause) => {
    const cause = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
    const adapter = new AiSdkModelAdapterError(
      ModelErrorCode.ModelRequestFailed,
      "request failed",
      {
        cause: withCause ? cause : undefined,
      },
    );
    const terminal = new TerminalStreamChunkError(adapter);
    expect(terminal.cause).toBe(withCause ? cause : adapter);
    expect(terminal.message).toBe(adapter.message);
    expect(terminal.adapterError).toBe(adapter);
  });
});

describe("calculateRetryDelay", () => {
  const retry: ResolvedAiSdkModelRetryOptions = {
    backoffFactor: 2,
    baseDelayMs: 2_000,
    jitter: false,
    maxAttempts: 2,
    maxDelayMs: 60_000,
  };

  it("caps retry-after hints at thirty seconds", () => {
    expect(calculateRetryDelay(retry, 1, 300_000)).toBe(30_000);
  });

  it("falls back to local backoff when retry-after is above five minutes", () => {
    expect(calculateRetryDelay(retry, 1, 300_001)).toBe(2_000);
  });
});

it.each([0.5, 1])(
  "rejects a non-growing retry backoff factor %s in options and env",
  async (factor) => {
    const { resolveAiSdkModelRetryOptions } = await import("../src/model/retry-policy.js");
    expect(resolveAiSdkModelRetryOptions({ backoffFactor: factor }, {}).backoffFactor).toBe(2);
    expect(
      resolveAiSdkModelRetryOptions(undefined, { ZCODE_MODEL_RETRY_BACKOFF_FACTOR: String(factor) })
        .backoffFactor,
    ).toBe(2);
    expect(resolveAiSdkModelRetryOptions({ backoffFactor: 3 }, {}).backoffFactor).toBe(3);
  },
);

describe("toAdapterError attribution context", () => {
  const statusContext = {
    maxAttempts: 3,
    providerId: "account:zai-individual-coding-plan",
    modelId: "glm-5",
    modelCall: {} as never,
    providerKind: "anthropic",
    requestId: "request-secret",
    traceId: "trace-1" as never,
    transport: "sse" as const,
  };
  const failure = {
    code: ModelErrorCode.ModelRequestFailed,
    message: "Provider request failed.",
    reason: ModelFailureReason.NetworkError,
    retryReason: ModelRetryReason.NetworkError,
    retryable: true,
    statusCode: 503,
  };

  it("carries the classified Retry-After through the normalized context", () => {
    // 修复原因：workflow 的配额停止通知靠 context.retryAfterMs 算 resetAt；以前它只活在分类结果里。
    const withRetryAfter = { ...failure, retryAfterMs: 120_000 };
    const error = toAdapterError(new Error("usage cap"), withRetryAfter, statusContext, 1);
    expect(error.context?.retryAfterMs).toBe(120_000);

    const without = toAdapterError(new Error("usage cap"), failure, statusContext, 1);
    expect(without.context).not.toHaveProperty("retryAfterMs");
  });

  it("preserves the resolved provider kind, source and wire transport", () => {
    const error = toAdapterError(new Error("upstream unavailable"), failure, statusContext, 3);

    expect(error.context).toMatchObject({
      exceptionKind: "transport",
      providerKind: "anthropic",
      source: "network",
      transport: "sse",
    });
  });

  it("attributes non-retryable TLS failures to the network", () => {
    const cause = Object.assign(new Error("TLS validation failed for the provider request."), {
      code: "MODEL_TLS_VALIDATION_FAILED",
    });
    const error = toAdapterError(cause, classifyModelFailure(cause), statusContext, 1);

    expect(error.context).toMatchObject({
      reason: ModelFailureReason.TlsError,
      retryable: true,
      source: "network",
    });
  });

  it("attributes request setup validation failures to the local runtime", () => {
    const localFailure = {
      code: ModelErrorCode.InvalidModelRequest,
      message: "Model request configuration is invalid.",
      reason: ModelFailureReason.InvalidRequest,
      retryReason: ModelRetryReason.NetworkError,
      retryable: false,
    };
    const error = toAdapterError(
      new Error("Model option map request body must be valid JSON"),
      localFailure,
      statusContext,
      1,
    );

    expect(error.context).toMatchObject({
      reason: ModelFailureReason.InvalidRequest,
      source: "runtime",
    });
  });

  it.each([
    {
      code: ModelErrorCode.ProviderNotConfigured,
      name: "provider configuration",
      reason: ModelFailureReason.ProviderNotConfigured,
    },
    {
      code: ModelErrorCode.ModelRequestFailed,
      name: "unknown adapter failure",
      reason: ModelFailureReason.Unknown,
    },
  ])("attributes local $name to the runtime", ({ code, reason }) => {
    const error = toAdapterError(
      new Error("local failure"),
      {
        code,
        message: "Local model setup failed.",
        reason,
        retryReason: ModelRetryReason.NetworkError,
        retryable: false,
      },
      statusContext,
      1,
    );

    expect(error.context).toMatchObject({ reason, source: "runtime" });
  });

  it("attributes invalid provider responses to the provider without an HTTP status", () => {
    const error = toAdapterError(
      new Error("invalid provider payload"),
      {
        code: ModelErrorCode.InvalidModelResponse,
        message: "Model returned an invalid response.",
        reason: ModelFailureReason.InvalidRequest,
        retryReason: ModelRetryReason.NetworkError,
        retryable: false,
      },
      statusContext,
      1,
    );

    expect(error.context).toMatchObject({ source: "provider" });
  });

  it("attributes provider business failures to the provider without an HTTP status", () => {
    const providerBusinessError = Object.assign(new Error("provider business failure"), {
      isProviderBusinessError: true,
      name: "ProviderBusinessError",
    });
    const error = toAdapterError(
      providerBusinessError,
      {
        code: ModelErrorCode.ModelRequestFailed,
        message: "Provider request failed.",
        reason: ModelFailureReason.Unknown,
        retryReason: ModelRetryReason.NetworkError,
        retryable: false,
      },
      statusContext,
      1,
    );

    expect(error.context).toMatchObject({ source: "provider" });
  });

  it("uses the response-body boundary as provider evidence for an otherwise unknown failure", () => {
    const error = toAdapterError(
      new Error("Model request failed."),
      {
        code: ModelErrorCode.ModelRequestFailed,
        message: "Model request failed.",
        reason: ModelFailureReason.Unknown,
        retryReason: ModelRetryReason.NetworkError,
        retryable: false,
      },
      statusContext,
      1,
      { streamFailurePhase: "response_body" },
    );

    expect(error.context).toMatchObject({
      reason: ModelFailureReason.Unknown,
      source: "provider",
      streamFailurePhase: "response_body",
    });
  });

  it.each([
    {
      name: "cause",
      wrap: (error: Error) => new Error("AI SDK request failed", { cause: error }),
    },
    {
      name: "RetryError.lastError",
      wrap: (error: Error) =>
        new RetryError({
          errors: [error],
          message: "AI SDK retry failed",
          reason: "errorNotRetryable",
        }),
    },
  ])("attributes provider business failures wrapped in $name", ({ wrap }) => {
    const providerBusinessError = Object.assign(new Error("provider business failure"), {
      isProviderBusinessError: true,
      name: "ProviderBusinessError",
      providerCode: "3007",
      providerRequestId: "request-provider-1",
    });
    const wrappedError = wrap(providerBusinessError);
    const error = toAdapterError(
      wrappedError,
      {
        code: ModelErrorCode.ModelRequestFailed,
        message: "Provider request failed.",
        reason: ModelFailureReason.Unknown,
        retryReason: ModelRetryReason.NetworkError,
        retryable: false,
      },
      statusContext,
      1,
    );

    expect(error.context).toMatchObject({
      exceptionKind: "provider_business",
      providerCode: "3007",
      providerRequestId: "request-provider-1",
      source: "provider",
    });
  });

  it("normalizes AI SDK API call errors without exposing their raw exception name", () => {
    const apiCallError = new APICallError({
      isRetryable: false,
      message: "opaque provider API failure",
    });
    const error = toAdapterError(
      apiCallError,
      {
        code: ModelErrorCode.ModelRequestFailed,
        message: "Model request failed.",
        reason: ModelFailureReason.Unknown,
        retryReason: ModelRetryReason.NetworkError,
        retryable: false,
      },
      statusContext,
      1,
      { errorPhase: "response" },
    );

    expect(error.context).toMatchObject({
      errorPhase: "response",
      exceptionKind: "api_call",
      source: "provider",
    });
  });

  it.each([
    {
      error: new TypeError("local runtime type failure"),
      expectedKind: "type_error",
      name: "TypeError",
    },
    {
      error: Object.assign(new Error("schema validation failed"), { name: "ZodError" }),
      expectedKind: "validation",
      name: "validation error",
    },
  ])("normalizes $name into a low-cardinality exception kind", ({ error, expectedKind }) => {
    const adapterError = toAdapterError(
      error,
      {
        code: ModelErrorCode.ModelRequestFailed,
        message: "Model request failed.",
        reason: ModelFailureReason.Unknown,
        retryReason: ModelRetryReason.NetworkError,
        retryable: false,
      },
      statusContext,
      1,
      { errorPhase: "prepare" },
    );

    expect(adapterError.context).toMatchObject({
      errorPhase: "prepare",
      exceptionKind: expectedKind,
      source: "runtime",
    });
  });

  it("keeps provider-rejected invalid requests attributed to the provider", () => {
    const providerFailure = {
      code: ModelErrorCode.InvalidModelRequest,
      message: "Provider rejected the model request.",
      reason: ModelFailureReason.InvalidRequest,
      retryReason: ModelRetryReason.NetworkError,
      retryable: false,
      statusCode: 400,
    };

    const error = toAdapterError(new Error("bad request"), providerFailure, statusContext, 1);

    expect(error.context).toMatchObject({
      reason: ModelFailureReason.InvalidRequest,
      source: "provider",
      statusCode: 400,
    });
  });

  it("refreshes request facts without replacing reliable attribution or error identity", () => {
    const original = toAdapterError(
      new Error("upstream unavailable"),
      failure,
      { ...statusContext, providerKind: "openai", transport: "http" },
      2,
      { errorPhase: "stream", providerCode: "3001" },
    );
    const coarseOuterFailure = {
      code: ModelErrorCode.ModelRequestFailed,
      message: "Model request failed.",
      reason: ModelFailureReason.Unknown,
      retryReason: ModelRetryReason.NetworkError,
      retryable: false,
    };

    const error = toAdapterError(original, coarseOuterFailure, statusContext, 3, {
      streamFailurePhase: "request_setup",
    });

    expect(error).toBe(original);
    expect(error.context).toMatchObject({
      attempt: 3,
      errorPhase: "stream",
      exceptionKind: "transport",
      providerCode: "3001",
      providerKind: "anthropic",
      reason: ModelFailureReason.NetworkError,
      retryable: true,
      source: "network",
      statusCode: 503,
      streamFailurePhase: "request_setup",
      transport: "sse",
    });
  });
});

describe("TerminalStreamChunkError", () => {
  it("暴露 adapter error 的 cause，避免终止流吞掉底层网络异常", () => {
    const cause = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
    const adapterError = toAdapterError(
      cause,
      failureForTerminalTest(),
      {
        maxAttempts: 2,
        model: { modelId: "glm-5", providerId: "builtin:zai-coding-plan" },
        modelCall: {} as never,
        providerKind: "openai-compatible",
        requestId: "request-1",
        traceId: "trace-1" as never,
        transport: "sse",
      },
      1,
    );

    const terminal = new TerminalStreamChunkError(adapterError);
    expect(terminal.cause).toBe(cause);
  });
});

function failureForTerminalTest() {
  return {
    code: ModelErrorCode.ModelRequestFailed,
    message: "Model request failed.",
    reason: ModelFailureReason.NetworkError,
    retryReason: ModelRetryReason.NetworkError,
    retryable: true,
  };
}

// FORK-BEGIN(codex-collaboration)
describe("bounded API recovery", () => {
  it("defaults to 21 requests and clamps configuration to hard limits", async () => {
    const { resolveAiSdkModelRetryOptions } = await import("../src/model/retry-policy.js");
    expect(resolveAiSdkModelRetryOptions(undefined, {})).toMatchObject({
      maxAttempts: 21,
      maxDelayMs: 30_000,
    });
    expect(
      resolveAiSdkModelRetryOptions({ maxAttempts: 500, maxDelayMs: 500_000 }, {}),
    ).toMatchObject({ maxAttempts: 21, maxDelayMs: 30_000 });
    expect(
      resolveAiSdkModelRetryOptions(undefined, {
        ZCODE_MODEL_RETRY_MAX_RETRIES: "100",
        ZCODE_MODEL_RETRY_MAX_DELAY_MS: "90000",
      }),
    ).toMatchObject({ maxAttempts: 21, maxDelayMs: 30_000 });
  });

  it("caps exponential and provider hinted delays at thirty seconds", () => {
    const retry = {
      maxAttempts: 21,
      maxDelayMs: 90_000,
      baseDelayMs: 2_000,
      backoffFactor: 2,
      jitter: false,
    };
    expect([1, 2, 3, 4, 5, 6].map((attempt) => calculateRetryDelay(retry, attempt))).toEqual([
      2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]);
    expect(calculateRetryDelay(retry, 1, 300_000)).toBe(30_000);
  });

  it.each([400, 401, 403, 404, 422, 499, 503])("recovers actual HTTP %s failures", (statusCode) => {
    const error = new APICallError({
      message: "provider diagnostic",
      url: "http://localhost/model",
      requestBodyValues: {},
      statusCode,
      responseBody: "provider diagnostic",
      isRetryable: false,
    });
    expect(classifyModelFailure(error).retryable).toBe(true);
  });

  it("recovers unknown API and internal abort failures but honors caller cancellation", () => {
    const error = new Error("SDK stream rejected");
    error.name = "AbortError";
    expect(classifyModelFailure(error).retryable).toBe(true);
    expect(classifyModelFailure(new Error("unrecognized upstream error")).retryable).toBe(true);
    const controller = new AbortController();
    controller.abort();
    expect(classifyModelFailure(error, controller.signal)).toMatchObject({
      retryable: false,
      reason: ModelFailureReason.Cancelled,
    });
  });

  it("removes the backoff abort listener after normal completion", async () => {
    const { sleep } = await import("../src/model/runner-retry.js");
    const { getEventListeners } = await import("node:events");
    const controller = new AbortController();
    await sleep(1, controller.signal);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
});
// FORK-END(codex-collaboration)

// FORK-BEGIN(codex-collaboration)
it.each(["EACCES", "EPERM", "FORK_UPSTREAM_REQUEST_BLOCKED"])(
  "does not retry local permission or gate failure %s",
  (code) => {
    expect(
      classifyModelFailure(Object.assign(new Error("local request rejected"), { code })).retryable,
    ).toBe(false);
  },
);
// FORK-END(codex-collaboration)
