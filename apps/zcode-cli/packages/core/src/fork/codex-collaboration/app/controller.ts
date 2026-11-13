import {
  CollaborationError,
  type AgentIdentity,
  type AgentRecord,
  type AgentStatus,
  type CollaborationController,
  type CollaborationMessage,
  type CollaborationRuntime,
  type CollaborationSnapshot,
  type CollaborationStorage,
  type ControllerOptions,
  type RunResult,
  type SpawnRequest,
  type TurnAdmission,
  type WaitResult,
} from "../contract.js";
import {
  identity,
  memoryStorage,
  parseCollaborationSnapshot,
  resolveAgent,
  validAgentPath,
  validTaskName,
} from "./snapshot.js";

import { normalizeAgentSettings, nonempty } from "./agent-settings.js";
import { ActivityWaiters } from "./activity-waiters.js";

const DEFAULT_TOTAL = 4;
const DEFAULT_LOADED = 3;
const DEFAULT_DEPTH = 1;
interface Loaded {
  runtime: CollaborationRuntime;
  abort?: AbortController;
}
function positive(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1)
    throw new CollaborationError("INVALID_INPUT", `${name} must be a positive integer`);
  return result;
}
function clone<T>(value: T): T {
  return structuredClone(value);
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function createCollaborationController(
  options: ControllerOptions,
): Promise<CollaborationController> {
  const storage =
    options.storage ?? (options.persistence === "memory" ? memoryStorage() : undefined);
  if (!storage || storage.mode !== options.persistence)
    throw new CollaborationError(
      "PERSISTENCE_REQUIRED",
      "Collaboration requires a matching explicit session entry storage capability",
    );
  const controller = new Controller(options, storage);
  await controller.initialize();
  return controller;
}

class Controller implements CollaborationController {
  private closingRequested = false;
  private state: CollaborationSnapshot;
  private readonly loaded = new Map<string, Loaded>();
  private readonly waiters: ActivityWaiters;
  private readonly projections = new Set<(snapshot: CollaborationSnapshot) => void>();
  private tail: Promise<void> = Promise.resolve();
  private readonly backgroundErrors: unknown[] = [];
  private readonly cleanupPending = new Map<
    string,
    { identity: AgentIdentity; runtime: CollaborationRuntime | undefined; discard: boolean }
  >();
  private readonly admissionCleanupPending = new Map<string, TurnAdmission>();
  private readonly pendingCompletions = new Map<
    string,
    { agentId: string; generation: number; result: RunResult }
  >();
  private closed = false;
  private shutdownSavePending = false;
  private readonly total: number;
  private readonly loadedLimit: number;
  private readonly depth: number;
  constructor(
    private readonly options: ControllerOptions,
    private readonly storage: CollaborationStorage,
  ) {
    this.waiters = new ActivityWaiters(options.clock);
    this.total = positive(options.maxTotalAgents, DEFAULT_TOTAL, "maxTotalAgents");
    this.loadedLimit = positive(options.maxLoadedChildren, DEFAULT_LOADED, "maxLoadedChildren");
    this.depth = positive(options.maxDepth, DEFAULT_DEPTH, "maxDepth");
    this.state = {
      version: 1,
      rootSessionId: options.root.childSessionId,
      agents: [{ ...clone(options.root), status: "idle", generation: 0, mailbox: [] }],
      accepted: [],
    };
    parseCollaborationSnapshot(this.state, options.root.childSessionId);
  }
  async initialize(): Promise<void> {
    let saved: unknown;
    try {
      saved = await this.storage.read();
    } catch (cause) {
      throw new CollaborationError(
        "STORAGE_FAILED",
        "Cannot read collaboration root entry",
        { phase: "read" },
        { cause },
      );
    }
    if (saved !== undefined) {
      this.state = parseCollaborationSnapshot(saved, this.options.root.childSessionId);
      const root = this.state.agents.find((agent) => agent.path === "/root")!;
      if (root.agentId !== this.options.root.agentId || root.traceId !== this.options.root.traceId)
        throw new CollaborationError(
          "INVALID_SNAPSHOT",
          "Restored root identity does not match the owning runtime",
        );
      // 崩溃前的 running 没有当前进程句柄，必须保留身份但转为可恢复中断态。
      for (const agent of this.state.agents)
        if (agent.status === "running") agent.status = "interrupted";
    }
    const unaccepted = this.state.agents.filter(
      (agent) =>
        agent.path !== "/root" &&
        !this.state.accepted.some((entry) => entry.agentId === agent.agentId),
    );
    for (const agent of unaccepted) await this.release(agent, true);
    this.state.agents = this.state.agents.filter((agent) => !unaccepted.includes(agent));
    await this.save(this.state);
    await this.options.rootRuntime.installMailbox();
    this.loaded.set(this.options.root.agentId, { runtime: this.options.rootRuntime });
  }
  private enqueue<T>(operation: () => Promise<T>, maintenance = false): Promise<T> {
    // 在 dispose 入队的同步边界封口；否则 child 可把消息排到 dispose 之后，形成释放等待环。
    if (this.closingRequested && !maintenance)
      return Promise.reject(
        new CollaborationError("CLOSED", "Collaboration controller is closing"),
      );
    const result = this.tail.then(() => {
      if (this.closed && !maintenance)
        throw new CollaborationError("CLOSED", "Collaboration controller is closed");
      return operation();
    });
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private async save(next: CollaborationSnapshot): Promise<void> {
    try {
      await this.storage.write(clone(next));
    } catch (cause) {
      throw new CollaborationError(
        "STORAGE_FAILED",
        "Cannot save collaboration root entry",
        { phase: "write", rootSessionId: next.rootSessionId },
        { cause },
      );
    }
    this.state = next;
    this.publish();
  }
  private record(callerId: string, target: string): AgentRecord {
    return resolveAgent(this.state.agents, callerId, target);
  }
  private notify(agentId: string, kind: "activity" | "steered" = "activity"): void {
    this.waiters.notify(agentId, kind);
  }
  private message(
    senderId: string,
    recipientId: string,
    text: string,
    kind: CollaborationMessage["kind"],
    callId?: string,
  ): CollaborationMessage {
    nonempty(text, "message");
    return {
      id: this.options.createId("message"),
      senderId,
      recipientId,
      text,
      kind,
      ...(callId ? { callId } : {}),
    };
  }
  private async queue(message: CollaborationMessage): Promise<void> {
    const next = clone(this.state);
    next.agents.find((agent) => agent.agentId === message.recipientId)!.mailbox.push(message);
    await this.save(next);
    this.notify(message.recipientId);
  }
  private runningCount(): number {
    return this.state.agents.filter((agent) => agent.path !== "/root" && agent.status === "running")
      .length;
  }
  private checkCapacity(): void {
    if (this.runningCount() >= this.total - 1)
      throw new CollaborationError(
        "CAPACITY",
        "All child execution slots are occupied (one slot is reserved for root)",
        { maxTotalAgents: this.total },
      );
  }
  private async ensureLoaded(agent: AgentRecord, resume: boolean): Promise<Loaded> {
    // 待释放句柄先完成清理，不能在旧 release 尚未结束时被新轮次复用。
    await this.retryCleanup(agent.agentId);
    const existing = this.loaded.get(agent.agentId);
    if (existing) return existing;
    if (this.loaded.size - 1 >= this.loadedLimit) {
      const victim = this.state.agents.find(
        (candidate) =>
          candidate.path !== "/root" &&
          candidate.status !== "running" &&
          this.loaded.has(candidate.agentId),
      );
      if (!victim)
        throw new CollaborationError("CAPACITY", "All loaded runtime slots are active", {
          maxLoadedChildren: this.loadedLimit,
        });
      await this.release(victim, false);
    }
    let runtime: CollaborationRuntime | undefined;
    try {
      runtime = await this.options.runtime.prepare(identity(agent), { resume });
      await runtime.installMailbox();
    } catch (cause) {
      // prepare 可能已登记资源、尚未返回端口；undefined 句柄也必须走同一可重试释放通道。
      {
        this.cleanupPending.set(agent.agentId, {
          identity: identity(agent),
          runtime,
          discard: !resume,
        });
        try {
          await this.release(agent, !resume);
        } catch (cleanupError) {
          throw new CollaborationError(
            "RUNTIME_FAILED",
            "Runtime prepare and cleanup failed",
            { phase: "prepare", agentId: agent.agentId, childSessionId: agent.childSessionId },
            {
              cause: new AggregateError(
                [cause, cleanupError],
                "Runtime preparation and resource release failed",
              ),
            },
          );
        }
      }
      throw new CollaborationError(
        "RUNTIME_FAILED",
        "Cannot prepare collaboration runtime",
        { agentId: agent.agentId, phase: "prepare", childSessionId: agent.childSessionId },
        { cause },
      );
    }
    const loaded = { runtime };
    this.loaded.set(agent.agentId, loaded);
    this.publish();
    return loaded;
  }
  private async release(agent: AgentRecord, discard: boolean): Promise<void> {
    const loaded = this.loaded.get(agent.agentId);
    const pending = this.cleanupPending.get(agent.agentId);
    if (!loaded && !pending && !discard) return;
    const cleanup = {
      identity: identity(agent),
      runtime: loaded?.runtime ?? pending?.runtime,
      discard,
    };
    if (this.admissionCleanupPending.has(agent.agentId)) {
      this.cleanupPending.set(agent.agentId, cleanup);
      this.loaded.delete(agent.agentId);
      return;
    }
    try {
      await this.options.runtime.release(cleanup.identity, cleanup.runtime, { discard });
    } catch (cause) {
      this.cleanupPending.set(agent.agentId, cleanup);
      if (discard) this.loaded.delete(agent.agentId);
      throw new CollaborationError(
        "RUNTIME_FAILED",
        "Cannot release collaboration runtime",
        { phase: "release", agentId: agent.agentId },
        { cause },
      );
    }
    this.completeRelease(agent.agentId);
  }
  private completeRelease(agentId: string): void {
    this.cleanupPending.delete(agentId);
    this.loaded.delete(agentId);
    this.publish();
  }
  spawn(request: SpawnRequest, options?: { signal?: AbortSignal }): Promise<AgentIdentity> {
    return this.enqueue(async () => {
      const caller = this.record(request.callerId, request.callerId);
      nonempty(request.callId, "callId");
      nonempty(request.message, "message");
      if (!validTaskName(request.taskName))
        throw new CollaborationError(
          "INVALID_INPUT",
          "taskName must contain lowercase letters, digits or underscores and cannot be root",
        );
      const settings = normalizeAgentSettings(request, caller);
      const fingerprint = JSON.stringify([
        request.callerId,
        request.taskName,
        request.message,
        settings,
      ]);
      const accepted = this.state.accepted.find(
        (entry) => entry.callId === request.callId && entry.callerId === request.callerId,
      );
      if (accepted) {
        if (accepted.fingerprint !== fingerprint)
          throw new CollaborationError(
            "CALL_ID_CONFLICT",
            "Accepted spawn call ID was reused with different arguments",
            { callId: request.callId },
          );
        return identity(this.record(request.callerId, accepted.agentId));
      }
      this.checkCancelled(options?.signal);
      const path = `${caller.path}/${request.taskName}`;
      if (path.split("/").length - 2 > this.depth)
        throw new CollaborationError("DEPTH", "Maximum collaboration depth exceeded", {
          maxDepth: this.depth,
        });
      if (this.state.agents.some((agent) => agent.path === path))
        throw new CollaborationError(
          "DUPLICATE_NAME",
          "Task name already exists under this parent",
          { path },
        );
      this.checkCapacity();
      const agent: AgentRecord = {
        agentId: this.options.createId("agent"),
        childSessionId: this.options.createId("session"),
        path,
        parentId: caller.agentId,
        traceId: caller.traceId,
        settings,
        generation: 0,
        status: "idle",
        mailbox: [],
      };
      const task = this.message(
        caller.agentId,
        agent.agentId,
        request.message,
        "NEW_TASK",
        request.callId,
      );
      agent.mailbox.push(task);
      const pending = clone(this.state);
      pending.agents.push(agent);
      parseCollaborationSnapshot(pending, this.state.rootSessionId);
      await this.save(pending);
      try {
        await this.start(agent, task, false, options?.signal, {
          callerId: request.callerId,
          callId: request.callId,
          fingerprint,
        });
        return identity(agent);
      } catch (cause) {
        // 接受之前的失败由临时所有者清理；接受之后不再观察父工具 signal。
        const cleanupErrors: unknown[] = [];
        try {
          await this.release(agent, true);
        } catch (error) {
          cleanupErrors.push(error);
        }
        const rollback = clone(this.state);
        rollback.agents = rollback.agents.filter(
          (candidate) => candidate.agentId !== agent.agentId,
        );
        try {
          await this.save(rollback);
        } catch (error) {
          cleanupErrors.push(error);
        }
        if (cleanupErrors.length)
          throw new CollaborationError(
            cause instanceof CollaborationError ? cause.code : "RUNTIME_FAILED",
            `Spawn failed and cleanup also failed for ${agent.path}`,
            { agentId: agent.agentId, phase: "spawn-cleanup" },
            {
              cause: new AggregateError(
                [cause, ...cleanupErrors],
                "Collaboration spawn and cleanup failures",
              ),
            },
          );
        throw cause;
      }
    });
  }
  private checkCancelled(signal?: AbortSignal): void {
    if (signal?.aborted)
      throw new CollaborationError(
        "CANCELLED",
        "Spawn caller cancelled before acceptance",
        {},
        { cause: signal.reason },
      );
  }
  private async start(
    agent: AgentRecord,
    task: CollaborationMessage,
    resume: boolean,
    callerSignal?: AbortSignal,
    accepted?: { callerId: string; callId: string; fingerprint: string },
  ): Promise<void> {
    this.checkCapacity();
    const loaded = await this.ensureLoaded(agent, resume);
    this.checkCancelled(callerSignal);
    // 所有旧消息先按 FIFO 交付；本轮 task 本身由 admit 持久接纳，不能重复注入。
    await this.drain(agent.agentId, task.id);
    const abort = new AbortController();
    const generation = this.record(agent.agentId, agent.agentId).generation + 1;
    let admission: TurnAdmission;
    try {
      admission = await loaded.runtime.admit({
        task: clone(task),
        generation,
        signal: abort.signal,
      });
    } catch (cause) {
      throw new CollaborationError(
        "RUNTIME_FAILED",
        "Collaboration task admission failed",
        { phase: "admit", agentId: agent.agentId, generation },
        { cause },
      );
    }
    try {
      this.checkCancelled(callerSignal);
      const next = clone(this.state);
      const record = next.agents.find((candidate) => candidate.agentId === agent.agentId)!;
      record.generation = generation;
      record.status = "running";
      delete record.lastError;
      record.mailbox = record.mailbox.filter((message) => message.id !== task.id);
      if (accepted) next.accepted.push({ ...accepted, agentId: agent.agentId });
      await this.save(next);
    } catch (cause) {
      // 清理失败也不能遗留活跃 signal，且不得覆盖触发保存失败的原始错误。
      abort.abort(cause);
      try {
        await admission.cancel();
      } catch (cleanupError) {
        this.admissionCleanupPending.set(agent.agentId, admission);
        throw new CollaborationError(
          cause instanceof CollaborationError ? cause.code : "RUNTIME_FAILED",
          "Task acceptance and admission cleanup failed",
          { phase: "admission-cleanup", agentId: agent.agentId, generation },
          {
            cause: new AggregateError(
              [cause, cleanupError],
              "Acceptance and admission cancellation failed",
            ),
          },
        );
      }
      throw cause;
    }
    loaded.abort = abort;
    // 持久接受后 run 的同步抛错也作为该 generation 的终态，不回滚已接受身份。
    const completion = Promise.resolve().then(() => admission.run());
    void completion.then(
      (result) => {
        this.complete(agent.agentId, generation, result);
      },
      (error: unknown) => {
        this.complete(agent.agentId, generation, { status: "errored", text: errorText(error) });
      },
    );
  }
  private complete(agentId: string, generation: number, result: RunResult): void {
    if (this.closed) return;
    if (
      !result ||
      !["completed", "errored", "waiting"].includes(result.status) ||
      typeof result.text !== "string"
    ) {
      result = {
        status: "errored",
        text: "Invalid runtime completion: expected completed/errored/waiting status and string text",
      };
    }
    this.pendingCompletions.set(`${agentId}:${generation}`, { agentId, generation, result });
    void this.finish(agentId, generation, result).catch((error: unknown) => {
      if (!this.closed) this.backgroundErrors.push(error);
    });
  }
  private async finish(agentId: string, generation: number, result: RunResult): Promise<void> {
    return this.enqueue(async () => {
      const agent = this.record(agentId, agentId);
      if (agent.generation !== generation || agent.status !== "running") {
        this.pendingCompletions.delete(`${agentId}:${generation}`);
        return;
      }
      const next = clone(this.state);
      const record = next.agents.find((candidate) => candidate.agentId === agentId)!;
      record.status = result.status;
      if (result.status === "waiting") {
        await this.save(next);
        this.pendingCompletions.delete(`${agentId}:${generation}`);
        const loaded = this.loaded.get(agentId);
        if (loaded) delete loaded.abort;
        return;
      }
      if (result.status === "errored") record.lastError = result.text;
      const callId = next.accepted.find((entry) => entry.agentId === agentId)?.callId;
      const parent = next.agents.find((candidate) => candidate.agentId === record.parentId)!;
      parent.mailbox.push(
        this.message(
          agentId,
          parent.agentId,
          result.text || result.status,
          result.status === "completed" ? "FINAL_ANSWER" : "STATUS",
          callId,
        ),
      );
      await this.save(next);
      this.pendingCompletions.delete(`${agentId}:${generation}`);
      const loaded = this.loaded.get(agentId);
      if (loaded) delete loaded.abort;
      this.notify(parent.agentId);
      this.notify(agentId);
      // 完成必须主动交付，不能依赖父代理再发一次模型请求才取邮箱。
      const completion = parent.mailbox.at(-1)!;
      if (parent.path !== "/root" && parent.status !== "running")
        await this.start(parent, completion, true);
      else await this.drain(parent.agentId);
    });
  }
  send(callerId: string, target: string, text: string): Promise<void> {
    return this.enqueue(async () => {
      const agent = this.record(callerId, target);
      const message = this.message(callerId, agent.agentId, text, "MESSAGE");
      await this.queue(message);
      if (agent.status === "waiting") await this.start(agent, message, true);
      else if (agent.status === "running" || agent.path === "/root")
        await this.drain(agent.agentId);
    });
  }
  followup(callerId: string, target: string, text: string): Promise<void> {
    return this.enqueue(async () => {
      const agent = this.record(callerId, target);
      if (agent.path === "/root")
        throw new CollaborationError("FORBIDDEN", "followup cannot target root");
      if (agent.status !== "running") this.checkCapacity();
      const task = this.message(callerId, agent.agentId, text, "NEW_TASK");
      await this.queue(task);
      if (agent.status === "running") await this.drain(agent.agentId);
      else await this.start(agent, task, true);
    });
  }
  interrupt(
    callerId: string,
    target: string,
  ): Promise<{ previousStatus: AgentStatus | "not_found" }> {
    return this.enqueue(async () => {
      const agent = this.record(callerId, target);
      if (agent.path === "/root" || agent.agentId === callerId)
        throw new CollaborationError("FORBIDDEN", "interrupt cannot target root or self");
      const loaded = this.loaded.get(agent.agentId);
      if (!loaded) return { previousStatus: "not_found" };
      const previousStatus = agent.status;
      if (agent.status === "running" || agent.status === "waiting") {
        const next = clone(this.state);
        next.agents.find((candidate) => candidate.agentId === agent.agentId)!.status =
          "interrupted";
        const parent = next.agents.find((candidate) => candidate.agentId === agent.parentId)!;
        parent.mailbox.push(this.message(agent.agentId, parent.agentId, "interrupted", "STATUS"));
        await this.save(next);
        loaded.abort?.abort(
          new CollaborationError("CANCELLED", "Target agent interrupted", {
            agentId: agent.agentId,
          }),
        );
        delete loaded.abort;
        this.notify(agent.agentId);
        if (agent.parentId) this.notify(agent.parentId);
      }
      return { previousStatus };
    });
  }
  private async drain(agentId: string, beforeId?: string): Promise<void> {
    await this.retryCleanup(agentId);
    const loaded = this.loaded.get(agentId);
    if (!loaded) return;
    for (;;) {
      const message = this.record(agentId, agentId).mailbox[0];
      if (!message || message.id === beforeId) return;
      try {
        const ack = await loaded.runtime.deliver(clone(message));
        if (ack.messageId !== message.id)
          throw new Error(`Unexpected message ACK ${ack.messageId}`);
      } catch (cause) {
        throw new CollaborationError(
          "DELIVERY_FAILED",
          "Mailbox ownership transfer failed; message retained",
          { agentId, messageId: message.id, phase: "deliver" },
          { cause },
        );
      }
      const next = clone(this.state);
      next.agents.find((agent) => agent.agentId === agentId)!.mailbox.shift();
      await this.save(next);
    }
  }
  deliver(callerId: string, target: string): Promise<void> {
    return this.enqueue(async () => {
      await this.drain(this.record(callerId, target).agentId);
    });
  }
  unload(callerId: string, target: string): Promise<void> {
    return this.enqueue(async () => {
      const agent = this.record(callerId, target);
      if (agent.path === "/root" || agent.status === "running")
        throw new CollaborationError("FORBIDDEN", "Only an idle child runtime can be unloaded");
      await this.release(agent, false);
    });
  }
  private publish(listener?: (snapshot: CollaborationSnapshot) => void): void {
    for (const observe of listener ? [listener] : this.projections) {
      try {
        observe(clone(this.state));
      } catch (cause) {
        this.backgroundErrors.push(
          new CollaborationError(
            "RUNTIME_FAILED",
            "Collaboration projection failed",
            { phase: "projection" },
            { cause },
          ),
        );
      }
    }
  }
  subscribe(listener: (snapshot: CollaborationSnapshot) => void): () => void {
    if (this.closed) throw new CollaborationError("CLOSED", "Collaboration controller is closed");
    this.projections.add(listener);
    this.publish(listener);
    return () => {
      this.projections.delete(listener);
    };
  }
  get(callerId: string, target: string): AgentRecord {
    return clone(this.record(callerId, target));
  }
  list(callerId: string, pathPrefix?: string): AgentRecord[] {
    this.record(callerId, callerId);
    const prefix = pathPrefix ?? "/root";
    if (!validAgentPath(prefix))
      throw new CollaborationError("INVALID_INPUT", "pathPrefix must be canonical");
    return clone(
      this.state.agents
        .filter(
          (agent) =>
            this.loaded.has(agent.agentId) &&
            (agent.path === prefix || agent.path.startsWith(`${prefix}/`)),
        )
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    );
  }
  wait(
    callerId: string,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<WaitResult> {
    try {
      this.record(callerId, callerId);
      if (this.closed) throw new CollaborationError("CLOSED", "Collaboration controller is closed");
      return this.waiters.wait(
        callerId,
        // ACK 后邮件已转交 driver；先订阅再同时读两段队列，防止模型稍后 wait 丢失早到通知。
        () =>
          this.record(callerId, callerId).mailbox.length > 0 ||
          this.loaded.get(callerId)?.runtime.hasUnreadMessages() === true,
        options,
      );
    } catch (error) {
      return Promise.reject(error);
    }
  }
  steer(agentId: string): void {
    this.record(agentId, agentId);
    this.notify(agentId, "steered");
  }
  async flush(): Promise<void> {
    // Promise settlement may enqueue its completion in the next microtask.
    await Promise.resolve();
    await this.tail;
    await Promise.resolve();
    await this.tail;
    await Promise.resolve();
    if (this.backgroundErrors.length) throw this.backgroundErrors.shift();
    for (const pending of Array.from(this.pendingCompletions.values()))
      await this.finish(pending.agentId, pending.generation, pending.result);
    await this.enqueue(async () => {
      for (const agentId of new Set([
        ...this.admissionCleanupPending.keys(),
        ...this.cleanupPending.keys(),
      ]))
        await this.retryCleanup(agentId);
      if (this.shutdownSavePending) {
        await this.save(this.state);
        this.shutdownSavePending = false;
      }
    }, true);
  }
  /** Called only inside the command lane; a pending handle cannot serve new admission. */
  private async retryCleanup(agentId: string): Promise<void> {
    const admission = this.admissionCleanupPending.get(agentId);
    if (admission) {
      try {
        await admission.cancel();
      } catch (cause) {
        throw new CollaborationError(
          "RUNTIME_FAILED",
          "Cannot retry admission cleanup",
          { agentId, phase: "admission-cleanup-retry" },
          { cause },
        );
      }
      this.admissionCleanupPending.delete(agentId);
    }
    const pending = this.cleanupPending.get(agentId);
    if (pending) {
      try {
        await this.options.runtime.release(pending.identity, pending.runtime, {
          discard: pending.discard,
        });
      } catch (cause) {
        throw new CollaborationError(
          "RUNTIME_FAILED",
          "Cannot retry collaboration runtime cleanup",
          { agentId, phase: "cleanup-retry" },
          { cause },
        );
      }
      this.completeRelease(agentId);
    }
  }
  dispose(): Promise<void> {
    this.closingRequested = true;
    return this.enqueue(async () => {
      // 宿主关闭先封住普通准入并停止所有轮次；不能让持久化失败阻止资源回收。
      this.closed = true;
      const next = clone(this.state);
      const errors: unknown[] = [];
      for (const agent of next.agents) if (agent.status === "running") agent.status = "interrupted";
      for (const [agentId, loaded] of this.loaded)
        if (agentId !== this.options.root.agentId) loaded.abort?.abort();
      try {
        await this.save(next);
        this.shutdownSavePending = false;
      } catch (error) {
        this.state = next;
        this.shutdownSavePending = true;
        errors.push(error);
      }
      this.pendingCompletions.clear();
      const resources = new Set([
        ...next.agents.filter((agent) => agent.path !== "/root").map((agent) => agent.agentId),
        ...this.cleanupPending.keys(),
        ...this.admissionCleanupPending.keys(),
      ]);
      for (const agentId of resources) {
        try {
          const agent = next.agents.find((candidate) => candidate.agentId === agentId);
          if (agent) await this.release(agent, false);
          await this.retryCleanup(agentId);
        } catch (error) {
          errors.push(error);
        }
      }
      this.waiters.close();
      this.projections.clear();
      if (errors.length)
        throw new CollaborationError(
          "RUNTIME_FAILED",
          "Collaboration shutdown failed; cleanup remains retryable",
          { phase: "dispose" },
          { cause: new AggregateError(errors, "Collaboration shutdown failures") },
        );
    }, true);
  }
}
