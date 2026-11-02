/* eslint-disable max-lines -- FORK(codex-collaboration): 上游流状态机原已超限；本修复统一错误路径并缩短文件，保持现有 iterator/工具提交顺序。 */
// FORK(codex-collaboration): Core/Adapter 必须共享物理请求计数，含鉴权及签名修复。
import { createModelRecoveryBudget, ModelRetryBudget as RetryBudgetTier } from "@zcode/contracts";
import type { TextStreamPart, ToolSet } from "ai";
import type { Logger, ModelStatusSink, ModelStreamEvent } from "@zcode/contracts";
import {
  ModelErrorCode,
  ModelFailureReason as ModelFailureReasonValue,
  ModelProtocolError,
  ModelRetryReason,
  ModelTransportKind as ModelTransportKindValue,
  type ModelRetryBudget,
} from "@zcode/contracts";
// FORK(codex-collaboration): 异步 SDK 本地校验必须与实际 API 失败分开归因。
import {
  classifyModelFailure,
  isLocalModelRequestFailure,
  findProviderBusinessError,
  inspectProviderFailure,
  type ClassifiedModelFailure,
} from "./failure-classifier.js";
import { resolveAnthropicRequestMetadataUserId } from "./anthropic-request-metadata.js";
import {
  getErrorCode,
  getHttpResponseStatus,
  getResponseHeaders,
  unwrapRetryError,
} from "./failure-inspection.js";
import { offPeakTicketExpiredMessage, resolveOffPeakFailureDecision } from "./offpeak-retry.js";
import { isRetrySafePreludeStreamEvent } from "./stream-retry-boundary.js";
import {
  createLinkedAbortController,
  isModelStreamIdleTimeoutError,
  readNextWithStreamIdleTimeout,
  resolveModelStreamIdleTimeoutMs,
} from "./stream-idle-timeout.js";
import {
  createEmptyContextExceededError,
  createStreamDiagnostics,
  isZeroOutputModelCompletion,
  isSuspiciousStreamDiagnostics,
  logIgnoredStreamChunk,
  logStreamDiagnostics,
  logStreamFailureDiagnostics,
  recordStreamChunkDiagnostic,
} from "./runner-diagnostics.js";
import { AiSdkModelAdapterError } from "./errors.js";
import { canRetryEmptyCompletion, scheduleEmptyCompletionRetry } from "./empty-completion-retry.js";
import { createStreamTextOptions } from "./runner-options.js";
import {
  isDevelopmentModelIOEnv,
  recordStreamTextDebug,
  shouldRecordModelIO,
} from "./runner-debug.js";
import { sanitizeModelNetworkHeaders } from "./runner-network-headers.js";
import { admitAttempt, type AttemptAdmission } from "./request-admission.js";
// FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
import { retryBudgetAllows } from "./retry-budget.js";
import { toModelStreamEvent } from "./runner-normalization.js";
import type { EnvRecord } from "./model-execution.js";
import { detectProviderBusinessFinishError } from "./provider-finish-business-error.js";
import { createRequestVerificationEmptyStreamError } from "./request-security-edition/recovery.js";
import {
  calculateRetryDelay,
  classifyAttemptAdmissionFailure,
  logRetryDelayDecision,
  sleep,
  TerminalStreamChunkError,
  toAdapterError,
} from "./runner-retry.js";
import {
  admissionWaitPublishers,
  createAttemptStatusContext,
  createStatusContext,
  publishModelStatus,
  publishModelTelemetryMilestone,
} from "./runner-status.js";
import { StreamingToolCallAssembler } from "./streaming-tool-call-assembler.js";
import type { ResolvedAiSdkModelRetryOptions } from "./retry-policy.js";
import type {
  AiSdkStreamTextResult,
  AiSdkModelRuntime,
  AiSdkModelTextRequest,
  ResolvedAiSdkModel,
} from "./runner-runtime.js";
import { isRequestVerificationRejection } from "./request-security-edition/recovery.js";
import { AccountRequestRetry } from "./account-request-retry.js";
import { resolveModelForAttempt, RuntimeHeadersRefreshError } from "./runner-runtime-headers.js";
import { retryAllowedByFailurePolicy } from "./workflow-model-failure-policy.js";
import {
  modelFailureStatusFields,
  providerRequestIdFromHeaders,
  readModelFailureErrorPhase,
} from "./runner-telemetry.js";
import { repairReasoningHistoryAfterSignatureRejection } from "./reasoning-history-normalization.js";

type StreamFailurePhase = "request_setup" | "response_body";

const STREAM_ATTEMPT_CLEANUP_TIMEOUT_MS = 1_000;

export async function* runStreamText(input: {
  debugDir?: string;
  env: EnvRecord;
  logger?: Logger;
  request: AiSdkModelTextRequest;
  resolveModel: () => ResolvedAiSdkModel;
  resolved: ResolvedAiSdkModel;
  retry: ResolvedAiSdkModelRetryOptions;
  runtime: AiSdkModelRuntime;
  statusSink?: ModelStatusSink;
  streamIdleTimeoutMs: number;
  modelIoFullRetentionEnabled: boolean;
}): AsyncGenerator<ModelStreamEvent> {
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
    transport: ModelTransportKindValue.Sse,
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
        reason: ModelFailureReasonValue.Unknown,
        retryReason: ModelRetryReason.NetworkError,
        retryable: true,
      },
      {},
      {},
    );
    await sleep(delayMs, input.request.abortSignal);
  }
  // FORK-END(codex-collaboration)
  const recordModelIO = shouldRecordModelIO(input.env);
  const isDev = isDevelopmentModelIOEnv(input.env);
  let requestMessages = input.request.messages;
  let signatureRepairAttempted = false;
  const authRetry = new AccountRequestRetry(input.request, input.resolved, input.logger);
  let emptyCompletionRetryCount = 0;

  // FORK(codex-collaboration): 每一物理尝试计入同一个硬预算，特殊修复不再豁免。
  for (let attempt = firstAttempt; attempt <= lastAttempt; attempt += 1) {
    const retryBudgetAttempt = attempt;
    const startedAt = Date.now();
    // SSE idle timeout 后的重试如果仍固定首请求窗口，容易被同一段 provider 静默窗口反复打断；
    // core recovery 和 adapter 内部 retry 都统一按重试次数每次增加 30s。
    const streamIdleTimeoutMs = resolveModelStreamIdleTimeoutMs({
      baseTimeoutMs: input.streamIdleTimeoutMs,
      // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
      retryNumber: Math.max(
        input.request.streamIdleTimeoutRetryNumber ?? 0,
        retryBudgetAttempt - 1,
      ),
    });
    let emittedEvent = false;
    let emittedRetryBoundaryEvent = false;
    let emittedError = false;
    // FORK(codex-collaboration): chunk 错误统一抛到 catch；不保留跳过物理计数的旁路。
    let providerStopReasonObserved = false;
    const pendingRetrySafeEvents: ModelStreamEvent[] = [];
    const diagnostics = createStreamDiagnostics();
    const attemptAbortController = createLinkedAbortController(input.request.abortSignal);
    const attemptRequest = {
      ...input.request,
      abortSignal: attemptAbortController.signal,
      messages: requestMessages,
    };
    let statusContext = createAttemptStatusContext(
      {
        ...baseStatusContext,
        // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
        maxAttempts: lastAttempt,
      },
      attempt,
    );
    const toolCallAssembler = new StreamingToolCallAssembler({ logger: input.logger });
    let streamIterator: AsyncIterator<TextStreamPart<ToolSet>> | undefined;
    // FORK(codex-collaboration): 本地状态/持久化错误不属于 provider 请求失败。
    let providerOperationInProgress = false;
    let streamReachedNaturalEnd = false;
    let attemptFailed = false;
    let awaitIteratorClose = false;
    let terminalStatusPublished = false;
    // 提升到 try 外,使 catch 分支也能拿到 options/result 记录失败 model-io。
    let options: ReturnType<typeof createStreamTextOptions> | undefined;
    let result: AiSdkStreamTextResult | undefined;
    let requestHeaders: Record<string, string> = {};
    let requestHeaderCount = 0;
    let resolved = input.resolved;
    let timeToFirstProviderEventMs: number | undefined;
    let timeToFirstContentMs: number | undefined;
    let timeToFirstTextMs: number | undefined;
    let streamMaxIdleMs = 0;
    let streamStallCount = 0;
    let streamOutputCommitted = false;
    const repairThinkingSignatureRejection = (error: unknown): boolean => {
      if (signatureRepairAttempted || resolved.providerKind !== "anthropic") {
        return false;
      }
      const repairedMessages = repairReasoningHistoryAfterSignatureRejection(
        requestMessages,
        error,
      );
      if (!repairedMessages) return false;

      // 签名只对生成它的 thinking block 有效。流尚未提交输出时，只替换
      // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
      // 本次请求副本，并在共享预算内给一次拥有新 requestId 的物理请求机会；
      // 不能把清理结果写回 canonical history。
      signatureRepairAttempted = true;
      requestMessages = repairedMessages;
      input.logger?.warn("Retrying model stream after thinking signature rejection", {
        attempt,
        event: "model.reasoning_signature_repair.retry",
        maxAttempts: input.retry.maxAttempts + 1 + authRetry.extraAttempts,
        nextAttempt: attempt + 1,
        requestId: statusContext.requestId,
        status: "waiting",
      });
      return true;
    };
    const publishVisibleMilestones = async (observation: {
      contentMs?: number;
      textMs?: number;
    }): Promise<void> => {
      if (timeToFirstContentMs === undefined && observation.contentMs !== undefined) {
        timeToFirstContentMs = observation.contentMs;
        await publishModelTelemetryMilestone(
          {
            ...statusContext,
            attempt,
            elapsedMs: observation.contentMs,
            timestamp: new Date(startedAt + observation.contentMs).toISOString(),
            type: "model_first_content",
          },
          { logger: input.logger, statusSink: input.statusSink },
        );
      }
      if (timeToFirstTextMs === undefined && observation.textMs !== undefined) {
        timeToFirstTextMs = observation.textMs;
        await publishModelTelemetryMilestone(
          {
            ...statusContext,
            attempt,
            elapsedMs: observation.textMs,
            timestamp: new Date(startedAt + observation.textMs).toISOString(),
            type: "model_first_text",
          },
          { logger: input.logger, statusSink: input.statusSink },
        );
      }
    };

    // 进程级准入：每次尝试发出前等槽位，
    // 票据在本次尝试结束时归还（成功 / 失败 / 抛出 / 消费者放弃流都经 finally；退避 sleep 之前先归还）。
    // 等待中被取消 → 与 sleep 被取消同一条路：记 connect 阶段的 cancelled 失败，抛出。
    let admission: AttemptAdmission;
    try {
      admission = await admitAttempt({
        admission: input.request.modelRequestAdmission,
        model: { providerId: String(resolved.providerId), modelId: String(resolved.modelId) },
        signal: input.request.abortSignal,
        ...admissionWaitPublishers(statusContext, attempt, statusPublishOptions(input)),
      });
    } catch (admitError) {
      attemptAbortController.cleanup();
      const admitFailure = classifyAttemptAdmissionFailure(admitError, input.request.abortSignal);
      await publishModelStatus(
        {
          ...statusContext,
          attempt,
          durationMs: Date.now() - startedAt,
          message: admitFailure.message,
          reason: admitFailure.reason,
          requestHeaderCount,
          requestHeaders,
          retryable: false,
          statusCode: admitFailure.statusCode,
          streamOutputCommitted,
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
      options = createStreamTextOptions({
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
          // FORK(codex-collaboration): child watchdog 必须让 Adapter 的递增 idle timeout 先判定断流。
          timeoutMs: streamIdleTimeoutMs,
          timestamp: new Date(startedAt).toISOString(),
          type: "model_request_started",
        },
        statusPublishOptions(input, admission),
      );
      // FORK(codex-collaboration): 准入和本地配置检查通过后才计数，SDK 内置 retry 已关闭。
      if (recoveryBudget.claimAttempt() === undefined)
        throw new Error("Model recovery request budget exhausted.");
      providerOperationInProgress = true;
      const streamResult = input.runtime.streamText(options);
      result = streamResult;
      streamIterator = streamResult.fullStream[Symbol.asyncIterator]();

      while (true) {
        // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
        providerOperationInProgress = true;
        const next = await readNextWithStreamIdleTimeout(streamIterator, {
          abortController: attemptAbortController.controller,
          onTimeout: async (error) => {
            streamStallCount += 1;
            streamMaxIdleMs = Math.max(streamMaxIdleMs, error.idleMs);
            await publishModelStatus(
              {
                ...statusContext,
                attempt,
                idleMs: error.idleMs,
                message: error.message,
                requestHeaderCount,
                requestHeaders,
                timeoutMs: error.timeoutMs,
                timestamp: new Date().toISOString(),
                type: "model_stream_stalled",
              },
              statusPublishOptions(input, admission),
            );
          },
          timeoutMs: streamIdleTimeoutMs,
        });
        // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
        providerOperationInProgress = false;
        if (next.done) {
          streamReachedNaturalEnd = true;
          break;
        }
        if (timeToFirstProviderEventMs === undefined) {
          timeToFirstProviderEventMs = Date.now() - startedAt;
          await publishModelTelemetryMilestone(
            {
              ...statusContext,
              attempt,
              elapsedMs: timeToFirstProviderEventMs,
              timestamp: new Date(startedAt + timeToFirstProviderEventMs).toISOString(),
              type: "model_first_provider_event",
            },
            { logger: input.logger, statusSink: input.statusSink },
          );
        }

        let event: Awaited<ReturnType<typeof handleStreamChunk>>;
        try {
          // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
          providerOperationInProgress = true;
          event = await handleStreamChunk({
            admission,
            attempt,
            chunk: next.value,
            diagnostics,
            emittedRetryBoundaryEvent,
            input,
            pendingRetrySafeEvents,
            requestHeaderCount,
            requestHeaders,
            repairThinkingSignatureRejection,
            canRecoverProjectToken: (error) => authRetry.canRecoverProjectToken(error),
            retryBudgetAttempt,
            startedAt,
            statusContext,
            toolCallAssembler,
          });
        } catch (error) {
          const directToolCommit = compactDirectToolCallCommitEvent(input.request, next.value);
          if (directToolCommit) {
            // 完整 direct tool-call 已是 provider 事件；name/input 校验即使抛错，
            // 也不能让 adapter 当作首事件前失败再次 SSE 重放。
            emittedRetryBoundaryEvent = true;
            for (const pendingEvent of pendingRetrySafeEvents.splice(0)) {
              emittedEvent = true;
              yield pendingEvent;
            }
            // 无 raw message-block provenance 的 provider 可能直接给完整 tool-call。
            // 先把 inferred block stop 交给隐藏 collector，再传播校验错误，避免 HTTP 重放。
            emittedEvent = true;
            yield directToolCommit;
          }
          throw error;
        }
        // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
        providerOperationInProgress = true;
        // FORK(codex-collaboration): 原生 stop_reason 是真实终态，后续空 delta 不能撤销已观察证据。
        providerStopReasonObserved ||= event.visibleEvents.some(
          (visibleEvent) =>
            visibleEvent.type === "compact_stream_boundary" &&
            visibleEvent.boundary === "provider_stop_reason" &&
            visibleEvent.present,
        );
        if (event.visibleEvents.some((visibleEvent) => visibleEvent.type === "finish")) {
          const contextError = createEmptyContextExceededError({
            finishReason: diagnostics.finishReason,
            rawFinishReason: diagnostics.rawFinishReason,
            hasAssistantContent: diagnostics.textDeltaChars > 0 || diagnostics.hasReasoningContent,
            toolCallCount: toolCallAssembler.snapshotNormalizedToolCalls().length,
            usage: diagnostics.usage,
          });
          // 先于 yield finish 进入既有 catch，每个请求只发布一个失败终态。
          if (contextError) throw contextError;
          // FORK(codex-collaboration): AI SDK 在 provider EOF 后也会合成 other finish，不能当作完整回答。
          if (
            ["other", "unknown"].includes(diagnostics.finishReason ?? "") &&
            !providerStopReasonObserved &&
            String(diagnostics.rawFinishReason ?? "").trim().length === 0
          ) {
            throw new AiSdkModelAdapterError(
              ModelErrorCode.InvalidModelResponse,
              "Provider stream ended without a terminal stop reason.",
              {
                context: { errorPhase: "stream", reason: "stream_incomplete", retryable: true },
              },
            );
          }
        }
        const shouldHoldEmptyCompletionEvents =
          !event.emittedError &&
          event.visibleEvents.some((visibleEvent) => visibleEvent.type === "finish") &&
          input.request.preserveProviderStreamBoundaries !== true &&
          isZeroOutputModelCompletion({
            finishReason: diagnostics.finishReason,
            rawFinishReason: diagnostics.rawFinishReason,
            reasoningLength: diagnostics.reasoningDeltaChars,
            textLength: diagnostics.textDeltaChars,
            toolCallCount: diagnostics.toolCallCount,
            usage: diagnostics.usage,
          }) &&
          canRetryEmptyCompletion({
            abortSignal: input.request.abortSignal,
            attempt,
            // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
            maxAttempts: lastAttempt,
            retryCount: emptyCompletionRetryCount,
          });
        if (shouldHoldEmptyCompletionEvents) {
          // finish 会把已缓存的 start 一并刷给 core；先暂存到自然 EOF，确认这是
          // generic empty 后再重试，避免第一次 attempt 的 finish/start 泄漏到 UI。
          event.visibleEvents.length = 0;
        }
        emittedError = emittedError || event.emittedError;
        emittedEvent = emittedEvent || event.emittedEvent;
        emittedRetryBoundaryEvent = emittedRetryBoundaryEvent || event.emittedRetryBoundaryEvent;

        // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
        providerOperationInProgress = false;
        if (event.visibleEvents.length > 0) {
          for (const visibleEvent of event.visibleEvents) {
            const observation = observeVisibleStreamEvent(visibleEvent, Date.now() - startedAt);
            await publishVisibleMilestones(observation);
            streamOutputCommitted = streamOutputCommitted || observation.outputCommitted;
            yield visibleEvent;
          }
        }
      }

      // FORK(codex-collaboration): 自然 EOF 不证明生成完成；缺少 terminal 必须走统一恢复。
      providerOperationInProgress = true;
      if (!diagnostics.lastFinishChunk) {
        throw new AiSdkModelAdapterError(
          ModelErrorCode.InvalidModelResponse,
          "Provider stream ended before terminal finish.",
          {
            context: { errorPhase: "stream", reason: "stream_incomplete", retryable: true },
          },
        );
      }

      providerOperationInProgress = false;
      const flushedEvents = applyStreamEventsToRetryBoundary({
        emittedRetryBoundaryEvent,
        events: toolCallAssembler.flush(),
        pendingRetrySafeEvents,
        preserveProviderStreamBoundaries: input.request.preserveProviderStreamBoundaries,
      });
      emittedEvent = emittedEvent || flushedEvents.emittedEvent;
      emittedRetryBoundaryEvent =
        emittedRetryBoundaryEvent || flushedEvents.emittedRetryBoundaryEvent;
      if (flushedEvents.visibleEvents.length > 0) {
        for (const visibleEvent of flushedEvents.visibleEvents) {
          const observation = observeVisibleStreamEvent(visibleEvent, Date.now() - startedAt);
          await publishVisibleMilestones(observation);
          streamOutputCommitted = streamOutputCommitted || observation.outputCommitted;
          yield visibleEvent;
        }
      }

      for (const pendingEvent of pendingRetrySafeEvents.splice(0)) {
        emittedEvent = true;
        const observation = observeVisibleStreamEvent(pendingEvent, Date.now() - startedAt);
        await publishVisibleMilestones(observation);
        streamOutputCommitted = streamOutputCommitted || observation.outputCommitted;
        yield pendingEvent;
      }

      // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
      providerOperationInProgress = true;
      if (!emittedError) {
        // 自然 EOF 后合成的业务错误会通过 TerminalStreamChunkError 直接离开外层 catch；
        // compact 上下文在普通主链路为空，因此必须在合成现场显式保留 stream 阶段。
        // 先识别 provider business error，再考虑 generic empty；否则额度等
        // HTTP 200 空流会被误判成可重试的暂时性空响应。
        const hiddenProviderBusinessError = detectProviderBusinessFinishError({
          providerId: String(statusContext.providerId),
          providerKind: statusContext.providerKind,
          source:
            diagnostics.lastFinishChunk ??
            ({
              type: "finish",
              finishReason: diagnostics.finishReason,
              rawFinishReason: diagnostics.rawFinishReason,
            } satisfies Record<string, unknown>),
        });
        if (hiddenProviderBusinessError) {
          if (isRequestVerificationRejection(hiddenProviderBusinessError))
            throw hiddenProviderBusinessError;
          const failure = classifyModelFailure(
            hiddenProviderBusinessError,
            input.request.abortSignal,
          );
          throw new TerminalStreamChunkError(
            toAdapterError(hiddenProviderBusinessError, failure, statusContext, attempt, {
              ...compactStreamFailureContext(
                input.request.preserveProviderStreamBoundaries,
                "response_body",
              ),
              errorPhase: "stream",
            }),
          );
        }

        if (isSuspiciousStreamDiagnostics(diagnostics)) {
          // 403 JSON 等业务错误有时不会让 AI SDK 抛出 error chunk，流会以空 completion 结束；
          // 若不在 adapter 层终止，core 会误报 “Model returned no text...”。
          const streamEndedWithoutOutputError =
            detectProviderBusinessFinishError({
              providerId: String(statusContext.providerId),
              providerKind: statusContext.providerKind,
              source: diagnostics.lastErrorChunk ?? diagnostics.lastFinishChunk,
            }) ??
            createRequestVerificationEmptyStreamError({
              accountMode: resolved.accountAccess?.mode,
              headers: resolved.headers,
              providerId: String(statusContext.providerId),
              providerKind: resolved.providerKind,
            });
          if (streamEndedWithoutOutputError) {
            if (isRequestVerificationRejection(streamEndedWithoutOutputError))
              throw streamEndedWithoutOutputError;
            const failure = classifyModelFailure(
              streamEndedWithoutOutputError,
              input.request.abortSignal,
            );
            throw new TerminalStreamChunkError(
              toAdapterError(streamEndedWithoutOutputError, failure, statusContext, attempt, {
                ...compactStreamFailureContext(
                  input.request.preserveProviderStreamBoundaries,
                  "response_body",
                ),
                errorPhase: "stream",
              }),
            );
          }

          if (
            input.request.preserveProviderStreamBoundaries !== true &&
            isZeroOutputModelCompletion({
              finishReason: diagnostics.finishReason,
              rawFinishReason: diagnostics.rawFinishReason,
              reasoningLength: diagnostics.reasoningDeltaChars,
              textLength: diagnostics.textDeltaChars,
              toolCallCount: diagnostics.toolCallCount,
              usage: diagnostics.usage,
            }) &&
            canRetryEmptyCompletion({
              abortSignal: input.request.abortSignal,
              attempt,
              // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
              maxAttempts: lastAttempt,
              retryCount: emptyCompletionRetryCount,
            })
          ) {
            const responseHeaders = await resolveStreamResponseHeaders(streamResult);
            const completedAt = Date.now();
            // finish 会把 retry-safe 前奏刷成可见事件；空 completion 需在
            // flush 前进入一次 adapter retry，避免 core 把第一次 attempt 当成已完成。
            logStreamDiagnostics({
              attempt,
              diagnostics,
              durationMs: completedAt - startedAt,
              emittedError,
              emittedEvent,
              logger: input.logger,
              outboundHeaders: resolved.headers,
              statusContext,
            });
            emptyCompletionRetryCount += 1;
            await scheduleEmptyCompletionRetry({
              abortSignal: input.request.abortSignal,
              attempt,
              completedAt,
              errorPhase: "stream",
              logger: input.logger,
              requestHeaders,
              requestStatusSink: input.request.statusSink,
              responseHeaders,
              retry: input.retry,
              retryBudgetAttempt,
              startedAt,
              statusContext,
              statusSink: input.statusSink,
              streamOutputCommitted: false,
            });
            continue;
          }
        }
      }

      logStreamDiagnostics({
        attempt,
        diagnostics,
        durationMs: Date.now() - startedAt,
        emittedError,
        emittedEvent,
        logger: input.logger,
        outboundHeaders: resolved.headers,
        statusContext,
      });
      if (!emittedError) {
        const completedAt = Date.now();
        const responseHeaders = await resolveStreamResponseHeaders(streamResult);
        await publishModelStatus(
          {
            ...statusContext,
            attempt,
            durationMs: completedAt - startedAt,
            requestHeaderCount,
            requestHeaders,
            responseHeaderCount: Object.keys(responseHeaders).length,
            responseHeaders,
            providerRequestId: providerRequestIdFromHeaders(responseHeaders),
            finishReason: diagnostics.finishReason,
            usage: diagnostics.usage,
            timeToFirstProviderEventMs,
            timeToFirstContentMs,
            timeToFirstTextMs,
            streamMaxIdleMs: streamMaxIdleMs || undefined,
            streamStallCount,
            streamOutputCommitted,
            timestamp: new Date(completedAt).toISOString(),
            type: "model_request_completed",
          },
          statusPublishOptions(input, admission),
        );
        terminalStatusPublished = true;
      }
      if (recordModelIO && options) {
        await recordStreamTextDebug({
          modelIoFullRetentionEnabled: input.modelIoFullRetentionEnabled,
          attempt,
          debugDir: input.debugDir,
          isDev,
          normalizedToolCalls: toolCallAssembler.snapshotNormalizedToolCalls(),
          options,
          recordModelIO,
          request: attemptRequest,
          requestId: statusContext.requestId,
          resolved,
          result: streamResult,
          startedAt,
        });
      }
      return;
      // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
    } catch (caughtError) {
      const error =
        caughtError instanceof TerminalStreamChunkError ? caughtError.adapterError : caughtError;
      attemptFailed = true;
      if (recordModelIO && options) {
        await recordStreamTextDebug({
          modelIoFullRetentionEnabled: input.modelIoFullRetentionEnabled,
          attempt,
          debugDir: input.debugDir,
          error,
          isDev,
          normalizedToolCalls: toolCallAssembler.snapshotNormalizedToolCalls(),
          options,
          recordModelIO,
          request: attemptRequest,
          requestId: statusContext.requestId,
          resolved,
          result,
          startedAt,
        });
        // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
      }
      if (
        error instanceof ModelProtocolError &&
        error.code === ModelErrorCode.ModelRequestAuthMissing
      ) {
        // stream 在 attempt try 内解析请求鉴权，过去会把网络前的类型化
        // 鉴权缺失错误重新归一化为通用请求失败；generate 则直接保留原始协议错误。
        throw error;
      }

      const completedAt = Date.now();
      const retryWithRepairedHistory =
        // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
        !emittedRetryBoundaryEvent &&
        attempt < lastAttempt &&
        repairThinkingSignatureRejection(error);
      if (retryWithRepairedHistory) {
        statusContext = {
          ...statusContext,
          // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
          maxAttempts: lastAttempt,
        };
      }
      const classified = classifyModelFailure(error, input.request.abortSignal);
      // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
      if (!providerOperationInProgress) {
        classified.retryable = false;
        if (classified.reason !== ModelFailureReasonValue.Cancelled)
          classified.localControl ??= "prepare_failed";
      }
      if (error instanceof RuntimeHeadersRefreshError) {
        classified.message = error.message;
        classified.retryable = false;
        // FORK(codex-collaboration): 本地刷新失败不能让 workflow 外层重新驱动。
        classified.localControl ??= "prepare_failed";
      }
      // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
      // off-peak 特判（仅 idle plan provider）：排队 429 在同一预算内探测；3102 标记落败触发续跑。
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
            ? {
                ...classified,
                retryable: true,
                retryReason: ModelRetryReason.OffpeakQueued,
              }
            : classified;
      // FORK(codex-collaboration): SDK 校验即使从 fullStream 抛出也仍属于准备阶段。
      const errorPhase = isLocalModelRequestFailure(error)
        ? "prepare"
        : (readModelFailureErrorPhase(error) ??
          (streamIterator === undefined ? "prepare" : "stream"));
      awaitIteratorClose = failure.reason !== ModelFailureReasonValue.Cancelled;
      const responseHeaders = sanitizeModelNetworkHeaders(
        getResponseHeaders(unwrapRetryError(error)),
      );
      const failureDecision = resolveStreamFailureDecision({
        attempt: retryBudgetAttempt,
        emittedRetryBoundaryEvent,
        error,
        failure,
        // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
        maxAttempts: lastAttempt,
        preserveProviderStreamBoundaries: input.request.preserveProviderStreamBoundaries,
        responseHeaders,
        retryBudget,
        streamIteratorCreated: streamIterator !== undefined,
        streamErrorChunkObserved: Boolean(
          diagnostics.lastErrorChunk || diagnostics.lastFinishChunk,
        ),
      });
      // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
      const retryWithAuth =
        attempt < lastAttempt &&
        authRetry.claim(
          error,
          options === undefined ||
            emittedRetryBoundaryEvent ||
            streamOutputCommitted ||
            (input.request.preserveProviderStreamBoundaries === true &&
              failureDecision.context?.streamFailurePhase === "response_body"),
        );
      if (retryWithAuth) {
        failureDecision.canRetry = true;
        statusContext = {
          ...statusContext,
          // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
          maxAttempts: lastAttempt,
        };
      }
      // FORK(codex-collaboration): 排队等待占用同一预算，SSE 可见输出边界仍适用。
      if (offPeak?.kind === "queued" && !emittedRetryBoundaryEvent && attempt < lastAttempt) {
        failureDecision.canRetry = true;
      }
      if (retryWithRepairedHistory) {
        failureDecision.canRetry = true;
      }

      // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
      failureDecision.canRetry = failureDecision.canRetry && attempt < lastAttempt;
      logStreamFailureDiagnostics({
        attempt,
        canRetry: failureDecision.canRetry,
        diagnostics,
        durationMs: completedAt - startedAt,
        emittedError,
        emittedEvent,
        emittedRetryBoundaryEvent,
        error,
        failure,
        logger: input.logger,
        statusContext,
      });
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
          retryable: failureDecision.canRetry,
          statusCode: failure.statusCode,
          streamOutputCommitted,
          ...modelFailureStatusFields(error, failure, errorPhase),
          timestamp: new Date(completedAt).toISOString(),
          type: "model_request_failed",
          ...(error instanceof AiSdkModelAdapterError && error.usage ? { usage: error.usage } : {}),
        },
        {
          ...statusPublishOptions(input, admission),
          failureError: unwrapRetryError(error),
        },
      );
      terminalStatusPublished = true;

      // FORK(codex-collaboration): 鉴权/签名修复同样遵循指数退避，不能另开零延迟尝试链。
      if (retryWithAuth) failure.retryReason = ModelRetryReason.AuthRefresh;
      else if (retryWithRepairedHistory)
        failure.retryReason = ModelRetryReason.ReasoningSignatureRepair;

      if (!failureDecision.canRetry) {
        logRetryDelayDecision({
          attempt,
          canRetry: failureDecision.canRetry,
          failure,
          logger: input.logger,
          responseHeaders,
          statusContext,
        });
        throw toAdapterError(error, failure, statusContext, attempt, {
          // FORK(codex-collaboration): workflow driver 不得在预算耗尽后重开一条无限链。
          recoveryBudgetExhausted: recoveryBudget.attempts >= recoveryBudget.maxAttempts,
          ...failureDecision.context,
          errorPhase,
        });
      }

      const delayMs =
        offPeak?.kind === "queued"
          ? // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
            Math.min(offPeak.delayMs, 30_000, input.retry.maxDelayMs)
          : calculateRetryDelay(input.retry, retryBudgetAttempt, failure.retryAfterMs);
      logRetryDelayDecision({
        attempt,
        canRetry: failureDecision.canRetry,
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
        await publishModelStatus(
          {
            ...statusContext,
            attempt,
            durationMs: Date.now() - startedAt,
            message: sleepFailure.message,
            reason: sleepFailure.reason,
            requestHeaderCount,
            requestHeaders,
            retryable: false,
            statusCode: sleepFailure.statusCode,
            streamOutputCommitted,
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
        terminalStatusPublished = true;
        throw toAdapterError(sleepError, sleepFailure, statusContext, attempt, {
          errorPhase: "connect",
        });
        // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
      }
    } finally {
      if (
        // FORK(codex-collaboration): EOF 也可能是失败；失败 terminal 必须中止并清理，只有成功自然 EOF 豁免。
        attemptFailed ||
        (!streamReachedNaturalEnd && input.request.preserveProviderStreamBoundaries === true)
      ) {
        // 普通 stream 的 429 retry 失败若不进入本清理分支，
        // AI SDK fullStream tee 会持有旧 provider 请求，连续重试会让后续物理请求卡在发送前。
        // 失败 attempt 必须无条件中止并释放；普通 consumer 主动提前结束仍保持原语义。
        if (!attemptAbortController.signal.aborted) {
          attemptAbortController.controller.abort(
            new Error("Model stream attempt ended before natural EOF."),
          );
        }
        if (!attemptFailed && !terminalStatusPublished && !emittedError) {
          // consumer 侧的校验异常只会触发 AsyncIteratorClose，不会回到上面的 catch；
          // 将已启动的物理请求收口为 cancelled，避免 fallback 前遗留悬空 started 状态。
          const completedAt = Date.now();
          await publishModelStatus(
            {
              ...statusContext,
              attempt,
              durationMs: completedAt - startedAt,
              message: "Model stream consumer closed before natural EOF.",
              reason: ModelFailureReasonValue.Cancelled,
              requestHeaderCount,
              requestHeaders,
              retryable: false,
              errorCode: "model_request_cancelled",
              errorPhase: "stream",
              exceptionType: "AbortError",
              streamOutputCommitted,
              timestamp: new Date(completedAt).toISOString(),
              type: "model_request_failed",
            },
            statusPublishOptions(input, admission),
          );
        }
        if (attemptFailed && awaitIteratorClose) {
          await closeStreamIteratorBestEffort(streamIterator, {
            attempt,
            logger: input.logger,
            result,
          });
        } else {
          void closeStreamIteratorBestEffort(streamIterator, {
            attempt,
            logger: input.logger,
          });
        }
      } else if (attemptAbortController.signal.aborted) {
        // 普通 main 保留既有生命周期：只有 caller/idle 已经 abort 时才 best-effort 关闭 iterator。
        void closeStreamIteratorBestEffort(streamIterator, {
          attempt,
          logger: input.logger,
        });
      }
      attemptAbortController.cleanup();
      // 兜底归还（成功 / 抛出 / 消费者提前 return 都到这里）；正常失败路径已在 sleep 前归还，幂等。
      admission.release();
    }
  }
}

async function closeStreamIteratorBestEffort(
  streamIterator: AsyncIterator<TextStreamPart<ToolSet>> | undefined,
  options: { attempt: number; logger?: Logger; result?: AiSdkStreamTextResult },
): Promise<void> {
  const cleanupOperations: Array<{ name: string; promise: Promise<unknown> }> = [];
  if (streamIterator?.return) {
    cleanupOperations.push({
      name: "iterator.return",
      promise: Promise.resolve().then(() => streamIterator.return?.()),
    });
  }
  if (options.result?.consumeStream) {
    cleanupOperations.push({
      name: "result.consumeStream",
      // AI SDK fullStream getter 会 tee 并把另一支保存在 baseStream；
      // 只等待外层 iterator.return() 仍可能让底层 reader/连接槽继续被保留。
      promise: Promise.resolve().then(() => options.result?.consumeStream()),
    });
  }
  if (cleanupOperations.length === 0) return;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    Promise.allSettled(cleanupOperations.map((operation) => operation.promise)).then((results) => ({
      results,
      type: "settled" as const,
    })),
    new Promise<{ type: "timed_out" }>((resolve) => {
      timeout = setTimeout(() => resolve({ type: "timed_out" }), STREAM_ATTEMPT_CLEANUP_TIMEOUT_MS);
    }),
  ]);
  if (timeout !== undefined) clearTimeout(timeout);

  if (outcome.type === "timed_out") {
    options.logger?.warn("Model stream attempt cleanup timed out", {
      attempt: options.attempt,
      cleanupOperations: cleanupOperations.map((operation) => operation.name),
      event: "model.stream_attempt_cleanup.timeout",
      status: "waiting",
      timeoutMs: STREAM_ATTEMPT_CLEANUP_TIMEOUT_MS,
    });
    return;
  }

  const failures = outcome.results.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          {
            errorMessage:
              result.reason instanceof Error ? result.reason.message : String(result.reason),
            operation: cleanupOperations[index]?.name,
          },
        ]
      : [],
  );
  if (failures.length > 0) {
    // 异步清理失败或超时只能降级告警，不能覆盖原始 provider/retry 错误。
    options.logger?.warn("Model stream attempt cleanup failed", {
      attempt: options.attempt,
      event: "model.stream_attempt_cleanup.failed",
      failures,
      status: "failed",
    });
  }
}

async function handleStreamChunk(input: {
  /** 本次尝试的准入：错误块的退避 sleep 之前先归还。 */
  admission: AttemptAdmission;
  attempt: number;
  chunk: TextStreamPart<ToolSet>;
  diagnostics: ReturnType<typeof createStreamDiagnostics>;
  emittedRetryBoundaryEvent: boolean;
  input: {
    logger?: Logger;
    request: AiSdkModelTextRequest;
    resolved: ResolvedAiSdkModel;
    retry: ResolvedAiSdkModelRetryOptions;
    statusSink?: ModelStatusSink;
  };
  pendingRetrySafeEvents: ModelStreamEvent[];
  repairThinkingSignatureRejection: (error: unknown) => boolean;
  canRecoverProjectToken: (error: unknown) => boolean;
  retryBudgetAttempt: number;
  requestHeaderCount: number;
  requestHeaders: Record<string, string>;
  startedAt: number;
  statusContext: ReturnType<typeof createStatusContext>;
  toolCallAssembler: StreamingToolCallAssembler;
}): Promise<{
  emittedError: boolean;
  emittedEvent: boolean;
  emittedRetryBoundaryEvent: boolean;
  // FORK(codex-collaboration): 错误唯一由 catch 恢复，chunk 不发布第二套重试控制状态。
  visibleEvents: ModelStreamEvent[];
}> {
  recordStreamChunkDiagnostic(input.diagnostics, input.chunk);
  const providerEventObserved =
    input.input.request.preserveProviderStreamBoundaries === true &&
    isRawProviderRetryBoundaryEvent(input.chunk);
  const providerBoundaryEvent = input.input.request.preserveProviderStreamBoundaries
    ? toProviderStreamBoundaryEvent(input.chunk)
    : undefined;
  const emittedRetryBoundaryEvent = input.emittedRetryBoundaryEvent || providerEventObserved;
  // FORK(codex-collaboration): 本地 code 不能被业务扫描包装为 provider 错误并抹去禁止重试的事实。
  if (
    input.chunk.type === "error" &&
    input.chunk.error instanceof Error &&
    classifyModelFailure(input.chunk.error, input.input.request.abortSignal).localControl !==
      undefined
  ) {
    throw input.chunk.error;
  }
  const providerBusinessFinishError = detectProviderBusinessFinishError({
    providerId: String(input.statusContext.providerId),
    providerKind: input.statusContext.providerKind,
    source: input.chunk,
  });
  if (providerBusinessFinishError) {
    return handleStreamErrorEvent(
      { ...input, emittedRetryBoundaryEvent },
      providerBusinessFinishError,
    );
  }
  const event = toModelStreamEvent(input.chunk);
  if (event?.type === "error") {
    return handleStreamErrorEvent({ ...input, emittedRetryBoundaryEvent }, event.error);
  }
  if (!event) {
    if (providerEventObserved) {
      // raw provider event 只用于结束 compact SSE retry；它本身不属于
      // 可见正文；只投影 response/block/stop 的语义边界，并立即刷出已暂存的 synthetic start。
      return applyStreamEventsToRetryBoundary({
        emittedRetryBoundaryEvent: input.emittedRetryBoundaryEvent,
        events: providerBoundaryEvent ? [providerBoundaryEvent] : [],
        pendingRetrySafeEvents: input.pendingRetrySafeEvents,
        providerEventObserved: true,
        preserveProviderStreamBoundaries: true,
      });
    }
    logIgnoredStreamChunk({
      attempt: input.attempt,
      chunk: input.chunk,
      logger: input.input.logger,
      statusContext: input.statusContext,
    });
    return streamChunkResult();
  }

  return applyStreamEventsToRetryBoundary({
    emittedRetryBoundaryEvent: input.emittedRetryBoundaryEvent,
    events: input.toolCallAssembler.handle(event),
    pendingRetrySafeEvents: input.pendingRetrySafeEvents,
    providerEventObserved,
    preserveProviderStreamBoundaries: input.input.request.preserveProviderStreamBoundaries,
  });
}

function applyStreamEventsToRetryBoundary(input: {
  emittedRetryBoundaryEvent: boolean;
  events: ModelStreamEvent[];
  pendingRetrySafeEvents: ModelStreamEvent[];
  providerEventObserved?: boolean;
  preserveProviderStreamBoundaries?: boolean;
}): ReturnType<typeof streamChunkResult> {
  let emittedEvent = false;
  let emittedRetryBoundaryEvent = input.emittedRetryBoundaryEvent;
  const visibleEvents: ModelStreamEvent[] = [];

  if (input.providerEventObserved && !emittedRetryBoundaryEvent) {
    visibleEvents.push(...input.pendingRetrySafeEvents.splice(0));
    emittedRetryBoundaryEvent = true;
  }

  for (const event of input.events) {
    emittedEvent = true;
    // AI SDK 的 start 在读取 provider stream 前本地合成，不能冒充首个 provider event；
    // compact 一旦收到其余真实事件就停止 SSE retry，再由 Core 的 block commit 决定能否 HTTP fallback。
    const retrySafePrelude =
      isRetrySafePreludeStreamEvent(event) &&
      (!input.preserveProviderStreamBoundaries || event.type === "start");
    if (retrySafePrelude && !emittedRetryBoundaryEvent) {
      input.pendingRetrySafeEvents.push(event);
      continue;
    }

    if (!emittedRetryBoundaryEvent) {
      visibleEvents.push(...input.pendingRetrySafeEvents.splice(0));
    }
    visibleEvents.push(event);
    emittedRetryBoundaryEvent = true;
  }

  return streamChunkResult({
    emittedEvent,
    emittedRetryBoundaryEvent,
    visibleEvents,
  });
}

function isRawProviderRetryBoundaryEvent(chunk: TextStreamPart<ToolSet>): boolean {
  if (chunk.type !== "raw") {
    return false;
  }
  const rawValue = chunk.rawValue;
  return !(
    rawValue !== null &&
    typeof rawValue === "object" &&
    (rawValue as { type?: unknown }).type === "ping"
  );
}

function toProviderStreamBoundaryEvent(
  chunk: TextStreamPart<ToolSet>,
): ModelStreamEvent | undefined {
  if (chunk.type !== "raw" || chunk.rawValue === null || typeof chunk.rawValue !== "object") {
    return undefined;
  }
  const rawEvent = chunk.rawValue as {
    content_block?: { type?: unknown };
    delta?: { stop_reason?: unknown; type?: unknown };
    index?: unknown;
    type?: unknown;
  };
  if (rawEvent.type === "message_start") {
    return {
      boundary: "provider_response_start",
      type: "compact_stream_boundary",
    };
  }
  if (rawEvent.type === "content_block_start") {
    return {
      blockType:
        typeof rawEvent.content_block?.type === "string" ? rawEvent.content_block.type : null,
      boundary: "provider_content_block_start",
      index: typeof rawEvent.index === "number" ? rawEvent.index : null,
      type: "compact_stream_boundary",
    };
  }
  if (rawEvent.type === "content_block_delta") {
    return {
      boundary: "provider_content_block_delta",
      deltaType: typeof rawEvent.delta?.type === "string" ? rawEvent.delta.type : null,
      index: typeof rawEvent.index === "number" ? rawEvent.index : null,
      type: "compact_stream_boundary",
    };
  }
  if (rawEvent.type === "content_block_stop") {
    return {
      boundary: "provider_content_block_stop",
      index: typeof rawEvent.index === "number" ? rawEvent.index : null,
      type: "compact_stream_boundary",
    };
  }
  if (rawEvent.type === "message_delta") {
    const stopReason = rawEvent.delta?.stop_reason;
    return {
      boundary: "provider_stop_reason",
      present: Boolean(stopReason),
      type: "compact_stream_boundary",
    };
  }
  return undefined;
}

function compactDirectToolCallCommitEvent(
  request: AiSdkModelTextRequest,
  chunk: TextStreamPart<ToolSet>,
): ModelStreamEvent | undefined {
  if (!request.preserveProviderStreamBoundaries || chunk.type !== "tool-call") {
    return undefined;
  }
  return {
    boundary: "inferred_content_block_stop",
    type: "compact_stream_boundary",
  };
}

async function handleStreamErrorEvent(
  input: Parameters<typeof handleStreamChunk>[0],
  error: unknown,
): Promise<Awaited<ReturnType<typeof handleStreamChunk>>> {
  // FORK(codex-collaboration): chunk 和 iterator reject 必须经过同一预算、退避与清理路径。
  throw error;
}

function classifyStreamFailurePhase(input: {
  emittedRetryBoundaryEvent: boolean;
  httpResponseStatus?: number;
  responseHeaders: Record<string, string>;
  streamErrorChunkObserved?: boolean;
  streamIteratorCreated?: boolean;
}): StreamFailurePhase | undefined {
  if (input.streamIteratorCreated === false) {
    return "request_setup";
  }
  if (input.emittedRetryBoundaryEvent) {
    return "response_body";
  }

  const responseStatus = input.httpResponseStatus;
  if (responseStatus !== undefined) {
    if (responseStatus >= 200 && responseStatus < 300) {
      return "response_body";
    }
    if (responseStatus >= 300 && responseStatus < 600) {
      return "request_setup";
    }
  }

  if (input.streamErrorChunkObserved) {
    // error chunk 本身证明 stream body 已开始；其中的 ProviderBusinessError.statusCode
    // 可能只是业务分类，不能反推成 HTTP request setup。明确 transport status 仍由上面的分支优先。
    return "response_body";
  }

  const contentType = readHeader(input.responseHeaders, "content-type")?.toLowerCase();
  if (contentType?.includes("text/event-stream")) {
    return "response_body";
  }
  return undefined;
}

function compactStreamFailureContext(
  preserveProviderStreamBoundaries: boolean | undefined,
  streamFailurePhase: StreamFailurePhase | undefined,
  httpResponseStatus?: number,
): Record<string, unknown> | undefined {
  if (preserveProviderStreamBoundaries !== true || !streamFailurePhase) {
    return undefined;
  }
  return {
    ...(httpResponseStatus !== undefined ? { httpResponseStatus } : {}),
    streamFailurePhase,
  };
}

function resolveStreamFailureDecision(input: {
  attempt: number;
  emittedRetryBoundaryEvent: boolean;
  error: unknown;
  failure: ClassifiedModelFailure;
  maxAttempts: number;
  preserveProviderStreamBoundaries?: boolean;
  responseHeaders: Record<string, string>;
  retryBudget?: ModelRetryBudget;
  streamErrorChunkObserved?: boolean;
  streamIteratorCreated?: boolean;
}): { canRetry: boolean; context?: Record<string, unknown> } {
  const httpResponseStatus = input.preserveProviderStreamBoundaries
    ? resolveCompactHttpResponseStatus(input.error)
    : undefined;
  const streamFailurePhase = input.preserveProviderStreamBoundaries
    ? classifyStreamFailurePhase({
        emittedRetryBoundaryEvent: input.emittedRetryBoundaryEvent,
        httpResponseStatus,
        responseHeaders: input.responseHeaders,
        streamErrorChunkObserved: input.streamErrorChunkObserved,
        streamIteratorCreated: input.streamIteratorCreated,
      })
    : undefined;

  return {
    canRetry: canRetryStreamFailure({
      attempt: input.attempt,
      emittedRetryBoundaryEvent: input.emittedRetryBoundaryEvent,
      error: input.error,
      failure: input.failure,
      httpResponseStatus,
      maxAttempts: input.maxAttempts,
      preserveProviderStreamBoundaries: input.preserveProviderStreamBoundaries,
      retryBudget: input.retryBudget,
      streamFailurePhase,
    }),
    context: compactStreamFailureContext(
      input.preserveProviderStreamBoundaries,
      streamFailurePhase,
      httpResponseStatus,
    ),
  };
}

function canRetryStreamFailure(input: {
  attempt: number;
  emittedRetryBoundaryEvent: boolean;
  error: unknown;
  failure: ClassifiedModelFailure;
  httpResponseStatus?: number;
  maxAttempts: number;
  preserveProviderStreamBoundaries?: boolean;
  retryBudget?: ModelRetryBudget;
  streamFailurePhase?: StreamFailurePhase;
}): boolean {
  // FORK(codex-collaboration): workflow 与主会话共享实际 API 失败分类。
  const providerCode = inspectProviderFailure(input.error).providerErrorCode;
  // FORK(codex-collaboration): 可见输出交给 Core 安全锚点恢复；所有档位均有界。
  if (
    input.emittedRetryBoundaryEvent ||
    !retryBudgetAllows(input.retryBudget, input.attempt, input.maxAttempts)
  ) {
    return false;
  }

  if (input.failure.reason === ModelFailureReasonValue.Cancelled) {
    return false;
  }

  if (
    input.preserveProviderStreamBoundaries === true &&
    isCompactStaleStreamFailure(input.error, input.httpResponseStatus)
  ) {
    // compact 请求允许重试 EPIPE/ConnectionClosed；它们不在通用
    // model failure retryable 集合中，必须先于通用 gate 判定。
    return true;
  }

  if (!retryAllowedByFailurePolicy(input.failure, input.retryBudget, providerCode)) {
    return false;
  }

  // setup failure 保留既有 adapter/API retry；compact 的 SSE protocol/business body error
  // 不再重放，耗尽后的 non-stream fallback 由 Core 按 commit boundary 处理。
  return (
    input.preserveProviderStreamBoundaries !== true || input.streamFailurePhase !== "response_body"
  );
}

function resolveCompactHttpResponseStatus(error: unknown): number | undefined {
  const unwrapped = unwrapRetryError(error);
  // ProviderBusinessError.responseStatus 是 fetch 层保留的 transport status；外层
  // APICallError/statusCode 可能已被业务码覆盖，因此必须优先使用这一硬证据。
  return findProviderBusinessError(unwrapped)?.responseStatus ?? getHttpResponseStatus(unwrapped);
}

function isCompactStaleStreamFailure(
  error: unknown,
  httpResponseStatus: number | undefined,
): boolean {
  const unwrapped = unwrapRetryError(error);
  if (isModelStreamIdleTimeoutError(unwrapped)) {
    return true;
  }

  if (isCompactStaleCode(getErrorCode(unwrapped))) {
    return true;
  }
  if (httpResponseStatus !== undefined) {
    return false;
  }

  const providerCode = findProviderBusinessError(unwrapped)?.providerCode;
  return isCompactStaleCode(typeof providerCode === "number" ? String(providerCode) : providerCode);
}

function isCompactStaleCode(value: string | undefined): boolean {
  const normalized = value?.trim().toUpperCase();
  return normalized === "ECONNRESET" || normalized === "EPIPE" || normalized === "CONNECTIONCLOSED";
}

function readHeader(headers: Record<string, string>, name: string): string | undefined {
  const normalizedName = name.toLowerCase();
  return Object.entries(headers).find(([key]) => key.toLowerCase() === normalizedName)?.[1];
}

function streamChunkResult(
  overrides: Partial<{
    emittedError: boolean;
    emittedEvent: boolean;
    emittedRetryBoundaryEvent: boolean;
    // FORK(codex-collaboration): 错误唯一由 catch 恢复，chunk 不发布第二套重试控制状态。
    visibleEvents: ModelStreamEvent[];
  }> = {},
) {
  return {
    emittedError: false,
    emittedEvent: false,
    emittedRetryBoundaryEvent: false,
    // FORK(codex-collaboration): chunk 仅投影数据，不保留跳过物理预算的控制位。
    visibleEvents: [],
    ...overrides,
  };
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
    retry: ResolvedAiSdkModelRetryOptions;
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

function observeVisibleStreamEvent(
  event: ModelStreamEvent,
  elapsed: number,
): { contentMs?: number; textMs?: number; outputCommitted: boolean } {
  switch (event.type) {
    case "text_delta":
      return {
        contentMs: elapsed,
        textMs: event.text ? elapsed : undefined,
        outputCommitted: true,
      };
    case "reasoning_delta":
    case "tool_input_delta":
    case "tool_call":
      return { contentMs: elapsed, outputCommitted: true };
    case "text_start":
    case "reasoning_start":
    case "tool_input_start":
      return { contentMs: elapsed, outputCommitted: false };
    case "compact_stream_boundary":
      return {
        contentMs: event.boundary === "provider_content_block_start" ? elapsed : undefined,
        outputCommitted:
          event.boundary === "provider_content_block_stop" ||
          event.boundary === "inferred_content_block_stop",
      };
    default:
      return { outputCommitted: false };
  }
}

async function resolveStreamResponseHeaders(
  result: AiSdkStreamTextResult,
): Promise<Record<string, string>> {
  try {
    const response = await (result as unknown as { response?: Promise<unknown> }).response;
    return sanitizeModelNetworkHeaders((response as { headers?: unknown } | undefined)?.headers);
  } catch {
    return {};
  }
}
