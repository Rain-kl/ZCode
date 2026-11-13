import { expect, it, vi } from "vitest";
import { CoreErrorType, createCoreError, isCoreError, type ModelRequest } from "@zcode/contracts";
import * as controllerModule from "../../src/fork/codex-collaboration/module.js";
import { done, setup, tool, texts } from "./fixture.js";

it.each(["wrapped", "model"] as const)(
  "preserves %s execution failure detail in status, durable tree and parent mail then follows up the same session",
  async (kind) => {
    const detail = `quality-provider-failure-specific-429-${kind}`;
    const original =
      kind === "wrapped"
        ? new Error(detail)
        : createCoreError(CoreErrorType.ModelError, detail, {
            retryable: false,
            context: { providerId: "test", statusCode: 400 },
          });
    let rejected: unknown;
    const create = controllerModule.createCollaborationController;
    const spy = vi
      .spyOn(controllerModule, "createCollaborationController")
      .mockImplementation(async (options) => {
        const prepare = options.runtime.prepare.bind(options.runtime);
        options.runtime.prepare = async (...args) => {
          const prepared = await prepare(...args);
          const admit = prepared.admit.bind(prepared);
          prepared.admit = async (request) => {
            const admission = await admit(request);
            return {
              cancel: () => admission.cancel(),
              async run() {
                try {
                  return await admission.run();
                } catch (error) {
                  rejected = error;
                  throw error;
                }
              },
            };
          };
          return prepared;
        };
        return create(options);
      });
    const childSessions: string[] = [];
    const rootRequests: ModelRequest[] = [];
    const { runtime, rootId, store } = setup(async (request, observation) => {
      const sessionId = String(observation.invocationContext?.traceContext?.sessionId);
      if (sessionId === rootId) {
        rootRequests.push(request);
        return done;
      }
      childSessions.push(sessionId);
      if (childSessions.length === 1) throw original;
      return done;
    });
    try {
      expect(
        (
          await tool(runtime, "spawn_agent", {
            task_name: "worker",
            message: "fail with context",
            fork_turns: "none",
          })
        ).success,
      ).toBe(true);
      await vi.waitFor(async () => {
        const output = await tool(runtime, "list_agents", {});
        expect(output.modelContent).toContain(`"errored":"${detail}"`);
      });
      const saved = await store.sessionEntries!({ sessionID: rootId, type: "codex_collaboration" });
      expect(JSON.stringify(saved)).toContain(`"lastError":"${detail}"`);
      const receipts = await store.messages({ sessionID: rootId });
      expect(
        receipts.some(
          (message) =>
            JSON.stringify(message.info.metadata).includes('"kind":"STATUS"') &&
            message.parts.some((part) => part.type === "text" && part.text === detail),
        ),
      ).toBe(true);
      expect(rejected).toBeInstanceOf(Error);
      if (!(rejected instanceof Error)) throw new Error("Expected original rejected Error");
      if (kind === "model") expect(rejected).toBe(original);
      else {
        expect(rejected.message).toBe(detail);
        expect(rejected.cause).toBeInstanceOf(Error);
        expect((rejected.cause as Error).cause).toBe(original);
        if (!isCoreError(rejected) || !isCoreError(rejected.cause))
          throw new Error("Expected retained CoreError wrapper and context");
        expect(rejected.type).toBe(rejected.cause.type);
        expect(rejected.context).toBe(rejected.cause.context);
        expect(rejected.retryable).toBe(rejected.cause.retryable);
        expect(rejected.recoverable).toBe(rejected.cause.recoverable);
      }
      await runtime.executeTurn("Read child status");
      expect(texts(rootRequests[0]!)).toContain(`Payload:\n${detail}`);
      expect(texts(rootRequests[0]!)).toContain("Message Type: STATUS");
      expect(
        (
          await tool(runtime, "followup_task", {
            target: "worker",
            message: "recover after provider failure",
          })
        ).success,
      ).toBe(true);
      await vi.waitFor(() => expect(childSessions).toHaveLength(2));
      expect(childSessions[1]).toBe(childSessions[0]);
      await runtime.shutdownCollaboration();
    } finally {
      spy.mockRestore();
    }
  },
);
