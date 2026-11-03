import { createAcknowledgedWebRemoteControlRelayProtocol } from "@zcode/client";
import { VSBuffer } from "@zcode/rpc";
import {
  measureWebRemoteControlRpcRelayEnvelopeBytes,
  resolveWebRemoteControlWorkspaceKey,
  type WebRemoteControlAppPayload,
  type WebRemoteControlPlatformRequestPayload,
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
  relay: ReturnType<typeof createAcknowledgedWebRemoteControlRelayProtocol>;
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
  let bridgeOpenGeneration = 0;

  function disposeBridge(reason: string): void {
    const current = active;
    active = undefined;
    if (!current) return;
    current.relay.markDegraded(reason);
    current.disposeListener();
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

  async function openBridge(
    request: Extract<WebRemoteControlAppPayload, { zcode_type: "workspace-bridge-open" }>,
  ): Promise<void> {
    const generation = ++bridgeOpenGeneration;
    const snapshot = await options.listWorkspaces();
    if (generation !== bridgeOpenGeneration) return;
    const target = snapshot.workspaces.find(
      (workspace) => resolveWebRemoteControlWorkspaceKey(workspace) === request.workspaceKey,
    );
    if (!target || target.kind !== "local") {
      options.sendPayload({
        zcode_type: "workspace-bridge-error",
        requestId: request.requestId,
        bridgeSessionId: request.bridgeSessionId,
        ...(request.bridgeGeneration === undefined
          ? {}
          : { bridgeGeneration: request.bridgeGeneration }),
        ...(request.recoveryId ? { recoveryId: request.recoveryId } : {}),
        reason: target ? "unsupported-action" : "workspace-closed",
        error: target
          ? "Headless ZCode Server supports only local workspaces"
          : `Workspace is not available: ${request.workspaceKey}`,
      });
      return;
    }

    const bridge = await options.openCoreBridge({
      workspaceKey: request.workspaceKey,
      ...(request.taskId ? { taskId: request.taskId } : {}),
    });
    if (generation !== bridgeOpenGeneration) {
      bridge.close();
      return;
    }
    disposeBridge("remote.rpcFrame.bridgeSuperseded");

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
      options.sendPayload({
        zcode_type: "bridge-degraded",
        bridgeSessionId: current.bridgeSessionId,
        ...(current.bridgeGeneration === undefined
          ? {}
          : { bridgeGeneration: current.bridgeGeneration }),
        ...(current.recoveryId ? { recoveryId: current.recoveryId } : {}),
        reason: "rpc-transport-fault",
      });
      disposeBridge("remote.rpcFrame.degraded");
    });
    options.sendPayload({
      zcode_type: "workspace-bridge-ready",
      requestId: request.requestId,
      bridgeSessionId: request.bridgeSessionId,
      ...(request.bridgeGeneration === undefined
        ? {}
        : { bridgeGeneration: request.bridgeGeneration }),
      ...(request.recoveryId ? { recoveryId: request.recoveryId } : {}),
      bridge: {
        bridgeSessionId: request.bridgeSessionId,
        ...(request.bridgeGeneration === undefined
          ? {}
          : { bridgeGeneration: request.bridgeGeneration }),
        ...(request.recoveryId ? { recoveryId: request.recoveryId } : {}),
        kind: "local",
        workspaceKey: request.workspaceKey,
        workspacePath: target.workspacePath,
        ...(request.taskId ? { initialTaskId: request.taskId } : {}),
      },
    });
    if (active === current) {
      current.ready = true;
      current.relay.flushPendingFrames();
    }
  }

  return {
    async handle(payload) {
      switch (payload.zcode_type) {
        case "bootstrap-request": {
          const result = await options.listWorkspaces();
          options.sendPayload({
            zcode_type: "bootstrap-response",
            requestId: payload.requestId,
            success: true,
            result: {
              windowControlSessionId: options.deviceSid,
              desktopAppVersion: options.appVersion,
              workspaces: result.workspaces,
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
        case "mobile-task-view-update":
        case "mobile-task-view-request":
        case "mobile-diagnostic":
        case "telemetry-report":
        case "mobile-log":
        case "mobile-log-pull-response":
          return true;
        default:
          return false;
      }
    },
    replayUnacknowledged() {
      return active?.relay.replayUnacknowledged() ?? false;
    },
    dispose(reason = "remote.rpcFrame.connectorStopped") {
      bridgeOpenGeneration += 1;
      disposeBridge(reason);
    },
  };
}
