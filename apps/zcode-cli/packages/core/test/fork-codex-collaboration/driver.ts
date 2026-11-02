import { createCollaborationController } from "../../src/fork/codex-collaboration/module.js";
import type {
  AgentIdentity,
  CollaborationMessage,
  CollaborationRuntime,
  CollaborationSnapshot,
  ControllerOptions,
  RunResult,
  TurnAdmission,
} from "../../src/fork/codex-collaboration/contract.js";
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export function fixture(config: Partial<ControllerOptions> = {}) {
  let id = 0;
  let snapshot: unknown;
  const events: string[] = [];
  const turns: {
    identity: AgentIdentity;
    signal: AbortSignal;
    result: ReturnType<typeof deferred<RunResult>>;
    task: CollaborationMessage;
  }[] = [];
  const histories = new Map<string, string[]>();
  const timers = new Set<() => void>();
  let deliveryFailure = false;
  let admissionFailure = false;
  let writeFailure = false;
  let prepareGate: Promise<void> | undefined;
  const runtime = (identity: AgentIdentity): CollaborationRuntime => ({
    hasUnreadMessages: () => false,
    async installMailbox() {
      events.push(`sink:${identity.path}`);
    },
    async deliver(message) {
      if (deliveryFailure) throw new Error("disk transcript unavailable");
      const history = histories.get(identity.childSessionId)!;
      if (!history.includes(message.id)) history.push(message.id);
      events.push(`ack:${message.text}`);
      return { messageId: message.id };
    },
    async admit({ task, generation, signal }): Promise<TurnAdmission> {
      events.push(`admit:${identity.path}:${generation}`);
      if (admissionFailure) throw new Error("admission denied");
      const history = histories.get(identity.childSessionId)!;
      if (!history.includes(task.id)) history.push(task.id);
      const result = deferred<RunResult>();
      return {
        run() {
          events.push(`run:${identity.path}`);
          turns.push({ identity, signal, result, task });
          return result.promise;
        },
        async cancel() {
          events.push(`cancel:${identity.path}`);
        },
      };
    },
  });
  const root: AgentIdentity = {
    agentId: "root-id",
    childSessionId: "root-session",
    path: "/root",
    traceId: "trace-root",
    settings: { forkTurns: "all" },
  };
  histories.set(root.childSessionId, []);
  const options: ControllerOptions = {
    root,
    rootRuntime: runtime(root),
    persistence: "persistent",
    storage: {
      mode: "persistent",
      async read() {
        return structuredClone(snapshot);
      },
      async write(value) {
        events.push(`save:${value.agents.length}:${value.accepted.length}`);
        if (writeFailure) throw new Error("entry unavailable");
        snapshot = structuredClone(value);
      },
    },
    runtime: {
      async prepare(identity, { resume }) {
        events.push(`prepare:${identity.path}:${resume}`);
        if (prepareGate) await prepareGate;
        if (resume && !histories.has(identity.childSessionId))
          throw new Error("missing transcript");
        if (!resume) histories.set(identity.childSessionId, []);
        return runtime(identity);
      },
      async release(identity, _handle, { discard }) {
        events.push(`release:${identity.path}:${discard}`);
        if (discard) histories.delete(identity.childSessionId);
      },
    },
    clock: {
      schedule(delay, callback) {
        events.push(`timer:${delay}`);
        timers.add(callback);
        return () => {
          timers.delete(callback);
        };
      },
    },
    createId: (kind) => `${kind}-${++id}`,
    ...config,
  };
  return {
    options,
    events,
    turns,
    histories,
    timers,
    snapshot: () => structuredClone(snapshot) as CollaborationSnapshot,
    setSnapshot: (value: unknown) => {
      snapshot = value;
    },
    failDelivery: (value: boolean) => {
      deliveryFailure = value;
    },
    failAdmission: (value: boolean) => {
      admissionFailure = value;
    },
    failWrite: (value: boolean) => {
      writeFailure = value;
    },
    gatePrepare: (value: Promise<void> | undefined) => {
      prepareGate = value;
    },
    spawn: { callerId: root.agentId, callId: "call-1", taskName: "worker", message: "work" },
  };
}

export async function setup(config: Partial<ControllerOptions> = {}) {
  const f = fixture(config);
  const controller = await createCollaborationController(f.options);
  return { ...f, controller };
}
