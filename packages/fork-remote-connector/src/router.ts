import { createAcknowledgedWebRemoteControlRelayProtocol } from "@zcode/client";
import { VSBuffer } from "@zcode/rpc";
import {
  measureWebRemoteControlRpcRelayEnvelopeBytes,
  type WebRemoteControlAppPayload,
  type WebRemoteControlExternalWorkspaceBridge,
  type WebRemoteControlWorkspaceBridgeOpenPayload,
  type WebRemoteControlMobileViewState,
  type WebRemoteControlPlatformRequestPayload,
  type WebRemoteControlFailureReason,
} from "@zcode/shared";
import type {
  ForkRemoteAppRouter,
  ForkRemoteAppRouterOptions,
  ForkRemoteCoreBridge,
} from "./contract.js";

interface ActiveBridge {
  bridge: ForkRemoteCoreBridge;
  bridgeSessionId: string;
  bridgeGeneration?: number;
  recoveryId?: string;
  ready: boolean;
  disposeListener: () => void;
  disposeCloseListener?: () => void;
  relay: ReturnType<typeof createAcknowledgedWebRemoteControlRelayProtocol>;
}

function navigationFailureReason(error: unknown): WebRemoteControlFailureReason {
  const visited = new Set<unknown>();
  // 宿主逐层补充上下文时保留 cause；分类必须读取原始业务原因，不能按包装文案猜测。
  while (error instanceof Error && !visited.has(error)) {
    visited.add(error);
    if (
      /^project\.(not-found|task-not-found|workspace-not-found|host-mismatch|task-directory-mismatch)\b/.test(
        error.message,
      )
    )
      return "workspace-closed";
    if (error.message.startsWith("project.host-offline")) return "desktop-disconnected";
    error = error.cause;
  }
  return "unexpected-error";
}

function headlessPlatformResult(request: WebRemoteControlPlatformRequestPayload): unknown {
  switch (request.method) {
    case "isDockerAvailable":
      return false;
    case "listWSLDistros":
    case "listDockerContainers":
    case "listSSHConfigAliases":
      return [];
    case "loadMcpFromUserDirectory":
      return { servers: [] };
    case "saveMcpToUserDirectory":
      return { success: false, error: "MCP native directory management is not supported" };
    case "migrateLegacyCommonMcp":
      return { servers: {}, totalCount: 0, importedCount: 0, skippedCount: 0 };
    case "createTempTextAttachment":
      return undefined;
  }
}

export function createForkRemoteAppRouter(
  options: ForkRemoteAppRouterOptions,
): ForkRemoteAppRouter {
  let active: ActiveBridge | undefined;
  let pageSessionId: string | undefined;
  let mobileViewState: WebRemoteControlMobileViewState | undefined;
  let pendingInvalidation:
    | Extract<WebRemoteControlAppPayload, { zcode_type: "bridge-degraded" }>
    | undefined;
  let opening:
    | {
        id: string;
        generation?: number;
        intent: string;
        controller: AbortController;
        promise: Promise<WebRemoteControlExternalWorkspaceBridge>;
      }
    | undefined;

  function disposeBridge(reason: string): void {
    const current = active;
    active = undefined;
    if (!current) return;
    current.relay.markDegraded(reason);
    current.disposeListener();
    current.disposeCloseListener?.();
    current.bridge.close();
    current.relay.dispose();
  }

  async function replyPlatform(request: WebRemoteControlPlatformRequestPayload): Promise<void> {
    if (request.method === "createTempTextAttachment") {
      options.sendPayload({
        zcode_type: "platform-response",
        requestId: request.requestId,
        method: request.method,
        success: false,
        error: `${request.method} is not supported by headless ZCode Server`,
      });
      return;
    }
    options.sendPayload({
      zcode_type: "platform-response",
      requestId: request.requestId,
      method: request.method,
      success: true,
      result: headlessPlatformResult(request),
    } as WebRemoteControlAppPayload);
  }

  async function openBridge(request: WebRemoteControlWorkspaceBridgeOpenPayload): Promise<void> {
    let flight: typeof opening;
    try {
      if (request.terminalClientSessionId && request.terminalClientSessionId !== pageSessionId)
        throw new Error("Terminal page session has ended; bootstrap is required.");
      const intent = JSON.stringify([
        request.terminalClientSessionId,
        request.workspaceKey,
        request.taskId,
        request.taskHostId,
        request.fileTreeTaskId,
        request.project,
      ]);
      if (
        opening?.id === request.bridgeSessionId &&
        opening.generation === request.bridgeGeneration
      ) {
        if (opening.intent !== intent)
          throw new Error("Workspace bridge identity cannot change intent.");
        if (active?.relay.isDegraded() || pendingInvalidation)
          throw new Error("Degraded workspace bridge requires a new identity.");
        flight = opening;
      } else {
        opening?.controller.abort();
        flight = {
          id: request.bridgeSessionId,
          generation: request.bridgeGeneration,
          intent,
          controller: new AbortController(),
          promise: undefined as never,
        };
        opening = flight;
        // 原实现只按路径选 tab，丢弃 project/task 归属；由持有真实服务的宿主准备导航。
        flight.promise = Promise.resolve().then(() =>
          buildBridge(request, flight!.controller.signal),
        );
      }
      const bridge = await flight.promise;
      if (opening !== flight || flight.controller.signal.aborted) return;
      options.sendPayload({
        zcode_type: "workspace-bridge-ready",
        requestId: request.requestId,
        bridgeSessionId: request.bridgeSessionId,
        ...(request.bridgeGeneration === undefined
          ? {}
          : { bridgeGeneration: request.bridgeGeneration }),
        ...(request.recoveryId ? { recoveryId: request.recoveryId } : {}),
        bridge,
      });
      if (active?.bridgeSessionId === request.bridgeSessionId) {
        active.ready = true;
        active.relay.flushPendingFrames();
      }
    } catch (error) {
      if (flight && (opening !== flight || flight.controller.signal.aborted)) return;
      const message = error instanceof Error ? error.message : String(error);
      options.sendPayload({
        zcode_type: "workspace-bridge-error",
        requestId: request.requestId,
        bridgeSessionId: request.bridgeSessionId,
        ...(request.bridgeGeneration === undefined
          ? {}
          : { bridgeGeneration: request.bridgeGeneration }),
        ...(request.recoveryId ? { recoveryId: request.recoveryId } : {}),
        reason: navigationFailureReason(error),
        error: `Headless workspace navigation failed (bridge=${request.bridgeSessionId}, workspace=${request.workspaceKey}): ${message}`,
      });
    }
  }

  async function buildBridge(
    request: WebRemoteControlWorkspaceBridgeOpenPayload,
    signal: AbortSignal,
  ): Promise<WebRemoteControlExternalWorkspaceBridge> {
    const target = await options.prepareWorkspace(request, signal);
    signal.throwIfAborted();
    const bridge = await options.openCoreBridge({
      workspaceKey: target.workspaceKey,
      ...(target.initialTaskId ? { taskId: target.initialTaskId } : {}),
    });
    if (signal.aborted) {
      bridge.close();
      signal.throwIfAborted();
    }
    disposeBridge("remote.rpcFrame.bridgeSuperseded");
    pendingInvalidation = undefined;

    const relay = createAcknowledgedWebRemoteControlRelayProtocol({
      bridgeSessionId: request.bridgeSessionId,
      bridgeGeneration: request.bridgeGeneration,
      recoveryId: request.recoveryId,
      measureFrameBytes: measureWebRemoteControlRpcRelayEnvelopeBytes,
      sendFrame: (payload) => Boolean(active?.ready && options.sendPayload(payload)),
    });
    const current: ActiveBridge = {
      bridge,
      bridgeSessionId: request.bridgeSessionId,
      bridgeGeneration: request.bridgeGeneration,
      recoveryId: request.recoveryId,
      ready: false,
      disposeListener: () => undefined,
      relay,
    };
    // Core attachment can emit its initialize frame while onMessage is being installed.
    // Publish the generation first so that frame enters the acknowledged pre-ready queue.
    active = current;
    current.disposeListener = bridge.onMessage((bytes) => {
      if (active === current) current.relay.protocol.send(VSBuffer.wrap(bytes));
    });
    relay.protocol.onMessage((buffer) => {
      if (active === current) bridge.send(buffer.buffer);
    });
    relay.onSaturated(() => {
      if (active === current) bridge.setFlowState("saturated");
    });
    relay.onDrained(() => {
      if (active === current) bridge.setFlowState("drained");
    });
    relay.onDegraded((fault) => {
      if (active !== current) return;
      options.logger.warn("[fork-remote] workspace bridge degraded", fault);
      pendingInvalidation = {
        zcode_type: "bridge-degraded",
        bridgeSessionId: current.bridgeSessionId,
        ...(current.bridgeGeneration === undefined
          ? {}
          : { bridgeGeneration: current.bridgeGeneration }),
        ...(current.recoveryId ? { recoveryId: current.recoveryId } : {}),
        reason: "rpc-transport-fault",
      };
      options.sendPayload(pendingInvalidation);
      disposeBridge("remote.rpcFrame.degraded");
    });
    current.disposeCloseListener = bridge.onClose?.(() => {
      if (active === current) relay.markDegraded("remote.rpcFrame.coreDisconnected");
    });
    return {
      bridgeSessionId: request.bridgeSessionId,
      ...(request.bridgeGeneration === undefined
        ? {}
        : { bridgeGeneration: request.bridgeGeneration }),
      ...(request.recoveryId ? { recoveryId: request.recoveryId } : {}),
      kind: "remote",
      workspaceKey: target.workspaceKey,
      workspacePath: target.workspacePath,
      workspaceIdentity: target.workspaceIdentity,
      remoteSessionId: target.remoteSessionId,
      capabilities: { windowController: false },
      ...(target.initialTaskId ? { initialTaskId: target.initialTaskId } : {}),
    };
  }

  async function handle(payload: WebRemoteControlAppPayload): Promise<boolean> {
    switch (payload.zcode_type) {
      case "bootstrap-request": {
        if (pageSessionId !== payload.terminalClientSessionId) {
          opening?.controller.abort();
          opening = undefined;
          disposeBridge("remote.rpcFrame.pageReplaced");
        }
        pageSessionId = payload.terminalClientSessionId;
        const result = await options.listWorkspaces();
        options.sendPayload({
          zcode_type: "bootstrap-response",
          requestId: payload.requestId,
          success: true,
          result: {
            windowControlSessionId: options.deviceSid,
            desktopAppVersion: options.appVersion,
            workspaces: result.workspaces,
            ...(mobileViewState ? { mobileViewState } : {}),
            ...(result.activeWorkspaceKey
              ? {
                  initialViewState: {
                    activeWorkspaceKey: result.activeWorkspaceKey,
                    ...(result.activeTaskId ? { activeTaskId: result.activeTaskId } : {}),
                    updatedAt: 0,
                  },
                }
              : {}),
          },
        });
        return true;
      }
      case "workspace-list-request":
        options.sendPayload({
          zcode_type: "workspace-list-response",
          requestId: payload.requestId,
          success: true,
          result: await options.listWorkspaces(),
        });
        return true;
      case "workspace-bridge-open":
        await openBridge(payload);
        return true;
      case "platform-request":
        await replyPlatform(payload);
        return true;
      case "rpc-frame":
      case "rpc-frame-ack":
        return active?.relay.acceptPayload(payload) ?? false;
      case "mobile-view-state-update":
        mobileViewState = payload.viewState;
        return true;
      case "mobile-task-view-update":
      case "mobile-task-view-request":
      case "mobile-diagnostic":
      case "telemetry-report":
      case "mobile-log":
      case "mobile-log-pull-response":
        return true;
      default:
        if ("requestId" in payload && typeof payload.requestId === "string") {
          options.sendPayload({
            zcode_type: "app-error",
            requestId: payload.requestId,
            reason: "unsupported-action",
            error: `Headless ZCode Server does not support ${payload.zcode_type}`,
          });
        }
        return false;
    }
  }
  return {
    async handle(payload) {
      try {
        return await handle(payload);
      } catch (error) {
        // bootstrap/list 的真实 IO 错误必须沿请求返回，否则客户端只能等超时且丢失原因。
        if ("requestId" in payload && typeof payload.requestId === "string") {
          options.sendPayload({
            zcode_type: "app-error",
            requestId: payload.requestId,
            reason: "unexpected-error",
            error: `${payload.zcode_type} failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        } else {
          options.logger.error(`[fork-remote] ${payload.zcode_type} failed`, error);
        }
        return false;
      }
    },
    replayUnacknowledged() {
      if (pendingInvalidation) options.sendPayload(pendingInvalidation);
      return active?.relay.replayUnacknowledged() ?? false;
    },
    dispose(reason = "remote.rpcFrame.connectorStopped") {
      opening?.controller.abort();
      opening = undefined;
      pageSessionId = undefined;
      mobileViewState = undefined;
      pendingInvalidation = undefined;
      disposeBridge(reason);
    },
  };
}
