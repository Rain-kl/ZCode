/**
 * FORK(reload-command): `/reload` —— 在已有会话里重读 fork 设置（系统指令 + 工具档位）。
 *
 * 与 `/compact` 同形的维护轮：TurnStarted 标 `inputVisibility: "model-only"`（不渲染用户气泡、
 * 模型也读不到该文本），执行期间是 kind = "reload" 的不可干预活动轮，不产生模型请求。
 *
 * 实质动作见 `reloadForkOverrides`：身份端口 / 档位端口各读一次 → 工具面差量（内置先显式注销
 * 被排除项再整体重注册；MCP 注销上次注册名后按启动期描述符快照重新过滤，不重连）→ 清工具缓存 →
 * `rebuildContextPrefix` 重建提示词前缀。这是本命令的目的：显式打破「前缀在会话内不可变」
 * （identity-preset design 6.3），代价是一次 prompt cache 前缀失效；设置无变化时重建结果
 * 逐字节相同，缓存不失效。
 *
 * 见 FEATURES.md 的 reload-command 条目与 docs/features/reload-command/design.md。
 */
import {
  CoreErrorType,
  SessionEventType,
  runWithContextAsync,
  traceContextToLogContext,
} from "../deps.js";
import type { SessionEvent, TraceContext, TurnId } from "../deps.js";
import {
  appendTurnOutcomeEvent,
  createTurnFailureError,
  throwIfTurnAborted,
} from "../helpers/index.js";
import { resolveBuiltInToolAllowlist } from "../helpers/tool-allowlist.js";
import type { AgentRuntimeInternal } from "../internal.js";
import type { TurnResult } from "../types.js";
import { builtInTools } from "../../tool/index.js";
import { rebuildContextPrefix } from "./context-refresh.js";
import { refreshForkMcpToolRegistrations } from "./mcp.js";

/** `/reload` 的执行结果摘要（日志与测试用）。 */
export interface ForkReloadOutcome {
  /** 子代理运行时不承接（命令面不可达；防御性短路）。 */
  skipped?: "subagent_child";
  identity?: {
    presetId: string | null;
    injectDynamic: boolean | null;
    injectSkills: boolean | null;
    diagnostic?: string;
  };
  tools?: {
    mode: string | null;
    injectTools: boolean | null;
    allowedCount: number | null;
    removedBuiltIn: string[];
    addedBuiltIn: string[];
    mcpRemoved: string[];
    mcpRegistered: string[];
    diagnostic?: string;
  };
}

/**
 * 重读两个 fork 端口并就地重建提示词前缀与工具面。
 *
 * 顺序是有约束的：工具面必须先定型，`rebuildContextPrefix` 里 builder 的
 * `guidanceToolNames` 从当前注册表取（`methods/context.ts`），先重建前缀会留下旧工具指引。
 */
export async function reloadForkOverrides(
  this: AgentRuntimeInternal,
  traceContext: TraceContext,
): Promise<ForkReloadOutcome> {
  if (this.config.taskType === "subagent_child") {
    return { skipped: "subagent_child" };
  }

  const outcome: ForkReloadOutcome = {};

  // 1) 系统指令：与 ensureContextInitialized 同一端口、同一诊断事件名。
  if (this.identityPresetPort) {
    const presetOutcome = await this.identityPresetPort.loadActive();
    if (presetOutcome.diagnostic) {
      this.logger?.warn("Identity preset load failed", {
        ...traceContextToLogContext(traceContext),
        event: "identity_preset.load.failed",
        module: "core.runtime",
        reason: presetOutcome.diagnostic,
      });
    }
    this.config.identityPreset = presetOutcome.preset;
    outcome.identity = {
      presetId: presetOutcome.preset?.id ?? null,
      injectDynamic: presetOutcome.preset?.injectDynamic ?? null,
      injectSkills: presetOutcome.preset?.injectSkills ?? null,
      ...(presetOutcome.diagnostic ? { diagnostic: presetOutcome.diagnostic } : {}),
    };
  }

  // 2) 工具档位 → 工具面差量。
  if (this.forkToolModePort) {
    const modeOutcome = await this.forkToolModePort.loadActive();
    if (modeOutcome.diagnostic) {
      this.logger?.warn("Fork tool mode load failed", {
        ...traceContextToLogContext(traceContext),
        event: "fork.tool_mode.load.failed",
        module: "core.runtime",
        reason: modeOutcome.diagnostic,
      });
    }
    // 端口给的是「最终值」：undefined = 不加档位约束（标准档 + 宿主无名单）。
    this.config.toolAllowlist = modeOutcome.toolAllowlist;

    const beforeNames = new Set(this.registry.list());
    // registerBuiltInTools 只做「注册时过滤」，不会移除上一次注册的项：收窄方向必须显式注销，
    // 否则标准 → 极简后旧工具仍在注册表里（永不生效的静默回归）。
    const allowed = resolveBuiltInToolAllowlist(this.config);
    const removedBuiltIn: string[] = [];
    if (allowed) {
      const allowedSet = new Set(allowed);
      for (const entry of builtInTools) {
        const name = entry.metadata.name;
        if (!allowedSet.has(name) && this.registry.has(name)) {
          this.registry.unregister(name);
          removedBuiltIn.push(name);
        }
      }
    }
    this.reregisterBuiltInTools?.();
    const mcp = await refreshForkMcpToolRegistrations.call(this, traceContext);
    this.cachedTools = null;
    const mcpRegisteredSet = new Set(mcp.registered);
    const addedBuiltIn = [...this.registry.list()].filter(
      (name) => !beforeNames.has(name) && !mcpRegisteredSet.has(name),
    );

    outcome.tools = {
      mode: modeOutcome.mode,
      injectTools: modeOutcome.injectTools,
      allowedCount: this.config.toolAllowlist?.length ?? null,
      removedBuiltIn,
      addedBuiltIn,
      mcpRemoved: mcp.removed,
      mcpRegistered: mcp.registered,
      ...(modeOutcome.diagnostic ? { diagnostic: modeOutcome.diagnostic } : {}),
    };
  }

  // 3) 前缀重建：新身份段 + 新 guidanceToolNames（工具面已在上一步定型）。
  if (this.identityPresetPort || this.forkToolModePort) {
    rebuildContextPrefix(this);
  }

  this.logger?.info("Fork overrides reloaded", {
    ...traceContextToLogContext(traceContext),
    event: "fork.reload.completed",
    module: "core.runtime",
    mode: outcome.tools?.mode ?? null,
    injectTools: outcome.tools?.injectTools ?? null,
    toolCount: outcome.tools?.allowedCount ?? null,
    identityPresetId: outcome.identity?.presetId ?? null,
    removedBuiltInCount: outcome.tools?.removedBuiltIn.length ?? 0,
    addedBuiltInCount: outcome.tools?.addedBuiltIn.length ?? 0,
    mcpRegisteredCount: outcome.tools?.mcpRegistered.length ?? 0,
    status: "completed",
  });

  return outcome;
}

/**
 * `/reload` 的维护轮（形状照抄 `executeManualCompact`）：落完整 turn 边界，不落用户消息。
 */
export async function executeForkReload(
  this: AgentRuntimeInternal,
  input: string,
  turnId: TurnId,
  turnTraceContext: TraceContext,
  abortSignal?: AbortSignal,
  inputId?: string,
): Promise<TurnResult> {
  const events: SessionEvent[] = [];
  const startedAt = Date.now();
  const activeTurn = this.beginActiveTurn(turnId, turnTraceContext, "reload", false);
  return runWithContextAsync(turnTraceContext, async () => {
    this.logger?.info("Fork reload started", {
      ...traceContextToLogContext(turnTraceContext),
      event: "fork.reload.started",
      module: "core.runtime",
      status: "started",
    });

    await this.ensureSessionPersisted(input, turnTraceContext);

    const turnStartedEvent = this.createEvent(
      SessionEventType.TurnStarted,
      {
        turnNumber: this.turnNumber,
        input,
        inputId,
        // /reload 是维护命令，不是用户真实 query：事件保留 raw input 供恢复/排查，
        // 但 v4 投影不渲染成 user bubble（与 /compact 同一旗标）。
        inputVisibility: "model-only",
        // 0ms 控制轮：不产生 Agent 工时；缺这个旗标旧 UI 会把 duration=0 渲染成「已工作」。
        executionKind: "controlOnly",
      },
      turnTraceContext,
    );
    await this.appendEvent(turnStartedEvent, turnTraceContext);
    events.push(turnStartedEvent);

    try {
      throwIfTurnAborted(abortSignal);
      await reloadForkOverrides.call(this, turnTraceContext);
      // FORK(reload-command): 转录内灰字回执（/compact 同形 timelineMarker）；
      // sourceCommandId 供客户端 pending command 对账。
      const reloadNoticeEvent = this.createEvent(
        SessionEventType.ForkReloadCompleted,
        { ...(inputId ? { sourceCommandId: inputId } : {}) },
        turnTraceContext,
      );
      await this.appendEvent(reloadNoticeEvent, turnTraceContext);
      events.push(reloadNoticeEvent);
      throwIfTurnAborted(abortSignal);

      const completeEvent = this.createEvent(
        SessionEventType.TurnComplete,
        {
          response: "",
          tokenCount: 0,
          toolCallCount: 0,
          historyRoundCount: 0,
          duration: Date.now() - startedAt,
          resultType: "success",
          cacheStats: this.messageHistory.getCacheStats(),
          inputId,
        },
        turnTraceContext,
      );
      await this.appendEvent(completeEvent, turnTraceContext);
      events.push(completeEvent);

      this.turnNumber++;
      const projection = await this.rebuildProjection();
      this.logger?.info("Fork reload completed", {
        ...traceContextToLogContext(turnTraceContext),
        durationMs: Date.now() - startedAt,
        event: "fork.reload.turn.completed",
        module: "core.runtime",
        status: "completed",
      });

      return {
        response: "",
        turnId,
        traceId: turnTraceContext.traceId,
        events,
        projection,
      };
    } catch (error) {
      const coreError = createTurnFailureError(error, abortSignal, "Fork reload failed");
      const preserveQueueAutoDrainOnCancel =
        coreError.type === CoreErrorType.TurnCancelled &&
        this.activeForegroundExecution?.preserveQueueAutoDrainOnCancel === true;
      if (coreError.type === CoreErrorType.TurnCancelled && !preserveQueueAutoDrainOnCancel) {
        // 与 Stop compact 同一语义：队列重新暂停，FIFO 恢复窗口关闭。
        this.queueAutoDrain = false;
        this.queueExternalDrainActive = false;
      }
      await appendTurnOutcomeEvent(this, {
        coreError,
        events,
        durationMs: Date.now() - startedAt,
        turnPhase: "reload",
        inputId,
        traceContext: turnTraceContext,
        fallbackMessage: "Fork reload failed",
        logEvent: "fork.reload.failed",
        logLabel: "Fork reload",
        preserveQueueAutoDrainOnCancel,
      });

      throw coreError;
    }
  }).finally(() => {
    this.finishActiveTurn(activeTurn);
  });
}
