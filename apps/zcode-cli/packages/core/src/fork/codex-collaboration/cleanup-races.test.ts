import { expect, it } from "vitest";
import { deferred, setup } from "../../../test/fork-codex-collaboration/driver.js";

it("rejects new child boundary calls immediately once shutdown is requested behind an occupied lane", async () => {
  const f = await setup();
  const prepare = deferred<void>();
  f.gatePrepare(prepare.promise);
  const spawning = f.controller.spawn(f.spawn);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const closing = f.controller.dispose();
  let rejected = false;
  const sending = f.controller.send("root-id", "/root", "late boundary").catch((error: unknown) => {
    expect(error).toMatchObject({ code: "CLOSED" });
    rejected = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    expect(rejected).toBe(true);
  } finally {
    prepare.resolve();
    await spawning;
    await closing;
    await sending;
  }
});

async function failedUnload() {
  const f = await setup();
  const child = await f.controller.spawn(f.spawn);
  f.turns[0].result.resolve({ status: "completed", text: "first answer" });
  await f.controller.flush();
  const release = f.options.runtime.release;
  let releases = 0;
  f.options.runtime.release = async (...args) => {
    releases++;
    if (releases === 1) throw new Error("first release failed");
    await release(...args);
  };
  await expect(f.controller.unload("root-id", child.agentId)).rejects.toMatchObject({
    code: "RUNTIME_FAILED",
  });
  return { ...f, child };
}
it("quarantines a failed-release handle until followup completes cleanup and restores the same session", async () => {
  const f = await failedUnload();
  await f.controller.followup("root-id", f.child.agentId, "continue");
  await f.controller.flush();
  expect(f.events.filter((event) => event.startsWith("prepare:/root/worker"))).toEqual([
    "prepare:/root/worker:false",
    "prepare:/root/worker:true",
  ]);
  expect(f.controller.list("root-id").map((agent) => agent.path)).toContain(f.child.path);
  expect(f.turns[1].identity.childSessionId).toBe(f.child.childSessionId);
  expect(f.histories.get(f.child.childSessionId)).toHaveLength(2);
  await expect(f.controller.interrupt("root-id", f.child.agentId)).resolves.toEqual({
    previousStatus: "running",
  });
  expect(f.turns[1].signal.aborted).toBe(true);
});
it("serializes a gated cleanup retry before concurrent followup admission", async () => {
  const f = await failedUnload();
  const enteredRelease = deferred<void>();
  const allowRelease = deferred<void>();
  const release = f.options.runtime.release;
  f.options.runtime.release = async (...args) => {
    enteredRelease.resolve();
    await allowRelease.promise;
    await release(...args);
  };
  const flushing = f.controller.flush();
  await enteredRelease.promise;
  const followup = f.controller.followup("root-id", f.child.agentId, "continue after release");
  for (let i = 0; i < 5; i++) await Promise.resolve();
  const turnsWhileReleasing = f.turns.length;
  allowRelease.resolve();
  await Promise.all([flushing, followup]);
  expect(turnsWhileReleasing).toBe(1);
  expect(f.events.filter((event) => event.startsWith("prepare:/root/worker"))).toEqual([
    "prepare:/root/worker:false",
    "prepare:/root/worker:true",
  ]);
  expect(f.controller.list("root-id").map((agent) => agent.path)).toContain(f.child.path);
  expect(f.controller.get("root-id", f.child.agentId).status).toBe("running");
  await f.controller.interrupt("root-id", f.child.agentId);
  expect(f.turns[1].signal.aborted).toBe(true);
});
it("shutdown aborts every child and attempts every release despite save and one release failing", async () => {
  const f = await setup();
  const first = await f.controller.spawn(f.spawn);
  const second = await f.controller.spawn({ ...f.spawn, callId: "second", taskName: "second" });
  const release = f.options.runtime.release;
  const releases: string[] = [];
  const releaseFailure = new Error("first child release failed");
  let failRelease = true;
  f.options.runtime.release = async (...args) => {
    releases.push(args[0].agentId);
    if (args[0].agentId === first.agentId && failRelease) throw releaseFailure;
    await release(...args);
  };
  f.failWrite(true);
  await expect(f.controller.dispose()).rejects.toMatchObject({
    code: "RUNTIME_FAILED",
    context: { phase: "dispose" },
    cause: {
      errors: [
        {
          code: "STORAGE_FAILED",
          context: { phase: "write" },
          cause: { message: "entry unavailable" },
        },
        { code: "RUNTIME_FAILED", context: { phase: "release" }, cause: releaseFailure },
      ],
    },
  });
  expect(f.turns.map((turn) => turn.signal.aborted)).toEqual([true, true]);
  expect(releases).toEqual([first.agentId, second.agentId]);
  await expect(
    f.controller.spawn({ ...f.spawn, callId: "late", taskName: "late" }),
  ).rejects.toMatchObject({ code: "CLOSED" });
  f.failWrite(false);
  failRelease = false;
  await f.controller.flush();
  expect(releases).toEqual([first.agentId, second.agentId, first.agentId]);
  expect(f.controller.list("root-id").map((agent) => agent.path)).toEqual(["/root"]);
  expect(
    f
      .snapshot()
      .agents.slice(1)
      .map((agent) => agent.status),
  ).toEqual(["interrupted", "interrupted"]);
  const countAfterCleanup = releases.length;
  await expect(f.controller.dispose()).resolves.toBeUndefined();
  expect(releases).toHaveLength(countAfterCleanup);
});

it.each(["abort rejection", "late completion"])(
  "ignores %s after shutdown without asynchronous error noise or state overwrite",
  async (settlement) => {
    const f = await setup();
    const child = await f.controller.spawn(f.spawn);
    const turn = f.turns[0];
    if (settlement === "abort rejection") {
      turn.signal.addEventListener(
        "abort",
        () => {
          turn.result.reject(new Error("accepted run aborted during shutdown"));
        },
        { once: true },
      );
    } else {
      turn.result.resolve({ status: "completed", text: "late answer after shutdown admission" });
    }
    await expect(f.controller.dispose()).resolves.toBeUndefined();
    await Promise.allSettled([turn.result.promise]);
    await expect(f.controller.flush()).resolves.toBeUndefined();
    expect(turn.signal.aborted).toBe(true);
    expect(f.controller.get("root-id", child.agentId)).toMatchObject({
      status: "interrupted",
      generation: 1,
    });
    expect(f.snapshot().agents[1]).toMatchObject({ status: "interrupted", generation: 1 });
    expect(f.controller.get("root-id", "/root").mailbox).toEqual([]);
    expect(f.controller.list("root-id").map((agent) => agent.path)).toEqual(["/root"]);
  },
);
