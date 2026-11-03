import { randomUUID } from "node:crypto";
import {
  CollaborationConfigSchema,
  createSessionId,
  createMessageId,
  createSessionEvent,
  SessionEventType,
  CoreErrorType,
  createCoreError,
  isCoreError,
  type SessionId,
  type CollaborationConfig,
  type CollaborationToolPort,
  type CollaborationAgentStatus,
  type CollaborationToolCallContext,
  type BrowserControlPort,
} from "@zcode/contracts";
import type { AgentRuntimeInternal } from "../../runtime/internal.js";
import type { AgentRuntimeDeps } from "../../runtime/types.js";
import { createCollaborationController } from "../codex-collaboration/module.js";
import type {
  AgentIdentity,
  CollaborationController,
  CollaborationSnapshot,
  RunResult,
} from "../codex-collaboration/contract.js";
import {
  buildCollaborationRole,
  mapCollaborationStatus,
} from "../codex-collaboration-tools/module.js";
import { COLLABORATION_SESSION_ENTRY, type RuntimeCollaborationBinding } from "./contract.js";
import {
  readCollaborationRootEntry,
  readCollaborationRelation,
  relationFromSnapshot,
} from "./persistence.js";
import { createRuntimeMailbox } from "./mailbox.js";
import { prepareCollaborationTurn } from "./admission.js";
import { prepareChild } from "./prepared-child.js";
import { CollaborationError } from "../codex-collaboration/contract.js";
import { selectExecutionErrorMessage } from "../../errors/error-payload.js";
async function withRuntimeErrorContext<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof CollaborationError) || !error.cause) throw error;
    const causes: string[] = [];
    let cause: unknown = error.cause;
    while (cause instanceof Error) {
      causes.push(cause.message);
      cause = cause.cause;
    }
    throw new CollaborationError(
      error.code,
      `${error.message}: ${causes.join("; ")}`,
      error.context,
      { cause: error },
    );
  }
}

export function createRuntimeCollaborationBinding(
  rootRuntime: AgentRuntimeInternal,
  deps: AgentRuntimeDeps,
): RuntimeCollaborationBinding {
  let startup: Promise<CollaborationController> | undefined;
  let savedRoot: ReturnType<typeof readCollaborationRootEntry> | undefined;
  let controller: CollaborationController;
  let snapshot: CollaborationSnapshot;
  let config: CollaborationConfig;
  let projectionTail = Promise.resolve();
  let projectionError: unknown;
  const pendingProjections: CollaborationSnapshot[] = [];
  const handles = new Map<string, AgentRuntimeInternal>();
  const preparingBrowsers = new Map<string, BrowserControlPort>();
  const bindings = new Map<string, RuntimeCollaborationBinding>();
  const mailboxes = new Map<string, ReturnType<typeof createRuntimeMailbox>>();
  const runningCommands = new Map<
    string,
    { completion: Promise<RunResult>; signal: AbortSignal }
  >();
  async function drainCommand(agentId: string) {
    const command = runningCommands.get(agentId);
    // 这里只观察 IO 已成功或失败结算；原始拒绝继续由 admission.run 返回 controller/turn 错误链。
    // 不能等 controller.finish：release 本身位于 controller 的串行通道内。
    if (command) await Promise.allSettled([command.completion]);
  }
  const published = new Map<string, string>();
  function hasRunningWork(path: string): boolean {
    return (
      (path === "/root" && pendingProjections.length > 0) ||
      (snapshot?.agents.some(
        (agent) =>
          (agent.path === path || agent.path.startsWith(`${path}/`)) &&
          (agent.status === "running" || runningCommands.has(agent.agentId)),
      ) ??
        false)
    );
  }
  const savedEntry = () =>
    (savedRoot ??= readCollaborationRootEntry(rootRuntime.sessionStore, rootRuntime.sessionId));
  function getAgentStatus(agentId: string) {
    // 冷文件里的 running 不是实时存活证据；只读已建立 controller 的当前快照，不触发 ready。
    if (!controller) return undefined;
    return snapshot.agents.find((agent) => agent.agentId === agentId && agent.path !== "/root")
      ?.status;
  }
  function role(
    runtime: AgentRuntimeInternal,
    path: string,
    tools: readonly import("@zcode/contracts").ModelToolContract[],
    settings: CollaborationConfig,
  ) {
    const names = tools.map((tool) => tool.name);
    return buildCollaborationRole({
      path,
      config: settings,
      toolNames: names,
      availableAgentTypes: names.includes("spawn_agent")
        ? runtime.getAgentDefinitions().activeAgents.map((profile) => profile.name)
        : [],
      exposeModelOverrides: !!runtime.modelCatalogPort,
    });
  }
  const preparationContexts = new Map<string, CollaborationToolCallContext>();
  const preparationTails = new Map<string, Promise<void>>();
  async function withPreparation<T>(
    path: string,
    call: CollaborationToolCallContext,
    operation: () => Promise<T>,
  ): Promise<T> {
    // 只串行化同一路径的瞬态装配参数；身份/接纳/消息队列仍只由 controller 写入。
    const previous = preparationTails.get(path);
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    preparationTails.set(path, tail);
    await previous;
    preparationContexts.set(path, call);
    try {
      return await operation();
    } finally {
      preparationContexts.delete(path);
      if (preparationTails.get(path) === tail) preparationTails.delete(path);
      release();
    }
  }
  const resolve = (id: string) => {
    const found = snapshot.agents.find((agent) => agent.agentId === id);
    if (!found) throw new Error(`Collaboration identity not found: ${id}`);
    return found;
  };
  const adapter = (runtime: AgentRuntimeInternal, identity: AgentIdentity) => {
    handles.set(identity.agentId, runtime);
    const mailbox = createRuntimeMailbox(runtime, identity, resolve);
    mailboxes.set(identity.agentId, mailbox);
    return {
      installMailbox: () => mailbox.install(),
      hasUnreadMessages: mailbox.hasUnreadMessages,
      deliver: mailbox.deliver,
      admit: async ({
        task,
        signal,
      }: Parameters<
        import("../codex-collaboration/contract.js").CollaborationRuntime["admit"]
      >[0]) => {
        const execution = preparationContexts.get(identity.path)?.executionOverride;
        if (execution?.background === "deny")
          throw new Error(
            `Host execution policy background: deny forbids starting ${identity.path}`,
          );
        if (
          execution &&
          JSON.stringify(execution.selection) !== JSON.stringify(runtime.getSessionModelSelection())
        )
          throw new Error(
            `Host execution selection does not match saved child model for ${identity.path}`,
          );
        const admission = await prepareCollaborationTurn(runtime, task, signal, () =>
          mailbox.deliver(task),
        );
        return {
          cancel: () => admission.cancel(),
          async run() {
            const command = admission.run();
            const handle = { completion: command, signal };
            runningCommands.set(identity.agentId, handle);
            try {
              return await command;
            } catch (error) {
              // 普通 turn 的 wrapper 摘要不含真正原因；在 runtime 边界复用既有正文选择，保留整条原 cause。
              // 纯 controller 只读 Error.message，不能让其依赖 runtime error payload 或丢掉 ModelError 身份。
              if (error instanceof Error) {
                const message = selectExecutionErrorMessage(error);
                if (message !== error.message)
                  throw createCoreError(
                    isCoreError(error) ? error.type : CoreErrorType.UnknownError,
                    message,
                    {
                      cause: error,
                      ...(isCoreError(error)
                        ? {
                            context: error.context,
                            retryable: error.retryable,
                            recoverable: error.recoverable,
                          }
                        : {}),
                    },
                  );
              }
              throw error;
            } finally {
              if (runningCommands.get(identity.agentId) === handle)
                runningCommands.delete(identity.agentId);
            }
          },
        };
      },
    };
  };
  async function initialize() {
    const saved = await savedEntry();
    const configured = rootRuntime.config.subagents;
    config =
      saved?.config ??
      CollaborationConfigSchema.parse({
        delegationMode: configured?.delegationMode,
        maxDepth: configured?.maxDepth,
        maxTotalAgents: configured?.maxTotalAgents,
        maxLoadedChildren: configured?.maxLoadedChildren,
      });
    // 根保存的身份先于控制器创建，不能用新进程 trace 破坏冷恢复同一树校验。
    const root: AgentIdentity = saved?.snapshot.agents.find((agent) => agent.path === "/root") ?? {
      agentId: randomUUID(),
      childSessionId: rootRuntime.sessionId,
      path: "/root",
      traceId: rootRuntime.rootTraceContext.traceId,
      settings: { forkTurns: "all" },
    };
    snapshot = saved?.snapshot ?? {
      version: 1,
      rootSessionId: root.childSessionId,
      agents: [{ ...root, status: "idle", generation: 0, mailbox: [] }],
      accepted: [],
    };
    // 冷恢复已有终态只重建派生查询，不伪造新的完成事件；running→interrupted 仍是新事实。
    for (const record of saved?.snapshot.agents ?? [])
      published.set(record.agentId, `${record.generation}:${record.status}`);
    const persistent = rootRuntime.sessionStore !== undefined;
    if (
      persistent &&
      (!rootRuntime.sessionStore?.saveSessionEntry || !rootRuntime.sessionStore.sessionEntries)
    )
      throw new Error(
        `Persistent collaboration requires session-entry read/write for ${rootRuntime.sessionId}`,
      );
    await rootRuntime.ensureSessionPersisted("Collaboration", rootRuntime.rootTraceContext);
    controller = await createCollaborationController({
      root,
      persistence: persistent ? "persistent" : "memory",
      ...config,
      rootRuntime: adapter(rootRuntime, root),
      createId: (kind) =>
        kind === "session"
          ? createSessionId()
          : kind === "message"
            ? createMessageId()
            : randomUUID(),
      clock: {
        schedule(delay, callback) {
          const timer = setTimeout(callback, delay);
          return () => clearTimeout(timer);
        },
      },
      storage: {
        mode: persistent ? "persistent" : "memory",
        read: async () => saved?.snapshot,
        write: async (next) => {
          if (persistent)
            await rootRuntime.sessionStore!.saveSessionEntry!({
              id: `${rootRuntime.sessionId}:codex-collaboration`,
              sessionID: rootRuntime.sessionId,
              type: COLLABORATION_SESSION_ENTRY,
              touchSession: false,
              time: { created: Date.now(), updated: Date.now() },
              data: { version: 1, config, snapshot: next },
            });
          snapshot = structuredClone(next);
        },
      },
      runtime: {
        async prepare(identity, options) {
          const parent = handles.get(identity.parentId ?? root.agentId);
          if (!parent)
            throw new Error(
              `Cannot prepare ${identity.path}: parent runtime ${identity.parentId} is unloaded; restore that parent before spawning or resuming its child`,
            );
          const child = await prepareChild(
            parent,
            deps,
            identity,
            config,
            options.resume,
            (runtime) => linked(runtime, identity),
            () => relationFromSnapshot(snapshot, identity.agentId),
            preparationContexts.get(identity.path),
            (browser) => preparingBrowsers.set(identity.agentId, browser),
          );
          return adapter(child as unknown as AgentRuntimeInternal, identity);
        },
        async release(identity, _runtime, options) {
          const handle = handles.get(identity.agentId);
          if (handle) {
            const child =
              handle as unknown as import("../../runtime/agent-runtime.js").AgentRuntime;
            child.beginShutdown();
            await drainCommand(identity.agentId);
            // 重启要求等待 child 全部所属工作与真实写入，不能只释放浏览器。
            await child.close();
            handles.delete(identity.agentId);
            bindings.delete(identity.agentId);
            mailboxes.delete(identity.agentId);
          } else {
            const browser = preparingBrowsers.get(identity.agentId);
            if (browser) {
              await browser.closeSession?.({
                sessionId: identity.childSessionId as SessionId,
                traceContext: {
                  ...rootRuntime.rootTraceContext,
                  sessionId: identity.childSessionId as SessionId,
                },
              });
              preparingBrowsers.delete(identity.agentId);
            }
          }
          if (options.discard && rootRuntime.sessionStore) {
            const childSessionId = identity.childSessionId as SessionId;
            for (const message of await rootRuntime.sessionStore.messages({
              sessionID: childSessionId,
            }))
              await rootRuntime.sessionStore.removeMessage({
                sessionID: childSessionId,
                messageID: message.info.id,
              });
            await rootRuntime.sessionStore.softDeleteSession?.(childSessionId);
          }
        },
      },
    });
    controller.subscribe((next) => {
      snapshot = next;
      pendingProjections.push(next);
      scheduleProjection();
    });
    await awaitProjection();
    return controller;
  }
  const ready = () => (startup ??= initialize());
  function scheduleProjection() {
    // 终态 register 早于投影移出队列，retire 在此间醒来会再次等待；真实 flight 必须入账，
    // 由 ledger 在整批移出后发出最终唤醒，不能用延时或轮询掩盖所有权交接。
    projectionTail = rootRuntime.trackResidencyBlockingWork(
      projectionTail.then(async () => {
        try {
          while (pendingProjections.length) {
            await publish(pendingProjections[0]!);
            pendingProjections.shift();
          }
          projectionError = undefined;
        } catch (error) {
          // 只截获异步投影失败以避免 unhandled；保留待重放快照，并由所有 await 边界明确抛出。
          projectionError = error;
          rootRuntime.logger?.error(
            "Collaboration projection failed; durable snapshot retained for retry",
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }),
    );
  }
  async function awaitProjection() {
    scheduleProjection();
    await projectionTail;
    if (projectionError) throw projectionError;
  }
  async function publish(next: CollaborationSnapshot) {
    for (const record of next.agents) {
      const relation = await readCollaborationRelation(
        rootRuntime.sessionStore,
        next,
        record.agentId,
      );
      if (!relation) continue;
      const parent = handles.get(record.parentId!);
      const status =
        record.status === "interrupted"
          ? "cancelled"
          : record.status === "errored"
            ? "failed"
            : record.status === "idle"
              ? "completed"
              : record.status;
      const previous = published.get(record.agentId);
      const key = `${record.generation}:${record.status}`;
      parent?.runtimeTaskRegistry.register({
        taskId: record.agentId,
        agentId: record.agentId,
        agentType: relation.agentType,
        description: record.path,
        type: "local_agent",
        childSessionId: record.childSessionId as SessionId,
        parentSessionId: relation.parentSessionId as SessionId,
        parentToolCallId: relation.toolCallId,
        status,
        isBackgrounded: true,
        startedAt: new Date(),
        error: record.lastError,
      });
      if (previous === key) continue;
      if (record.generation === 0) continue;
      const payload = {
        ...relation,
        parentToolCallId: relation.toolCallId,
        taskId: record.agentId,
        description: record.path,
        background: true,
        resumed: record.generation > 1,
        status,
        ...(record.lastError ? { error: record.lastError } : {}),
      };
      const type =
        record.status === "running"
          ? SessionEventType.SubagentSpawned
          : SessionEventType.SubagentStopped;
      // 卸载 parent 后仍向其精确 session 发布；root 只提供共享持久化端口，不冒充接收者。
      const receiver = parent ?? rootRuntime;
      const traceContext = {
        ...receiver.rootTraceContext,
        sessionId: relation.parentSessionId as SessionId,
      };
      await receiver.appendEvent(
        createSessionEvent(type, relation.parentSessionId as SessionId, payload, {
          traceId: receiver.rootTraceContext.traceId,
        }),
        traceContext,
      );
      published.set(record.agentId, key);
    }
  }
  function rootStatus(): CollaborationAgentStatus {
    return rootRuntime.hasActiveOrQueuedTurnWork()
      ? "running"
      : rootRuntime.shuttingDown
        ? "shutdown"
        : { completed: null };
  }
  function linked(
    runtime: AgentRuntimeInternal,
    identity: AgentIdentity,
  ): RuntimeCollaborationBinding {
    // constructor 调用 binding 时就交接资源归属，不能等 hydrate/settings 全部成功后才登记。
    handles.set(identity.agentId, runtime);
    preparingBrowsers.delete(identity.agentId);
    const port: CollaborationToolPort = {
      async spawn(input, call) {
        const tree = await ready();
        if (call.executionOverride?.background === "deny")
          throw new Error(
            `Host execution policy background: deny forbids spawn_agent target ${identity.path}/${input.task_name}`,
          );
        const path = `${identity.path}/${input.task_name}`;
        const child = await withPreparation(path, call, () =>
          withRuntimeErrorContext(() =>
            tree.spawn(
              {
                callerId: identity.agentId,
                callId: call.toolCallId,
                taskName: input.task_name,
                message: input.message,
                settings: {
                  forkTurns: input.fork_turns,
                  ...(input.agent_type ? { agentType: input.agent_type } : {}),
                  ...(input.model ? { model: input.model } : {}),
                  ...(input.reasoning_effort ? { reasoningEffort: input.reasoning_effort } : {}),
                },
              },
              { signal: call.signal },
            ),
          ),
        );
        const relation = await readCollaborationRelation(
          rootRuntime.sessionStore,
          snapshot,
          child.agentId,
        );
        if (relation) call.recordIdentity?.(relation);
        await awaitProjection();
        return { task_name: child.path };
      },
      async send(input) {
        await (await ready()).send(identity.agentId, input.target, input.message);
        return {};
      },
      async followup(input, call) {
        const tree = await ready();
        const target = tree.get(identity.agentId, input.target);
        if (target.status !== "running" && call.executionOverride?.background === "deny")
          throw new Error(
            `Host execution policy background: deny forbids followup_task starting ${target.path}`,
          );
        // 在进入 controller 串行通道之前 drain；旧 run 的最后消息边界也可能需要该通道。
        if (target.status !== "running") await drainCommand(target.agentId);
        await withPreparation(target.path, call, () =>
          withRuntimeErrorContext(() =>
            tree.followup(identity.agentId, input.target, input.message),
          ),
        );
        await awaitProjection();
        return {};
      },
      async interrupt(input) {
        const tree = await ready();
        const before = tree
          .list(identity.agentId)
          .find(
            (record) =>
              record.path === input.target ||
              record.path === `${identity.path}/${input.target}` ||
              record.agentId === input.target,
          );
        const result = await tree.interrupt(identity.agentId, input.target);
        await awaitProjection();
        return {
          previous_status: before
            ? mapCollaborationStatus(before, before.path === "/root" ? rootStatus() : undefined)
            : result.previousStatus === "not_found"
              ? "not_found"
              : mapCollaborationStatus({ status: result.previousStatus }),
        };
      },
      async list(input) {
        const tree = await ready();
        await awaitProjection();
        return {
          agents: tree.list(identity.agentId, input.path_prefix).map((record) => ({
            agent_name: record.path,
            agent_status: mapCollaborationStatus(
              record,
              record.path === "/root" ? rootStatus() : undefined,
            ),
          })),
        };
      },
      async wait(input, call) {
        const result = await (
          await ready()
        ).wait(identity.agentId, { timeoutMs: input.timeout_ms, signal: call.signal });
        return { message: result.message, timed_out: result.timedOut };
      },
    };
    const binding: RuntimeCollaborationBinding = {
      port,
      getAgentStatus,
      hasRunningWork: () => hasRunningWork(identity.path),
      async beforeModel(tools) {
        const tree = await ready();
        await awaitProjection();
        // 中断后 release 在 controller lane 等原 run，旧模型边界不能再排到 release 后形成互等。
        // 原准入 signal 是执行资源句柄；检查与 deliver 同步 enqueue 之间不能插入 await。
        runningCommands.get(identity.agentId)?.signal.throwIfAborted();
        await tree.deliver(identity.agentId, identity.agentId);
        const entries = mailboxes.get(identity.agentId)?.consume() ?? [];
        return { entries, role: role(runtime, identity.path, tools, config) };
      },
      userInputAccepted() {
        if (controller) controller.steer(identity.agentId);
      },
      async interruptChild(agentId) {
        const tree = await ready();
        await tree.interrupt(identity.agentId, agentId);
        await awaitProjection();
        return true;
      },
      async shutdown() {
        /* Child handle disposal must not dispose the shared tree. */
      },
      async flush() {
        await (await ready()).flush();
        await awaitProjection();
      },
    };
    bindings.set(identity.agentId, binding);
    return binding;
  }
  // 根入口同步可注册，实际身份只在持久根 entry 已读取后绑定。
  const rootLinked = async () => {
    await ready();
    const root = snapshot.agents.find((record) => record.path === "/root")!;
    return bindings.get(root.agentId) ?? linked(rootRuntime, root);
  };
  const port: CollaborationToolPort = {
    spawn: async (input, call) => (await rootLinked()).port.spawn(input, call),
    send: async (input, call) => (await rootLinked()).port.send(input, call),
    followup: async (input, call) => (await rootLinked()).port.followup(input, call),
    interrupt: async (input, call) => (await rootLinked()).port.interrupt(input, call),
    list: async (input, call) => (await rootLinked()).port.list(input, call),
    wait: async (input, call) => (await rootLinked()).port.wait(input, call),
  };
  return {
    port,
    getAgentStatus,
    hasRunningWork: () => hasRunningWork("/root"),
    beforeModel: async (tools) => {
      if (!startup && !(await savedEntry())) {
        const configured = rootRuntime.config.subagents;
        const settings = CollaborationConfigSchema.parse({
          delegationMode: configured?.delegationMode,
          maxDepth: configured?.maxDepth,
          maxTotalAgents: configured?.maxTotalAgents,
          maxLoadedChildren: configured?.maxLoadedChildren,
        });
        return { entries: [], role: role(rootRuntime, "/root", tools, settings) };
      }
      return (await rootLinked()).beforeModel(tools);
    },
    userInputAccepted() {
      if (controller) {
        const root = snapshot.agents.find((record) => record.path === "/root")!;
        controller.steer(root.agentId);
      }
    },
    interruptChild: async (agentId) => (await rootLinked()).interruptChild(agentId),
    async shutdown() {
      if (!startup) return;
      // 初始化准入失败已由工具返回；没有创建 tree 就没有可关闭的共享执行资源。
      // 已建立 tree 的投影/持久错误仍由 dispose/awaitProjection 原样上抛。
      const tree = await startup.then(
        (created) => created,
        (error: unknown) => {
          if (controller) throw error;
          return undefined;
        },
      );
      if (!tree) return;
      await tree.dispose();
      await awaitProjection();
    },
    async flush() {
      if (startup) {
        await (await startup).flush();
        await awaitProjection();
      }
    },
  };
}
