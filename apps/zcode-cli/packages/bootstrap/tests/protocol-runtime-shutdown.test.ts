import { afterEach, describe, expect, it, vi } from "vitest";
import { ProtocolRuntimeResources } from "../src/zcode-protocol/runtime-resources.js";
import { cleanupProtocolRuntime } from "../src/zcode-protocol/runtime-cleanup.js";
import { acquireProtocolStartupResource } from "../src/zcode-protocol/startup-resource.js";
import { createFakeApp } from "./helpers/fake-zcode-app.js";
import type { Logger } from "@zcode/contracts";
import { createInMemorySessionEventStore, createSqliteSessionStore } from "@zcode/adapters/storage";
import { ZCodeProtocolAgentServer } from "../src/zcode-protocol/server.js";

const telemetry = vi.hoisted(() => ({ shutdown: vi.fn(async () => {}) }));
vi.mock("@zcode/telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@zcode/telemetry")>()),
  shutdownPreparedModelTelemetry: telemetry.shutdown,
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function fakeApp() {
  const close = vi.fn(async () => {});
  const app = createFakeApp(undefined, { close });
  app.runtime.beginShutdown = vi.fn();
  app.runtime.stopActiveForegroundExecution = vi.fn(() => ({ kind: "idle" }));
  return { app, close };
}

describe("protocol runtime resource ownership", () => {
  it.each(["desktop-continuous", "web-remote-replayable"])(
    "shutdown preserves the %s session without removal events",
    async (deliveryKind) => {
      const close = vi.fn(async () => {});
      const eventStore = createInMemorySessionEventStore();
      const deleteSession = vi.spyOn(eventStore, "deleteSession");
      const notifications: unknown[] = [];
      let sessionId = "";
      const server = new ZCodeProtocolAgentServer({
        createZCodeApp: (options) => {
          const app = createFakeApp(options, { close });
          sessionId = app.sessionId;
          app.runtime.beginShutdown = vi.fn();
          return app;
        },
        createSessionEventStore: () => eventStore,
        cwd: "/workspace/app",
      });
      server.setNotificationSink((message) => {
        if ("id" in message && message.method === "session/requestRuntimePreferences") {
          void server.handleMessage({
            id: message.id,
            result: { nativeSearchEnhancementsEnabled: false },
          });
        } else notifications.push(message);
      });
      const created = await server.handleMessage({
        id: "create",
        method: "session/create",
        params: {
          workspace: { workspacePath: "/workspace/app", workspaceKey: "/workspace/app" },
        },
      });
      expect(created, JSON.stringify(created)).toHaveProperty("result");
      const read = {
        id: "read",
        method: "session/read",
        params: { sessionId, deliveryKind },
      };
      const snapshot = await server.handleMessage(read);
      expect(snapshot, JSON.stringify(snapshot)).toHaveProperty("result");
      notifications.length = 0;
      await server.shutdown();
      server.disposeProjections();
      expect(close).toHaveBeenCalledOnce();
      expect(deleteSession).not.toHaveBeenCalled();
      expect(notifications).toEqual([]);
      await expect(server.handleMessage(read)).rejects.toThrow("stopping");
    },
  );

  it("interrupts a hung startup immediately and disposes its late result", async () => {
    const controller = new AbortController();
    const disposeLate = vi.fn();
    let finish!: (value: string) => void;
    const creating = acquireProtocolStartupResource({
      signal: controller.signal,
      logger: { warn: vi.fn() } as unknown as Logger,
      create: () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
      disposeLate,
    });
    await Promise.resolve();
    controller.abort(new Error("parent gone"));
    await expect(creating).rejects.toThrow("parent gone");
    finish("late store");
    await vi.waitFor(() => expect(disposeLate).toHaveBeenCalledExactlyOnceWith("late store"));
  });

  it("stops foreground execution and closes each app once, including transient apps", async () => {
    const first = fakeApp();
    const second = fakeApp();
    const factory = vi.fn().mockResolvedValueOnce(first.app).mockResolvedValueOnce(second.app);
    const resources = new ProtocolRuntimeResources(factory);
    const app = await resources.create();
    await resources.create();
    await Promise.all([resources.close(), resources.close(), app.close?.()]);
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
    expect(first.app.runtime.beginShutdown).toHaveBeenCalledOnce();
    expect(second.app.runtime.stopActiveForegroundExecution).toHaveBeenCalledOnce();
    await expect(resources.create()).rejects.toThrow("stopping");
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("closes a late app from an already accepted creation and rejects publication", async () => {
    const { app, close } = fakeApp();
    let resolve!: (value: typeof app) => void;
    const resources = new ProtocolRuntimeResources(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const creating = resources.create();
    const rejected = expect(creating).rejects.toThrow("stopping");
    let drained = false;
    const closing = resources.close().then(() => {
      drained = true;
    });
    await new Promise<void>((next) => setImmediate(next));
    try {
      expect(drained).toBe(false);
    } finally {
      resolve(app);
      await rejected;
      await closing;
    }
    expect(drained).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(app.runtime.stopActiveForegroundExecution).toHaveBeenCalledOnce();
  });

  it("distinguishes a blocked late publication from an actual late app cleanup failure", async () => {
    const { app, close } = fakeApp();
    const failure = new Error("late app collaboration drain failed");
    close.mockRejectedValue(failure);
    let resolve!: (value: typeof app) => void;
    const resources = new ProtocolRuntimeResources(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const creating = resources.create();
    const creationFailure = expect(creating).rejects.toBe(failure);
    const closing = resources.close();
    const closeFailure = expect(closing).rejects.toMatchObject({
      message: "Protocol apps shutdown failed",
      errors: [failure],
    });
    resolve(app);
    await Promise.all([creationFailure, closeFailure]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("awaits a failed accepted factory without treating its request error as a cleanup failure", async () => {
    const failure = new Error("accepted app factory failed");
    let reject!: (reason: Error) => void;
    const resources = new ProtocolRuntimeResources(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const creating = resources.create();
    const rejected = expect(creating).rejects.toBe(failure);
    const closing = resources.close();
    reject(failure);
    await rejected;
    await expect(closing).resolves.toBeUndefined();
  });

  it("attempts every app shutdown operation and preserves simultaneous stop and close failures", async () => {
    const { app, close } = fakeApp();
    const beginFailure = new Error("beginShutdown failed");
    const stopFailure = new Error("stopActiveForegroundExecution failed");
    const closeFailure = new Error("app close failed");
    app.runtime.beginShutdown = vi.fn(() => {
      throw beginFailure;
    });
    app.runtime.stopActiveForegroundExecution = vi.fn(() => {
      throw stopFailure;
    });
    close.mockRejectedValue(closeFailure);
    const resources = new ProtocolRuntimeResources(async () => app);
    await resources.create();
    await expect(resources.close()).rejects.toMatchObject({
      message: "Protocol apps shutdown failed",
      errors: [
        {
          message: "Protocol app shutdown operations failed",
          errors: [beginFailure, stopFailure, closeFailure],
        },
      ],
    });
    expect(app.runtime.beginShutdown).toHaveBeenCalledOnce();
    expect(app.runtime.stopActiveForegroundExecution).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(["failed", "timed-out"] as const)(
    "retains shared dependencies after a %s app drain, including late settlement",
    async (outcome) => {
      vi.useFakeTimers();
      const store = await createSqliteSessionStore({ dbPath: ":memory:" });
      const closeStore = vi.spyOn(store, "close");
      const closeBrowser = vi.fn(async () => {});
      const closeMcp = vi.fn(async () => {});
      const closePool = vi.fn(async () => {});
      const closeRegistry = vi.fn();
      const disposeProjections = vi.fn();
      const warn = vi.fn();
      let finish!: () => void;
      const draining = new Promise<void>((resolve, reject) => {
        finish = resolve;
        if (outcome === "failed") reject(new Error("collaboration root write still failing"));
      });
      try {
        const cleanup = cleanupProtocolRuntime({
          logger: { warn } as unknown as Logger,
          deadlineAt: Date.now() + 450,
          server: { shutdown: () => draining, disposeProjections },
          sessionStore: store,
          nodeReplBrowserBroker: { close: closeBrowser },
          mcpPort: { close: closeMcp },
          mcpConnectionPool: { close: closePool },
          providerRegistryRuntime: { dispose: closeRegistry },
        });
        await vi.advanceTimersByTimeAsync(451);
        await cleanup;
        expect(disposeProjections).toHaveBeenCalledOnce();
        expect(telemetry.shutdown).toHaveBeenCalledOnce();
        for (const close of [closeStore, closeBrowser, closeMcp, closePool, closeRegistry])
          expect(close).not.toHaveBeenCalled();
        expect(JSON.stringify(warn.mock.calls)).toContain(
          outcome === "failed"
            ? "collaboration root write still failing"
            : "Protocol cleanup timed out",
        );
        finish();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(1);
        for (const close of [closeStore, closeBrowser, closeMcp, closePool, closeRegistry])
          expect(close).not.toHaveBeenCalled();
      } finally {
        const closed = closeStore.mock.calls.length > 0;
        closeStore.mockRestore();
        if (!closed) store.close();
      }
    },
  );

  it("closes shared dependencies exactly once only after the app owner actually drains", async () => {
    const store = await createSqliteSessionStore({ dbPath: ":memory:" });
    const closeStore = vi.spyOn(store, "close");
    const closeMcp = vi.fn(async () => {});
    const closeRegistry = vi.fn();
    let finish!: () => void;
    const draining = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const shutdown = vi.fn(() => draining);
    try {
      const cleanup = cleanupProtocolRuntime({
        logger: { warn: vi.fn() } as unknown as Logger,
        server: { shutdown, disposeProjections: vi.fn() },
        sessionStore: store,
        mcpPort: { close: closeMcp },
        providerRegistryRuntime: { dispose: closeRegistry },
      });
      await vi.waitFor(() => expect(shutdown).toHaveBeenCalledOnce());
      for (const close of [closeStore, closeMcp, closeRegistry])
        expect(close).not.toHaveBeenCalled();
      finish();
      await cleanup;
      for (const close of [closeStore, closeMcp, closeRegistry])
        expect(close).toHaveBeenCalledOnce();
    } finally {
      const closed = closeStore.mock.calls.length > 0;
      closeStore.mockRestore();
      if (!closed) store.close();
    }
  });

  it("does not retain an app that was already closed normally", async () => {
    const { app, close } = fakeApp();
    const resources = new ProtocolRuntimeResources(async () => app);
    await resources.create();
    await app.close?.();
    await resources.close();
    expect(close).toHaveBeenCalledOnce();
    expect(app.runtime.beginShutdown).not.toHaveBeenCalled();
  });

  it("retains a failed ordinary app close as a failed process drain", async () => {
    const { app, close } = fakeApp();
    const failure = new Error("ordinary close collaboration drain failed");
    close.mockRejectedValue(failure);
    const resources = new ProtocolRuntimeResources(async () => app);
    await resources.create();
    await expect(app.close?.()).rejects.toBe(failure);
    await expect(resources.close()).rejects.toMatchObject({
      message: "Protocol apps shutdown failed",
      errors: [failure],
    });
    const closeStore = vi.fn();
    const warn = vi.fn();
    await cleanupProtocolRuntime({
      logger: { warn },
      server: { shutdown: () => resources.close(), disposeProjections: vi.fn() },
      sessionStore: { close: closeStore },
    });
    expect(closeStore).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).toContain(failure.message);
    expect(close).toHaveBeenCalledOnce();
  });

  it("shares one deadline and still attempts later owners when an earlier close hangs", async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const cleanup = cleanupProtocolRuntime({
      logger: { warn: vi.fn() } as unknown as Logger,
      deadlineAt: Date.now() + 450,
      server: {
        shutdown: () => {
          order.push("apps");
          return new Promise(() => {});
        },
        disposeProjections: () => {
          order.push("projections");
        },
      },
      mcpPort: {
        close: async () => {
          order.push("mcp");
          throw new Error("closed");
        },
      },
      mcpConnectionPool: {
        close: () => {
          order.push("pool");
          return new Promise(() => {});
        },
      },
      providerRegistryRuntime: {
        dispose: () => {
          order.push("registry");
        },
      },
    });
    let completed = false;
    void cleanup.then(() => {
      completed = true;
    });
    await vi.advanceTimersByTimeAsync(451);
    expect(completed).toBe(true);
    expect(order).toEqual(["apps", "projections"]);
    expect(telemetry.shutdown).toHaveBeenCalledOnce();
    await cleanup;
  });
});

describe("session lifecycle shutdown reentry", () => {
  it("reserves the shutdown promise before synchronous abort listeners reenter", async () => {
    const { app } = fakeApp();
    const controller = new AbortController();
    const server = new ZCodeProtocolAgentServer({
      createZCodeApp: async () => app,
      cwd: "/workspace",
    });
    const context = (server as unknown as { context: { sessions: Map<string, unknown> } }).context;
    context.sessions.set(app.sessionId, {
      app,
      activeAbortController: controller,
      unsubscribe: () => {},
    });
    let nested: Promise<void> | undefined;
    controller.signal.addEventListener("abort", () => {
      nested = server.shutdown();
    });
    const closing = server.shutdown();
    expect(nested).toBe(closing);
    await closing;
  });
});
