// FORK(codex-collaboration): Core/Adapter 必须共享物理请求计数，含鉴权及签名修复。
import { createModelRecoveryBudget, ModelRetryBudget as RetryBudgetTier } from "@zcode/contracts";
import type { Logger, ModelStatusSink, ModelTextResult } from "@zcode/contracts";
import {
  ModelErrorCode,
  // FORK(codex-collaboration): 本地准备失败的处置必须保留取消语义。
  ModelFailureReason as ModelFailureReasonValue,
  ModelProtocolError,
  ModelRetryReason,
  ModelTransportKind as ModelTransportKindValue,
} from "@zcode/contracts";
// FORK(codex-collaboration): 异步 SDK 本地校验必须与实际 API 失败分开归因。
import {
  classifyModelFailure,
  inspectProviderFailure,
  isLocalModelRequestFailure,
} from "./failure-classifier.js";
import type { ClassifiedModelFailure } from "./failure-classifier.js";
import { getResponseHeaders, unwrapRetryError } from "./failure-inspection.js";
import { offPeakTicketExpiredMessage, resolveOffPeakFailureDecision } from "./offpeak-retry.js";
import { AiSdkModelAdapterError } from "./errors.js";
import { resolveAnthropicRequestMetadataUserId } from "./anthropic-request-metadata.js";
import { createGenerateTextOptions } from "./runner-options.js";
import { detectProviderBusinessFinishError } from "./provider-finish-business-error.js";
import {
  normalizeReasoning,
  normalizeSources,
  normalizeToolCalls,
  normalizeToolResults,
  normalizeUsage,
} from "./runner-normalization.js";
import {
  isDevelopmentModelIOEnv,
  recordGenerateTextDebug,
  shouldRecordModelIO,
} from "./runner-debug.js";
import {
  createEmptyContextExceededError,
  getGenerateTextResultMetadata,
  isZeroOutputModelCompletion,
  logGenerateTextDiagnostics,
} from "./runner-diagnostics.js";
import { sanitizeModelNetworkHeaders } from "./runner-network-headers.js";
import { canRetryEmptyCompletion, scheduleEmptyCompletionRetry } from "./empty-completion-retry.js";
import {
  calculateRetryDelay,
  classifyAttemptAdmissionFailure,
  logRetryDelayDecision,
  sleep,
  toAdapterError,
} from "./runner-retry.js";
import {
  admissionWaitPublishers,
  createAttemptStatusContext,
  createStatusContext,
  publishModelStatus,
} from "./runner-status.js";
import type { EnvRecord } from "./model-execution.js";
import type { ResolvedAiSdkModelRetryOptions } from "./retry-policy.js";
import type {
  AiSdkModelRuntime,
  AiSdkModelTextRequest,
  ResolvedAiSdkModel,
} from "./runner-runtime.js";
import { AccountRequestRetry } from "./account-request-retry.js";
import { resolveModelForAttempt, RuntimeHeadersRefreshError } from "./runner-runtime-headers.js";
import { retryAllowedByFailurePolicy } from "./workflow-model-failure-policy.js";
import { modelFailureStatusFields, providerRequestIdFromHeaders } from "./runner-telemetry.js";
import { repairReasoningHistoryAfterSignatureRejection } from "./reasoning-history-normalization.js";
import { admitAttempt, type AttemptAdmission } from "./request-admission.js";
// FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
import { retryBudgetAllows } from "./retry-budget.js";

export async function runGenerateText(input: {
  debugDir?: string;
  env: EnvRecord;
  logger?: Logger;
  request: AiSdkModelTextRequest;
  resolveModel: () => ResolvedAiSdkModel;
  resolved: ResolvedAiSdkModel;
  retry: ResolvedAiSdkModelRetryOptions;
  runtime: AiSdkModelRuntime;
  statusSink?: ModelStatusSink;
  modelIoFullRetentionEnabled: boolean;
}): Promise<ModelTextResult> {
  // FORK-BEGIN(codex-collaboration)
  const recoveryBudget =
    input.request.modelRecoveryBudget ?? createModelRecoveryBudget(input.retry.maxAttempts);
  // 配置必须收紧整条恢复链；SingleAttempt 只限制声明式 fallback 的当前 provider。
  if (input.request.modelRetryBudget !== RetryBudgetTier.SingleAttempt)
    recoveryBudget.constrainMaxAttempts(input.retry.maxAttempts);
  const firstAttempt = recoveryBudget.attempts + 1;
  const lastAttempt = Math.min(
    recoveryBudget.maxAttempts,
    recoveryBudget.attempts + input.retry.maxAttempts,
  );
  if (firstAttempt > lastAttempt) {
    throw new AiSdkModelAdapterError(
      ModelErrorCode.ModelRequestFailed,
      "Model recovery request budget exhausted.",
      {
        context: {
          attempts: recoveryBudget.attempts,
          maxAttempts: recoveryBudget.maxAttempts,
          recoveryBudgetExhausted: true,
          retryable: false,
        },
      },
    );
  }
  const retryBudget = input.request.modelRetryBudget;
  // FORK-END(codex-collaboration)
  const baseStatusContext = createStatusContext({
    maxAttempts: lastAttempt,
    request: input.request,
    resolved: input.resolved,
    transport: ModelTransportKindValue.Http,
  });
  // FORK-BEGIN(codex-collaboration)
  // Core 安全锚点恢复创建新 invocation；沿用物理次数计算退避，不能重置为首请求。
  if (firstAttempt > 1) {
    const delayMs = calculateRetryDelay(input.retry, firstAttempt - 1);
    await publishRetryScheduledStatus(
      input,
      baseStatusContext,
      firstAttempt - 1,
      delayMs,
      {
        code: ModelErrorCode.ModelRequestFailed,
        message: "Recovering the interrupted model request.",
        reason: "unknown",
        retryReason: ModelRetryReason.NetworkError,
        retryable: true,
      },
      {},
      {},
    );
    await sleep(delayMs, input.request.abortSignal);
  }
  // FORK-END(codex-collaboration)
  const recordModelIO =
    input.request.metadata?.skipTranscript !== true && shouldRecordModelIO(input.env);
  const isDev = isDevelopmentModelIOEnv(input.env);
  let requestMessages = input.request.messages;
  let signatureRepairAttempted = false;
  const authRetry = new AccountRequestRetry(input.request, input.resolved, input.logger);
  let emptyCompletionRetryCount = 0;

  // FORK(codex-collaboration): 每一物理尝试计入同一个硬预算，特殊修复不再豁免。
  for (let attempt = firstAttempt; attempt <= lastAttempt; attempt += 1) {
    const retryBudgetAttempt = attempt;
    const attemptRequest = { ...input.request, messages: requestMessages };
    const startedAt = Date.now();
    let resolved = input.resolved;
    let statusContext = createAttemptStatusContext(
      {
        ...baseStatusContext,
        // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
        maxAttempts: lastAttempt,
      },
      attempt,
    );
    let options: ReturnType<typeof createGenerateTextOptions> | undefined;
    let requestInvocationCompleted = false;
    // FORK(codex-collaboration): 本地状态/持久化错误不属于 provider 请求失败。
    let providerOperationInProgress = false;
    let requestHeaders: Record<string, string> = {};
    let requestHeaderCount = 0;

    // 进程级准入：每次尝试发出前等槽位，
    // 票据在本次尝试结束时归还（成功 / 失败 / 抛出都经 finally；退避 sleep 之前先归还）。等待中被
    // 取消 → 与 sleep 被取消同一条路：记 connect 阶段的 cancelled 失败，抛出。
    let admission: AttemptAdmission;
    try {
      admission = await admitAttempt({
        admission: input.request.modelRequestAdmission,
        model: { providerId: String(resolved.providerId), modelId: String(resolved.modelId) },
        signal: input.request.abortSignal,
        ...admissionWaitPublishers(statusContext, attempt, statusPublishOptions(input)),
      });
    } catch (admitError) {
      const admitFailure = classifyAttemptAdmissionFailure(admitError, input.request.abortSignal);
      await publishModelStatus(
        {
          ...statusContext,
          attempt,
          message: admitFailure.message,
          reason: admitFailure.reason,
          requestHeaderCount,
          requestHeaders,
          retryable: false,
          statusCode: admitFailure.statusCode,
          ...modelFailureStatusFields(admitError, admitFailure, "connect"),
          timestamp: new Date().toISOString(),
          type: "model_request_failed",
        },
        {
          ...statusPublishOptions(input),
          failureError: unwrapRetryError(admitError),
        },
      );
      throw toAdapterError(admitError, admitFailure, statusContext, attempt, {
        errorPhase: "connect",
      });
    }

    try {
      resolved = await resolveModelForAttempt({
        attempt,
        reason: authRetry.takeReason(),
        request: authRetry.prepareRequest(attemptRequest),
        resolveModel: input.resolveModel,
      });
      const anthropicMetadataUserId = await resolveAnthropicRequestMetadataUserId({
        env: input.env,
        providerKind: resolved.providerKind,
        sessionId: statusContext.sessionId,
      });
      options = createGenerateTextOptions({
        anthropicMetadataUserId,
        env: input.env,
        includeModelIO: recordModelIO,
        request: attemptRequest,
        resolved,
        statusContext,
      });
      requestHeaders = sanitizeModelNetworkHeaders(options.headers);
      requestHeaderCount = Object.keys(requestHeaders).length;
      await publishModelStatus(
        {
          ...statusContext,
          attempt,
          requestHeaderCount,
          requestHeaders,
          timestamp: new Date(startedAt).toISOString(),
          type: "model_request_started",
        },
        statusPublishOptions(input, admission),
      );

      // 部分非流式 provider/fetch 兼容层收到 AbortSignal 后不会及时 settle
      // generateText promise，导致 runtime 已 Stop，goal verifier 仍要等上游自然返回才收口。
      // adapter 是本地取消契约边界：signal 一旦 abort 就立即拒绝，迟到 provider 结果只丢弃。
      // FORK(codex-collaboration): 准入和本地配置检查通过后才计数，SDK 内置 retry 已关闭。
      if (recoveryBudget.claimAttempt() === undefined)
        throw new Error("Model recovery request budget exhausted.");
      providerOperationInProgress = true;
      const pendingResult = input.runtime.generateText(options);
      // options 构造成功不等于 runtime 已接受请求；同步 setup 异常会在调用点直接抛出。
      // 只有 generateText 调用返回 pending promise 后才进入 response 归因边界，避免把本地 setup 记成 provider。
      requestInvocationCompleted = true;
      const result = await waitForGenerateTextOrAbort(pendingResult, input.request.abortSignal);
      const responseHeaders = sanitizeModelNetworkHeaders(
        getGenerateTextResultMetadata(result)?.response?.headers,
      );
      const providerBusinessFinishError = detectProviderBusinessFinishError({
        providerId: String(resolved.providerId),
        providerKind: resolved.providerKind,
        source: {
          finishReason: result.finishReason,
          providerMetadata: result.providerMetadata,
          rawFinishReason: (result.providerMetadata as Record<string, unknown> | undefined)
            ?.rawFinishReason,
          response: (result as unknown as { response?: unknown }).response,
        },
      });
      if (providerBusinessFinishError) {
        throw providerBusinessFinishError;
      }
      const usage = normalizeUsage(result.totalUsage ?? result.usage);
      const toolCalls = normalizeToolCalls(result, input.logger);
      const toolResults = normalizeToolResults(result, toolCalls);
      const sources = normalizeSources(result);
      const text = input.request.responseJsonSchema
        ? serializeStructuredOutput(result)
        : result.text;
      const reasoning = normalizeReasoning(result.reasoning);
      const contextError = createEmptyContextExceededError({
        finishReason: result.finishReason,
        rawFinishReason: result.rawFinishReason ?? result.providerMetadata?.rawFinishReason,
        hasAssistantContent:
          text.length > 0 ||
          (reasoning ?? []).some(
            (block) => block.text.length > 0 || Object.keys(block.providerOptions ?? {}).length > 0,
          ),
        toolCallCount: toolCalls?.length ?? 0,
        usage,
      });
      if (contextError) throw contextError;
      const reasoningLength = (reasoning ?? []).reduce(
        (total, block) => total + block.text.length,
        0,
      );
      if (
        input.request.preserveProviderStreamBoundaries !== true &&
        isZeroOutputModelCompletion({
          finishReason: result.finishReason,
          rawFinishReason:
            result.rawFinishReason ??
            (result.providerMetadata as Record<string, unknown> | undefined)?.rawFinishReason,
          reasoningLength,
          textLength: text.length,
          toolCallCount: toolCalls?.length ?? 0,
          usage,
        }) &&
        canRetryEmptyCompletion({
          abortSignal: input.request.abortSignal,
          attempt,
          // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
          maxAttempts: lastAttempt,
          retryCount: emptyCompletionRetryCount,
        })
      ) {
        const completedAt = Date.now();
        // 空 completion 是 provider promise 正常 resolve，不会进入异常重试 catch；
        // 必须在 adapter 返回前识别并重试一次，否则 core 只能收到最终空响应错误。
        logGenerateTextDiagnostics({
          attempt,
          completedAt,
          logger: input.logger,
          result,
          startedAt,
          statusContext,
          toolCallCount: toolCalls?.length ?? 0,
          usage,
        });
        emptyCompletionRetryCount += 1;
        await scheduleEmptyCompletionRetry({
          abortSignal: input.request.abortSignal,
          attempt,
          completedAt,
          errorPhase: "response",
          logger: input.logger,
          requestHeaders,
          requestStatusSink: input.request.statusSink,
          responseHeaders,
          retry: input.retry,
          retryBudgetAttempt,
          startedAt,
          statusContext,
          statusSink: input.statusSink,
        });
        continue;
      }
      const completedAt = Date.now();
      // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
      providerOperationInProgress = false;

      recordGenerateTextDebug({
        modelIoFullRetentionEnabled: input.modelIoFullRetentionEnabled,
        attempt,
        debugDir: input.debugDir,
        isDev,
        normalizedToolCalls: toolCalls,
        options,
        recordModelIO,
        request: attemptRequest,
        requestId: statusContext.requestId,
        resolved,
        result,
        startedAt,
      });
      logGenerateTextDiagnostics({
        attempt,
        completedAt,
        logger: input.logger,
        result,
        statusContext,
        startedAt,
        toolCallCount: toolCalls?.length ?? 0,
        usage,
      });
      await publishModelStatus(
        {
          ...statusContext,
          attempt,
          durationMs: completedAt - startedAt,
          finishReason: result.finishReason,
          requestHeaderCount,
          requestHeaders,
          responseHeaderCount: Object.keys(responseHeaders).length,
          responseHeaders,
          providerRequestId: providerRequestIdFromHeaders(responseHeaders),
          timestamp: new Date(completedAt).toISOString(),
          type: "model_request_completed",
          usage,
        },
        statusPublishOptions(input, admission),
      );

      return {
        text,
        finishReason: result.finishReason,
        usage,
        reasoning,
        toolCalls,
        toolResults,
        sources,
        providerMetadata: result.providerMetadata as Record<string, unknown> | undefined,
      };
    } catch (error) {
      // 合并后鉴权解析进入 attempt try；与 stream 一致保留网络前凭据缺失的类型化错误。
      if (
        error instanceof ModelProtocolError &&
        error.code === ModelErrorCode.ModelRequestAuthMissing
      )
        throw error;
      const completedAt = Date.now();
      const classified = classifyModelFailure(error, input.request.abortSignal);
      if (error instanceof RuntimeHeadersRefreshError) {
        classified.message = error.message;
        classified.retryable = false;
        // FORK(codex-collaboration): 本地刷新失败不能让 workflow 外层重新驱动。
        classified.localControl ??= "prepare_failed";
      }
      // FORK(codex-collaboration): SDK 调用前的配置/权限失败不属于 API 恢复。
      if (!providerOperationInProgress) {
        classified.retryable = false;
        if (classified.reason !== ModelFailureReasonValue.Cancelled)
          classified.localControl ??= "prepare_failed";
      }
      // off-peak 特判（仅 idle plan provider，见 offpeak-retry.ts）：排队 429 保留归因、
      // 3102（兼容旧 3001）以稳定标记落败触发 desktop 侧续跑。
      const offPeak = resolveOffPeakFailureDecision({
        offPeak: resolved.accountAccess?.mode === "off-peak",
        failure: classified,
        error: unwrapRetryError(error),
      });
      const failure: ClassifiedModelFailure =
        offPeak?.kind === "ticketExpired"
          ? {
              // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
              ...classified,
              message: offPeakTicketExpiredMessage(classified.message),
            }
          : offPeak?.kind === "queued"
            ? { ...classified, retryable: true, retryReason: ModelRetryReason.OffpeakQueued }
            : classified;
      const responseHeaders = sanitizeModelNetworkHeaders(
        getResponseHeaders(unwrapRetryError(error)),
      );
      const repairedMessages =
        !signatureRepairAttempted && resolved.providerKind === "anthropic"
          ? repairReasoningHistoryAfterSignatureRejection(requestMessages, error)
          : undefined;
      // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
      const retryWithRepairedHistory = repairedMessages !== undefined && attempt < lastAttempt;
      if (repairedMessages) {
        // 签名只对生成它的 thinking block 有效。明确收到签名校验 400 时，
        // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
        // 只替换本次请求副本，并在共享预算内给一次物理请求机会；不能通过
        // 回退 attempt 复用 requestId，也不能改写 canonical history。
        signatureRepairAttempted = true;
        requestMessages = repairedMessages;
        statusContext = {
          ...statusContext,
          // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
          maxAttempts: lastAttempt,
        };
      }
      const canRetryWithFailurePolicy =
        offPeak?.kind === "queued"
          ? true
          : retryBudgetAllows(retryBudget, retryBudgetAttempt, input.retry.maxAttempts) &&
            // FORK(codex-collaboration): 所有宿主消费同一分类事实，额外恢复不放宽物理预算。
            retryAllowedByFailurePolicy(
              failure,
              retryBudget,
              inspectProviderFailure(error).providerErrorCode,
            );
      // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
      const retryWithAuth = attempt < lastAttempt && authRetry.claim(error, options === undefined);
      if (retryWithAuth)
        statusContext = {
          ...statusContext,
          // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
          maxAttempts: lastAttempt,
        };
      // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
      const canRetry =
        attempt < lastAttempt &&
        (retryWithAuth || retryWithRepairedHistory || canRetryWithFailurePolicy);

      if (options) {
        recordGenerateTextDebug({
          modelIoFullRetentionEnabled: input.modelIoFullRetentionEnabled,
          attempt,
          debugDir: input.debugDir,
          error,
          isDev,
          normalizedToolCalls: undefined,
          options,
          recordModelIO,
          request: attemptRequest,
          requestId: statusContext.requestId,
          resolved,
          startedAt,
        });
      }
      await publishModelStatus(
        {
          ...statusContext,
          attempt,
          durationMs: completedAt - startedAt,
          message: failure.message,
          reason: failure.reason,
          requestHeaderCount,
          requestHeaders,
          responseHeaderCount: Object.keys(responseHeaders).length,
          responseHeaders,
          retryable: canRetry,
          statusCode: failure.statusCode,
          ...modelFailureStatusFields(error, failure, options ? "response" : "prepare"),
          timestamp: new Date(completedAt).toISOString(),
          type: "model_request_failed",
          ...(error instanceof AiSdkModelAdapterError && error.usage ? { usage: error.usage } : {}),
        },
        {
          ...statusPublishOptions(input, admission),
          failureError: unwrapRetryError(error),
        },
      );

      if (!canRetry) {
        logRetryDelayDecision({
          attempt,
          canRetry,
          failure,
          logger: input.logger,
          responseHeaders,
          statusContext,
        });
        throw toAdapterError(error, failure, statusContext, attempt, {
          // FORK(codex-collaboration): workflow driver 不得在预算耗尽后重开一条无限链。
          recoveryBudgetExhausted: recoveryBudget.attempts >= recoveryBudget.maxAttempts,
          errorPhase: isLocalModelRequestFailure(error)
            ? "prepare"
            : requestInvocationCompleted
              ? "response"
              : "prepare",
        });
      }

      // FORK(codex-collaboration): 鉴权/签名修复同样遵循指数退避，不能另开零延迟尝试链。
      if (retryWithAuth) failure.retryReason = ModelRetryReason.AuthRefresh;
      else if (retryWithRepairedHistory)
        failure.retryReason = ModelRetryReason.ReasoningSignatureRepair;

      const delayMs =
        offPeak?.kind === "queued"
          ? // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
            Math.min(offPeak.delayMs, 30_000, input.retry.maxDelayMs)
          : calculateRetryDelay(input.retry, retryBudgetAttempt, failure.retryAfterMs);
      logRetryDelayDecision({
        attempt,
        canRetry,
        delayMs,
        failure,
        logger: input.logger,
        responseHeaders,
        statusContext,
      });

      await publishRetryScheduledStatus(
        input,
        statusContext,
        attempt,
        delayMs,
        failure,
        requestHeaders,
        responseHeaders,
        admission,
      );

      // 退避期间不持票：槽位让给别人，重试再准入。
      admission.release();
      try {
        await sleep(delayMs, input.request.abortSignal);
      } catch (sleepError) {
        const sleepFailure = classifyModelFailure(sleepError, input.request.abortSignal);
        const sleepResponseHeaders = sanitizeModelNetworkHeaders(
          getResponseHeaders(unwrapRetryError(sleepError)),
        );
        await publishModelStatus(
          {
            ...statusContext,
            attempt,
            message: sleepFailure.message,
            reason: sleepFailure.reason,
            requestHeaderCount,
            requestHeaders,
            responseHeaderCount: Object.keys(sleepResponseHeaders).length,
            responseHeaders: sleepResponseHeaders,
            retryable: false,
            statusCode: sleepFailure.statusCode,
            ...modelFailureStatusFields(sleepError, sleepFailure, "connect"),
            timestamp: new Date().toISOString(),
            type: "model_request_failed",
          },
          {
            // 退避期间票据已归还：这次取消不属于任何一次尝试，不转投票据。
            ...statusPublishOptions(input),
            failureError: unwrapRetryError(sleepError),
          },
        );
        throw toAdapterError(sleepError, sleepFailure, statusContext, attempt, {
          errorPhase: "connect",
        });
        // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
      }
    } finally {
      admission.release();
    }
  }

  throw new AiSdkModelAdapterError(
    ModelErrorCode.ModelRequestFailed,
    "Model request failed before an attempt could complete",
    { context: { requestId: baseStatusContext.requestId } },
  );
}

function serializeStructuredOutput(result: unknown): string {
  const output = (result as { output?: unknown }).output;
  if (output === undefined) {
    throw new Error("Structured output is unavailable");
  }
  const serialized = JSON.stringify(output);
  if (serialized === undefined) {
    throw new Error("Structured output is unavailable");
  }
  return serialized;
}

function waitForGenerateTextOrAbort<T>(
  pending: Promise<T>,
  abortSignal: AbortSignal | undefined,
): Promise<T> {
  if (!abortSignal) {
    return pending;
  }

  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => {
      abortSignal.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      reject(
        abortSignal.reason instanceof Error
          ? abortSignal.reason
          : new Error("Model request was cancelled."),
      );
    };

    // FORK(codex-collaboration): 同步 setup 期间可能已取消，仍需观察 SDK promise 的迟到 rejection。
    pending.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );

    // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。

    if (abortSignal.aborted) {
      onAbort();
      return;
    }

    abortSignal.addEventListener("abort", onAbort, { once: true });
  });
}

function statusPublishOptions(
  input: {
    logger?: Logger;
    request: AiSdkModelTextRequest;
    resolved?: Pick<ResolvedAiSdkModel, "requestObservations">;
    statusSink?: ModelStatusSink;
  },
  admission?: AttemptAdmission,
) {
  return {
    requestObservations: input.resolved?.requestObservations,
    logger: input.logger,
    requestStatusSink: input.request.statusSink,
    statusSink: input.statusSink,
    // 本次尝试的准入票据也是它的状态事件汇。
    ...(admission?.ticket === undefined ? {} : { admissionTicket: admission.ticket }),
  };
}

async function publishRetryScheduledStatus(
  input: {
    logger?: Logger;
    request: AiSdkModelTextRequest;
    statusSink?: ModelStatusSink;
  },
  statusContext: ReturnType<typeof createStatusContext>,
  attempt: number,
  delayMs: number,
  failure: ReturnType<typeof classifyModelFailure>,
  requestHeaders: Record<string, string>,
  responseHeaders: Record<string, string>,
  admission?: AttemptAdmission,
): Promise<void> {
  await publishModelStatus(
    {
      ...statusContext,
      attempt,
      delayMs,
      message: failure.message,
      nextAttempt: attempt + 1,
      reason: failure.retryReason,
      requestHeaderCount: Object.keys(requestHeaders).length,
      requestHeaders,
      responseHeaderCount: Object.keys(responseHeaders).length,
      responseHeaders,
      statusCode: failure.statusCode,
      errorCode: failure.code,
      retryAfterMs: failure.retryAfterMs,
      timestamp: new Date().toISOString(),
      type: "model_retry_scheduled",
    },
    statusPublishOptions(input, admission),
  );
}
