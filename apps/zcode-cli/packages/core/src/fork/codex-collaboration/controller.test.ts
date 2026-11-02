import { describe, expect, it } from "vitest";
import { createCollaborationController, parseCollaborationSnapshot } from "./module.js";
import type {
  AgentIdentity,
  CollaborationMessage,
  CollaborationRuntime,
  CollaborationSnapshot,
  ControllerOptions,
  RunResult,
  TurnAdmission,
} from "./contract.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(config: Partial<ControllerOptions> = {}) {
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

async function setup(config: Partial<ControllerOptions> = {}) {
  const f = fixture(config);
  const controller = await createCollaborationController(f.options);
  return { ...f, controller };
}

describe("root-owned collaboration controller", () => {
  it("creates one root owner and persists identity before sink/admission/accepted/run", async () => {
    const f = await setup();
    const child = await f.controller.spawn(f.spawn);
    expect(child.path).toBe("/root/worker");
    expect(f.events.slice(-6)).toEqual([
      "save:2:0",
      "prepare:/root/worker:false",
      "sink:/root/worker",
      "admit:/root/worker:1",
      "save:2:1",
      "run:/root/worker",
    ]);
    expect(f.turns[0].signal.aborted).toBe(false);
    expect(f.snapshot().agents[1].mailbox).toEqual([]);
  });
  it("deduplicates call IDs even after caller abort and cold restore", async () => {
    const f = await setup();
    const abort = new AbortController();
    const child = await f.controller.spawn(f.spawn, { signal: abort.signal });
    abort.abort();
    expect(f.turns[0].signal.aborted).toBe(false);
    expect(await f.controller.spawn(f.spawn)).toEqual(child);
    expect(f.turns).toHaveLength(1);
    await expect(f.controller.spawn({ ...f.spawn, message: "different" })).rejects.toMatchObject({
      code: "CALL_ID_CONFLICT",
    });
    const restored = await createCollaborationController(f.options);
    expect(await restored.spawn(f.spawn)).toEqual(child);
    expect(restored.get("root-id", child.agentId).status).toBe("interrupted");
  });
  it("queues idle messages, retains failed ACK, and transfers FIFO only once on retry", async () => {
    const f = await setup();
    const child = await f.controller.spawn(f.spawn);
    f.turns[0].result.resolve({ status: "completed", text: "answer" });
    await f.controller.flush();
    f.failDelivery(true);
    await f.controller.send("root-id", child.agentId, "first");
    await f.controller.send("root-id", child.path, "second");
    expect(f.turns).toHaveLength(1);
    await expect(f.controller.deliver("root-id", child.path)).rejects.toMatchObject({
      code: "DELIVERY_FAILED",
    });
    expect(f.controller.get("root-id", child.path).mailbox.map((m) => m.text)).toEqual([
      "first",
      "second",
    ]);
    f.failDelivery(false);
    await f.controller.deliver("root-id", child.path);
    expect(f.events.filter((e) => e === "ack:first" || e === "ack:second")).toEqual([
      "ack:first",
      "ack:second",
    ]);
    expect(f.controller.get("root-id", child.path).mailbox).toEqual([]);
  });
  it("running send delivers without another turn and terminal notifies direct parent", async () => {
    const f = await setup();
    const child = await f.controller.spawn(f.spawn);
    await f.controller.send("root-id", child.path, "guide");
    expect(f.turns).toHaveLength(1);
    expect(f.events).toContain("ack:guide");
    f.turns[0].result.resolve({ status: "completed", text: "final text" });
    await f.controller.flush();
    expect(f.controller.get("root-id", "/root").mailbox).toMatchObject([
      { kind: "FINAL_ANSWER", senderId: child.agentId, text: "final text", callId: "call-1" },
    ]);
  });
  it("resumes errors and interruptions using same session/history and fresh run signal", async () => {
    const f = await setup();
    const child = await f.controller.spawn(f.spawn);
    f.turns[0].result.reject(new Error("API exhausted"));
    await f.controller.flush();
    expect(f.controller.get("root-id", child.path)).toMatchObject({
      status: "errored",
      lastError: "API exhausted",
    });
    await f.controller.followup("root-id", child.path, "continue");
    expect(f.turns[1].identity.childSessionId).toBe(child.childSessionId);
    await f.controller.interrupt("root-id", child.agentId);
    expect(f.turns[1].signal.aborted).toBe(true);
    await f.controller.followup("root-id", child.path, "retry");
    expect(f.turns[2].signal.aborted).toBe(false);
    f.turns[1].result.resolve({ status: "completed", text: "stale" });
    await f.controller.flush();
    expect(f.controller.get("root-id", child.path).status).toBe("running");
    expect(f.histories.get(child.childSessionId)).toHaveLength(3);
    expect(f.controller.get("root-id", "/root").mailbox.some((m) => m.text === "stale")).toBe(
      false,
    );
  });
  it("reserves root slot, shares nested capacity, and unloads idle runtimes without identity loss", async () => {
    const f = await setup({ maxDepth: 2, maxLoadedChildren: 2, maxTotalAgents: 3 });
    const a = await f.controller.spawn(f.spawn);
    const b = await f.controller.spawn({
      callerId: a.agentId,
      callId: "nested",
      taskName: "nested",
      message: "nested",
    });
    await expect(
      f.controller.spawn({ ...f.spawn, callId: "third", taskName: "third" }),
    ).rejects.toMatchObject({ code: "CAPACITY" });
    f.turns[0].result.resolve({ status: "completed", text: "a done" });
    await f.controller.flush();
    await f.controller.send("root-id", a.agentId, "retained");
    const c = await f.controller.spawn({ ...f.spawn, callId: "third", taskName: "third" });
    expect(f.controller.list("root-id").map((v) => v.path)).toEqual(["/root", c.path, b.path]);
    expect(f.controller.get("root-id", a.agentId).mailbox[0].text).toBe("retained");
    expect(await f.controller.interrupt("root-id", a.agentId)).toEqual({
      previousStatus: "not_found",
    });
    await f.controller.interrupt("root-id", c.agentId);
    await f.controller.followup("root-id", a.agentId, "restore");
    expect(f.events).toContain("prepare:/root/worker:true");
    expect(f.turns.at(-1)!.identity.childSessionId).toBe(a.childSessionId);
  });
  it.each(["root", "Upper", "a-b", "", "a/b", ".", ".."])(
    "rejects invalid task name %s",
    async (taskName) => {
      const f = await setup();
      await expect(f.controller.spawn({ ...f.spawn, taskName })).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    },
  );
  it("enforces tree paths, depth and protected root/self targets", async () => {
    const f = await setup();
    const child = await f.controller.spawn(f.spawn);
    expect(f.controller.get(child.agentId, "/root/worker").agentId).toBe(child.agentId);
    expect(f.controller.get("root-id", "worker").agentId).toBe(child.agentId);
    for (const path of ["/other/worker", "/root/worker/", "/root//worker", "../worker", "."]) {
      expect(() => f.controller.get("root-id", path)).toThrow();
    }
    await expect(
      f.controller.spawn({ ...f.spawn, callerId: child.agentId, callId: "deep" }),
    ).rejects.toMatchObject({ code: "DEPTH" });
    await expect(f.controller.interrupt(child.agentId, child.agentId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(f.controller.interrupt(child.agentId, "root-id")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(f.controller.followup(child.agentId, "/root", "x")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("cleans unaccepted admission failures and rejects missing persistence explicitly", async () => {
    const f = await setup();
    f.failAdmission(true);
    await expect(f.controller.spawn(f.spawn)).rejects.toMatchObject({
      code: "RUNTIME_FAILED",
      cause: { message: "admission denied" },
    });
    expect(f.controller.list("root-id")).toHaveLength(1);
    expect(f.snapshot().agents).toHaveLength(1);
    expect(f.events).toContain("release:/root/worker:true");
    f.failAdmission(false);
    await expect(f.controller.spawn(f.spawn)).resolves.toMatchObject({ path: "/root/worker" });
    await expect(
      createCollaborationController({ ...f.options, storage: undefined }),
    ).rejects.toMatchObject({ code: "PERSISTENCE_REQUIRED" });
  });
  it("does not execute when accepted-state persistence fails", async () => {
    const f = await setup();
    const storage = f.options.storage!;
    const original = storage.write;
    storage.write = async (snapshot) => {
      if (snapshot.accepted.length > 0) throw new Error("accept write failed");
      await original(snapshot);
    };
    await expect(f.controller.spawn(f.spawn)).rejects.toMatchObject({ code: "STORAGE_FAILED" });
    expect(f.turns).toHaveLength(0);
    expect(f.events).toContain("cancel:/root/worker");
    expect(f.snapshot().agents).toHaveLength(1);
  });
  it("cancels before acceptance but detaches caller abort at durable acceptance", async () => {
    const f = await setup();
    const gate = deferred<void>();
    f.gatePrepare(gate.promise);
    const abort = new AbortController();
    const pending = f.controller.spawn(f.spawn, { signal: abort.signal });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    abort.abort();
    gate.resolve();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(f.turns).toHaveLength(0);
    expect(f.snapshot().agents).toHaveLength(1);
  });
  it("wait clamps timeout, subscribes before checking and steer never aborts children", async () => {
    const f = await setup();
    const child = await f.controller.spawn(f.spawn);
    const waiting = f.controller.wait("root-id", { timeoutMs: 2 });
    f.controller.steer("root-id");
    await expect(waiting).resolves.toMatchObject({ reason: "steered", timeoutMs: 10000 });
    expect(f.turns[0].signal.aborted).toBe(false);
    expect(f.timers.size).toBe(0);
    await expect(f.controller.wait("root-id", { timeoutMs: 3600001 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    const timed = f.controller.wait("root-id");
    for (const timer of f.timers) timer();
    await expect(timed).resolves.toMatchObject({ timedOut: true, timeoutMs: 30000 });
    const waiter = f.controller.wait(child.agentId);
    await f.controller.send("root-id", child.agentId, "wake before ACK");
    await expect(waiter).resolves.toMatchObject({ reason: "activity" });
  });
  it("rejects corrupt/versioned/root-mismatched snapshots and recovers stable child history", async () => {
    const f = await setup();
    const child = await f.controller.spawn(f.spawn);
    const valid = f.snapshot();
    expect(parseCollaborationSnapshot(valid, "root-session")).toEqual(valid);
    for (const value of [
      { ...valid, version: 2 },
      { ...valid, rootSessionId: "other" },
      { ...valid, agents: [...valid.agents, valid.agents[1]] },
      { ...valid, agents: valid.agents.map((a, i) => (i ? { ...a, parentId: "unknown" } : a)) },
      { ...valid, accepted: [{ callId: "x", fingerprint: "x", agentId: "unknown" }] },
    ])
      expect(() => parseCollaborationSnapshot(value, "root-session")).toThrow();
    const restored = await createCollaborationController(f.options);
    await restored.followup("root-id", child.agentId, "cold resume");
    expect(f.turns.at(-1)!.identity.childSessionId).toBe(child.childSessionId);
    expect(f.histories.get(child.childSessionId)).toHaveLength(2);
    f.setSnapshot({ version: 50 });
    await expect(createCollaborationController(f.options)).rejects.toMatchObject({
      code: "INVALID_SNAPSHOT",
    });
  });
  it("keeps acceptance when caller aborts while the accepted snapshot is saving", async () => {
    const f = await setup();
    const abort = new AbortController();
    const storage = f.options.storage!;
    const original = storage.write;
    storage.write = async (snapshot) => {
      if (snapshot.accepted.length) abort.abort("caller left during durable save");
      await original(snapshot);
    };
    const child = await f.controller.spawn(f.spawn, { signal: abort.signal });
    expect(f.controller.get("root-id", child.agentId).status).toBe("running");
    expect(f.turns[0].signal.aborted).toBe(false);
  });
  it("retains a message after ACK save failure and retries the same idempotent message ID", async () => {
    const f = await setup();
    const child = await f.controller.spawn(f.spawn);
    f.turns[0].result.resolve({ status: "completed", text: "done" });
    await f.controller.flush();
    await f.controller.send("root-id", child.path, "one");
    const before = f.histories.get(child.childSessionId)!.length;
    f.failWrite(true);
    await expect(f.controller.deliver("root-id", child.path)).rejects.toMatchObject({
      code: "STORAGE_FAILED",
    });
    const retainedId = f.controller.get("root-id", child.path).mailbox[0].id;
    f.failWrite(false);
    await f.controller.deliver("root-id", child.path);
    expect(f.histories.get(child.childSessionId)!.filter((id) => id === retainedId)).toHaveLength(
      1,
    );
    expect(f.histories.get(child.childSessionId)).toHaveLength(before + 1);
  });
  it("removes cold unaccepted reservations without executing or loading a runtime", async () => {
    const f = await setup();
    const gate = deferred<void>();
    f.gatePrepare(gate.promise);
    const spawn = f.controller.spawn(f.spawn);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const pending = f.snapshot();
    expect(pending.agents).toHaveLength(2);
    expect(pending.accepted).toHaveLength(0);
    const cold = fixture();
    cold.setSnapshot(pending);
    const restored = await createCollaborationController(cold.options);
    expect(cold.snapshot().agents).toHaveLength(1);
    expect(cold.turns).toHaveLength(0);
    expect(cold.events.some((event) => event.startsWith("prepare:"))).toBe(false);
    expect(cold.events).toContain("release:/root/worker:true");
    gate.resolve();
    await spawn;
    await expect(restored.spawn(cold.spawn)).resolves.toMatchObject({ path: "/root/worker" });
  });
  it("lists loaded tree paths in canonical order and returns Codex wait texts", async () => {
    const f = await setup();
    await f.controller.spawn({ ...f.spawn, taskName: "z" });
    await f.controller.spawn({ ...f.spawn, taskName: "a", callId: "a" });
    expect(f.controller.list("root-id").map((a) => a.path)).toEqual([
      "/root",
      "/root/a",
      "/root/z",
    ]);
    const waiting = f.controller.wait("root-id");
    f.controller.steer("root-id");
    await expect(waiting).resolves.toMatchObject({ message: "Wait interrupted by new input." });
    const timed = f.controller.wait("root-id");
    for (const timer of f.timers) timer();
    await expect(timed).resolves.toMatchObject({ message: "Wait timed out." });
    await f.controller.send("root-id", "/root", "unread");
    await expect(f.controller.wait("root-id")).resolves.toMatchObject({
      message: "Wait completed.",
    });
  });
  it("keeps wait cancellation local, removes timers, and explicitly closes all resources", async () => {
    const f = await setup();
    const child = await f.controller.spawn(f.spawn);
    const abort = new AbortController();
    const waiting = f.controller.wait("root-id", { signal: abort.signal });
    abort.abort("wait abandoned");
    await expect(waiting).rejects.toMatchObject({ code: "CANCELLED" });
    expect(f.timers.size).toBe(0);
    expect(f.turns[0].signal.aborted).toBe(false);
    await f.controller.dispose();
    expect(f.turns[0].signal.aborted).toBe(true);
    expect(f.controller.get("root-id", child.agentId).status).toBe("interrupted");
    await expect(f.controller.send("root-id", child.path, "late")).rejects.toMatchObject({
      code: "CLOSED",
    });
  });
  it("propagates schema corruption instead of silently treating a null entry as absent", async () => {
    const f = fixture();
    f.setSnapshot(null);
    await expect(createCollaborationController(f.options)).rejects.toMatchObject({
      code: "INVALID_SNAPSHOT",
    });
  });
  it("validates run terminal results at the driver boundary", async () => {
    const f = await setup();
    const child = await f.controller.spawn(f.spawn);
    f.turns[0].result.resolve({ status: "completed", text: 42 } as unknown as RunResult);
    await f.controller.flush();
    expect(f.controller.get("root-id", child.agentId)).toMatchObject({ status: "errored" });
    expect(f.controller.get("root-id", child.agentId).lastError).toContain(
      "Invalid runtime completion",
    );
  });
  it("retains asynchronous terminal persistence failure for explicit retry and releases the slot", async () => {
    const f = await setup({ maxTotalAgents: 2 });
    const child = await f.controller.spawn(f.spawn);
    f.failWrite(true);
    f.turns[0].result.resolve({ status: "completed", text: "durable result" });
    await expect(f.controller.flush()).rejects.toMatchObject({ code: "STORAGE_FAILED" });
    f.failWrite(false);
    await f.controller.flush();
    expect(f.controller.get("root-id", child.agentId).status).toBe("completed");
    expect(f.controller.get("root-id", "/root").mailbox).toMatchObject([
      { text: "durable result" },
    ]);
    await expect(
      f.controller.spawn({ ...f.spawn, taskName: "next", callId: "next" }),
    ).resolves.toMatchObject({ path: "/root/next" });
  });

  it("reports original failure and cleanup failures together without retaining unaccepted identity", async () => {
    const f = await setup();
    f.failAdmission(true);
    f.options.runtime.release = async () => {
      throw new Error("cleanup unavailable");
    };
    await expect(f.controller.spawn(f.spawn)).rejects.toMatchObject({
      code: "RUNTIME_FAILED",
      cause: {
        errors: [
          { cause: { message: "admission denied" } },
          { cause: { message: "cleanup unavailable" } },
        ],
      },
    });
    expect(f.controller.list("root-id")).toHaveLength(1);
    expect(f.snapshot().agents).toHaveLength(1);
  });
  it("rejects unknown snapshot fields and malformed settings rather than changing their meaning", async () => {
    const f = await setup();
    await f.controller.spawn(f.spawn);
    const valid = f.snapshot();
    for (const value of [
      { ...valid, unexpected: true },
      { ...valid, agents: valid.agents.map((agent) => ({ ...agent, unexpected: true })) },
      {
        ...valid,
        agents: valid.agents.map((agent) => ({
          ...agent,
          settings: { forkTurns: "all", model: 12 },
        })),
      },
      {
        ...valid,
        agents: valid.agents.map((agent) => ({
          ...agent,
          settings: { forkTurns: "all", permissionMode: "bypass" },
        })),
      },
    ])
      expect(() => parseCollaborationSnapshot(value, "root-session")).toThrowError(
        /Invalid collaboration snapshot/,
      );
  });
  it("rejects unknown spawn settings before any durable or runtime mutation", async () => {
    const f = await setup();
    const count = f.events.length;
    await expect(
      f.controller.spawn({
        ...f.spawn,
        settings: {
          forkTurns: "all",
          permissionMode: "bypass",
        } as unknown as AgentIdentity["settings"],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(f.events).toHaveLength(count);
  });
  it("cleans a wait subscription when the clock driver fails", async () => {
    const f = await setup();
    f.options.clock.schedule = () => {
      throw new Error("timer unavailable");
    };
    await expect(f.controller.wait("root-id")).rejects.toThrow("timer unavailable");
    // A later steer must not retain or invoke an abandoned observer.
    f.controller.steer("root-id");
    expect(f.timers.size).toBe(0);
  });

  it("publishes detached committed snapshots without projection failures undoing acceptance", async () => {
    const f = await setup();
    const seen: CollaborationSnapshot[] = [];
    const unsubscribe = f.controller.subscribe((snapshot) => {
      seen.push(snapshot);
    });
    f.controller.subscribe((snapshot) => {
      if (snapshot.accepted.length) throw new Error("projection unavailable");
    });
    const child = await f.controller.spawn(f.spawn);
    expect(seen.at(-1)!.accepted[0].agentId).toBe(child.agentId);
    seen.at(-1)!.agents[1].path = "/root/mutated_projection";
    expect(f.controller.get("root-id", child.agentId).path).toBe("/root/worker");
    expect(f.turns).toHaveLength(1);
    await expect(f.controller.flush()).rejects.toMatchObject({
      code: "RUNTIME_FAILED",
      context: { phase: "projection" },
      cause: { message: "projection unavailable" },
    });
    unsubscribe();
    expect(f.snapshot().accepted[0].agentId).toBe(child.agentId);
  });
  it("persists interruption notification so a later parent wait observes it", async () => {
    const f = await setup();
    const child = await f.controller.spawn(f.spawn);
    await f.controller.interrupt("root-id", child.agentId);
    expect(f.controller.get("root-id", "/root").mailbox).toMatchObject([
      { kind: "STATUS", senderId: child.agentId, text: "interrupted" },
    ]);
    await expect(f.controller.wait("root-id")).resolves.toMatchObject({
      reason: "activity",
      message: "Wait completed.",
    });
    expect(
      f.controller
        .get("root-id", "/root")
        .mailbox.some((message) => message.kind === "FINAL_ANSWER"),
    ).toBe(false);
  });
  it("scopes spawn call IDs to the invoking agent and serializes duplicate concurrent spawns", async () => {
    const f = await setup({ maxDepth: 2 });
    const [first, replay] = await Promise.all([
      f.controller.spawn(f.spawn),
      f.controller.spawn(f.spawn),
    ]);
    expect(replay).toEqual(first);
    expect(f.turns).toHaveLength(1);
    const nested = await f.controller.spawn({ ...f.spawn, callerId: first.agentId });
    expect(nested.path).toBe("/root/worker/worker");
    expect(f.turns).toHaveLength(2);
  });
});
