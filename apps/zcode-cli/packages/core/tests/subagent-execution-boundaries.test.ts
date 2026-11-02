import { describe, expect, it, vi } from "vitest";
import { SessionEventType, createSessionId } from "@zcode/contracts";
import { createTestAgentRuntime } from "./test-agent-runtime.js";
import { createTestModelFactory } from "./test-runtime-model.js";
import { createTestSessionEventStore } from "./test-event-store.js";
import { setup, initial, done, spawn, send, assertProfile } from "./subagent-profile-scenario.js";

const next = () => ({ ...initial(), systemPrompt: "PROFILE_CHANGED", tools: ["Grep"] });

describe("subagent definitions at execution boundaries", () => {
  // FORK-BEGIN(codex-collaboration)
  it("父轮等待前台子代理时接纳 steer，子代理完成后才把引导放入下一请求", async () => {
    const started = Promise.withResolvers<void>();
    const childGate = Promise.withResolvers<void>();
    const scenario = setup(async () => {
      started.resolve();
      await childGate.promise;
      return { ...done(), text: "CHILD_FINISHED_WITHOUT_CANCELLATION" };
    });
    const completion = scenario.turn([spawn("FOREGROUND_STEER_CHILD")]);
    void completion.catch(() => undefined);
    try {
      await Promise.race([started.promise, completion]);
      const turnId = scenario.runtime.getActiveTurnInfo()?.turnId;
      const parentRequests = scenario.parents.length;
      const admission = await scenario.runtime.admitPrompt("PARENT_STEER_MARKER", undefined, {
        delivery: "start_turn",
        queueDelivery: "guide",
        inputId: "parent-steer",
      });
      expect(admission.kind).toBe("queued");
      expect(scenario.parents).toHaveLength(parentRequests);
      expect(scenario.runtime.getActiveTurnInfo()?.turnId).toBe(turnId);
      childGate.resolve();
      await completion;
      const [child] = await scenario.spawned();
      expect(child).toBeDefined();
      await scenario.waitCompleted(child.agentId, 1);
      const followup = JSON.stringify(scenario.parents.at(-1)?.messages);
      expect(followup).toContain("CHILD_FINISHED_WITHOUT_CANCELLATION");
      expect(followup).toContain("PARENT_STEER_MARKER");
    } finally {
      childGate.resolve();
      await completion.catch(() => undefined);
      scenario.runtime.beginShutdown();
    }
  });
  // FORK-END(codex-collaboration)

  it("fails the parent before model requests while preserving listing and the running child", async () => {
    const blocked = Promise.withResolvers<void>(),
      started = Promise.withResolvers<void>();
    let runningRequests = 0;
    const scenario = setup(async (record) => {
      if (
        JSON.stringify(record.request.messages).includes("RUNNING_SEED") &&
        ++runningRequests === 1
      ) {
        started.resolve();
        await blocked.promise;
        return {
          finishReason: "tool-calls",
          text: "",
          usage: {},
          toolCalls: [
            { id: "read_failure_delivery", name: "Read", input: { file_path: "/missing-fixture" } },
          ],
        };
      }
      return done();
    });
    try {
      await scenario.turn([spawn("TERMINAL_SEED")]);
      const terminal = (await scenario.spawned())[0]!;
      await scenario.waitCompleted(terminal.agentId, 1);
      await scenario.turn([spawn("RUNNING_SEED", true)]);
      await started.promise;
      const running = (await scenario.spawned())[1]!;
      const listing = (request: (typeof scenario.parents)[number]) =>
        request.messages.filter((message) =>
          JSON.stringify(message).includes("Available agent types for the Agent tool:"),
        );
      const before = listing(scenario.parents.at(-1)!);
      expect(before).toHaveLength(1);
      const count = scenario.children.length;
      const parentCount = scenario.parents.length;
      scenario.update(next());
      scenario.load.mockRejectedValueOnce(new Error("CONFIG_READ_FAILED"));
      await expect(
        scenario.turn([
          spawn("REJECTED_SPAWN"),
          send(terminal.agentId, "REJECTED_RESUME"),
          send(running.agentId, "DELIVER_DURING_FAILURE"),
        ]),
      ).rejects.toMatchObject({ cause: { message: "CONFIG_READ_FAILED" } });
      const failure = scenario.parents.at(-1)!;
      expect(listing(failure)).toEqual(before);
      expect(JSON.stringify(failure.messages)).not.toContain("no longer available");
      expect(scenario.parents).toHaveLength(parentCount);
      expect(scenario.children).toHaveLength(count);
      // 父轮失败不执行 SendMessage；恢复读取后投递，仍在运行的 child 保持原 profile。
      await scenario.turn([send(running.agentId, "DELIVER_AFTER_FAILURE")]);
      blocked.resolve();
      await scenario.waitCompleted(running.agentId, 1);
      assertProfile(scenario.children.at(-1)!, initial());
      expect(JSON.stringify(scenario.children.at(-1)!.request)).toContain("DELIVER_AFTER_FAILURE");
      expect(JSON.stringify(scenario.children.at(-1)!.request)).not.toContain(
        "DELIVER_DURING_FAILURE",
      );
      await scenario.turn([send(terminal.agentId, "RECOVERED_RESUME")]);
      await scenario.waitCompleted(terminal.agentId, 2);
      assertProfile(scenario.children.at(-1)!, next());
      expect(scenario.children.at(-1)!.sessionId).toBe(terminal.childSessionId);
      expect(listing(scenario.parents.at(-1)!)).toEqual(before);
    } finally {
      blocked.resolve();
      scenario.runtime.beginShutdown();
    }
  });

  it("keeps the turn definitions when Guide is drained and reloads for the next ordinary turn", async () => {
    let profile = initial(),
      parentCalls = 0;
    const load = vi.fn(async () => ({ activeAgents: [profile] }));
    const children: string[] = [];
    const runtime = createTestAgentRuntime(
      createSessionId(),
      { mode: "yolo", compact: { enabled: false }, titleGeneration: { enabled: false } },
      {
        eventStore: createTestSessionEventStore(),
        loadAgentDefinitions: load,
        modelFactory: createTestModelFactory({
          async generateText(request, observation) {
            if (observation.invocationContext?.metadata?.querySource === "subagent") {
              children.push(JSON.stringify(request.messages));
              return done();
            }
            if (++parentCalls === 1) {
              profile = next();
              const guide = await runtime.steerTurn({
                expectedTurnId: runtime.getActiveTurnInfo()?.turnId,
                input: "GUIDE_INPUT",
                delivery: "guide",
              });
              expect(guide.kind).toBe("queued");
              return done();
            }
            return parentCalls === 2 || parentCalls === 4
              ? {
                  finishReason: "tool-calls",
                  text: "",
                  usage: {},
                  toolCalls: [spawn(`GUIDE_CHILD_${parentCalls}`)],
                }
              : done();
          },
        }),
      },
    );
    try {
      await runtime.executeTurn("START_GUIDE");
      expect(load).toHaveBeenCalledTimes(1);
      expect(children).toHaveLength(1);
      expect(children[0]).toContain(initial().systemPrompt);
      expect(children[0]).not.toContain(next().systemPrompt);
      await runtime.executeTurn("NEXT_ORDINARY");
      expect(load).toHaveBeenCalledTimes(2);
      expect(children[1]).toContain(next().systemPrompt);
    } finally {
      runtime.beginShutdown();
    }
  });

  it("cancels a real runtime during definitions loading and discards the late result before queued work", async () => {
    const started = Promise.withResolvers<void>(),
      blocked = Promise.withResolvers<void>();
    const controller = new AbortController();
    const events = createTestSessionEventStore();
    const calls: string[] = [];
    const load = vi
      .fn()
      .mockImplementationOnce(async () => {
        started.resolve();
        await blocked.promise;
        return { activeAgents: [{ ...initial(), systemPrompt: "CANCELLED_PROFILE" }] };
      })
      .mockResolvedValue({ activeAgents: [next()] });
    const runtime = createTestAgentRuntime(
      createSessionId(),
      { mode: "yolo", compact: { enabled: false }, titleGeneration: { enabled: false } },
      {
        eventStore: events,
        loadAgentDefinitions: load,
        modelFactory: createTestModelFactory({
          async generateText(request, observation) {
            calls.push(JSON.stringify(request.messages));
            return observation.invocationContext?.metadata?.querySource === "subagent" ||
              calls.length > 1
              ? done()
              : {
                  finishReason: "tool-calls",
                  text: "",
                  usage: {},
                  toolCalls: [spawn("AFTER_STOP")],
                };
          },
        }),
      },
    );
    try {
      const cancelled = runtime.executeTurn("CANCELLED_INPUT", undefined, {
        abortSignal: controller.signal,
      });
      const rejected = expect(cancelled).rejects.toMatchObject({ cause: { message: "user stop" } });
      await started.promise;
      controller.abort(new Error("user stop"));
      const queued = runtime.executeTurn("AFTER_STOP_INPUT");
      expect(load).toHaveBeenCalledTimes(1);
      expect(calls).toHaveLength(0);
      blocked.resolve();
      await rejected;
      await queued;
      expect(load).toHaveBeenCalledTimes(2);
      expect(calls).toHaveLength(3);
      expect(calls.join()).not.toContain("CANCELLED_PROFILE");
      expect(calls[1]).toContain(next().systemPrompt);
      const completions = (await events.getEvents(runtime.sessionId)).filter(
        (e) => e.type === SessionEventType.TurnComplete,
      );
      // 已开始的输入在 definitions 加载取消后仍保留；终态不启动模型请求。
      expect(completions.map((e) => (e.payload as { resultType: string }).resultType)).toEqual([
        "cancelled",
        "success",
      ]);
      expect(
        (await events.getEvents(runtime.sessionId)).filter(
          (e) => e.type === SessionEventType.TurnStarted,
        ),
      ).toHaveLength(2);
      expect(calls[0]!.match(/CANCELLED_INPUT/g)).toHaveLength(1);
    } finally {
      blocked.resolve();
      runtime.beginShutdown();
    }
  });
});
