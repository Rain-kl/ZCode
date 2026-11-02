import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import {
  V4_METHODS,
  V4_NOTIFICATIONS,
  conversationTopicWireFrameSchema,
  type ConversationTopicFrame,
} from "@zcode/shared/zcode-protocol-v4";
import { FAULT_MODEL_SELECTION } from "../helpers/fault-provider-model.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixturePath = fileURLToPath(new URL("./protocol-child.ts", import.meta.url));
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw cleanupError("Protocol recovery fixture cleanup failed", errors);
}, 15_000);

function cleanupError(context: string, errors: unknown[]): AggregateError {
  return new AggregateError(
    errors,
    `${context}\n${errors.map((error) => (error instanceof Error ? error.stack : String(error))).join("\n")}`,
  );
}

function deadline<T>(promise: Promise<T>, detail: () => string, timeoutMs = 25_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(detail())), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function succeed(response: ServerResponse, text: string): void {
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  response.write(
    `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] })}\n\n`,
  );
  response.end(
    `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`,
  );
}

async function harness(kind: "before-token" | "visible-stream" | "exhausted") {
  const workspace = await mkdtemp(join(tmpdir(), "zcode-protocol-recovery-"));
  cleanups.push(() => rm(workspace, { recursive: true, force: true }));
  let requests = 0;
  let healthy = false;
  let heldResponse: ServerResponse | undefined;
  const server = createServer(async (request, response) => {
    // 只统计 provider 实际收到并读取完毕的 HTTP 请求，不依据重试日志计数。
    for await (const _chunk of request) {
      /* consume body */
    }
    requests += 1;
    if (!healthy && (kind === "exhausted" || (kind === "before-token" && requests === 1))) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            message: "fixture_http_500: recoverable provider failure",
            type: "server_error",
          },
        }),
      );
    } else if (!healthy && kind === "visible-stream" && requests === 1) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "VISIBLE_RECOVERY_BOUNDARY" }, finish_reason: null }] })}\n\n`,
      );
      heldResponse = response;
    } else {
      succeed(response, "RECOVERED_PROTOCOL_RESULT");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanups.push(async () => {
    heldResponse?.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server has no TCP address");
  const child = spawn(
    process.execPath,
    [
      "--unhandled-rejections=throw",
      "--import",
      "tsx",
      fixturePath,
      `http://127.0.0.1:${address.port}/v1`,
      workspace,
    ],
    {
      cwd: packageRoot,
      env: { ...process.env, TSX_TSCONFIG_PATH: join(packageRoot, "tsconfig.json") },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  const messages: Array<Record<string, unknown>> = [];
  const frames: ConversationTopicFrame[] = [];
  const waiters = new Set<() => void>();
  let readError: unknown;
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      const message = z.record(z.unknown()).parse(JSON.parse(line));
      if (message.method && message.id !== undefined) {
        if (message.method !== "session/requestRuntimePreferences")
          throw new Error(`Unexpected child request: ${String(message.method)}`);
        child.stdin.write(
          `${JSON.stringify({ id: message.id, result: { nativeSearchEnhancementsEnabled: false, memoryEnabled: false } })}\n`,
        );
      } else {
        messages.push(message);
        if (message.method === V4_NOTIFICATIONS.conversationFrame) {
          const wire = conversationTopicWireFrameSchema.parse(message.params);
          if (wire.kind !== "complete")
            throw new Error("Small recovery fixture unexpectedly fragmented");
          frames.push(wire.frame);
        }
      }
    } catch (error) {
      readError = error;
    }
    for (const wake of waiters) wake();
  });
  child.once("exit", () => {
    for (const wake of waiters) wake();
  });
  async function until<T>(find: () => T | undefined): Promise<T> {
    let wake: () => void = () => undefined;
    try {
      return await deadline(
        new Promise<T>((resolve, reject) => {
          wake = () => {
            if (readError) return reject(readError);
            const value = find();
            if (value !== undefined) return resolve(value);
            if (child.exitCode !== null || child.signalCode !== null)
              reject(new Error(`Child exited: ${child.exitCode}/${child.signalCode}\n${stderr}`));
          };
          waiters.add(wake);
          wake();
        }),
        () => `Protocol wait timed out; requests=${requests}\n${stderr.slice(-6000)}`,
      );
    } finally {
      waiters.delete(wake);
    }
  }
  cleanups.push(async () => {
    const errors: unknown[] = [];
    child.stdin.end();
    try {
      expect(await deadline(exit, () => `EOF shutdown timed out\n${stderr}`, 5_000)).toEqual({
        code: 0,
        signal: null,
      });
    } catch (error) {
      errors.push(error);
    }
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    try {
      // 进程退出不代表 stdio 已关闭；保留原始超时并等待 close 后再释放 SQLite 目录。
      await deadline(closed, () => `Child did not close after cleanup\n${stderr}`, 5_000);
    } catch (error) {
      errors.push(error);
    } finally {
      lines.close();
    }
    try {
      expect(stderr).not.toMatch(/unhandledRejection|uncaughtException|ZCODE_PROCESS_DIAGNOSTIC/u);
      expect(stderr).toContain("RECOVERY_FIXTURE_SHUTDOWN_COMPLETE");
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw cleanupError("Protocol child cleanup failed", errors);
  });
  let rpcId = 0;
  async function rpc(method: string, params: unknown): Promise<unknown> {
    const id = ++rpcId;
    // waiter 在写入前安装，避免极速响应穿过订阅窗口。
    const result = until(() => messages.find((message) => message.id === id));
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    const response = await result;
    if (response.error) throw new Error(JSON.stringify(response.error));
    return response.result;
  }
  let commandId = 0;
  const command = (type: string, sessionId: string | null, payload: unknown) =>
    rpc(V4_METHODS.command, {
      clientId: "recovery-process-client",
      commandId: `command-${++commandId}`,
      issuedAt: Date.now(),
      sessionId,
      type,
      payload,
    });
  const created = z
    .object({ status: z.literal("accepted"), result: z.object({ sessionId: z.string() }) })
    .parse(
      await command("createSession", null, {
        workspaceId: workspace,
        config: { modelSelection: FAULT_MODEL_SELECTION },
      }),
    );
  const sessionId = created.result.sessionId;
  await rpc(V4_METHODS.conversationSubscribe, {
    topic: `conversation/${sessionId}`,
    connectionId: "recovery-process-connection",
    clientMode: "desktop-continuous",
  });
  const controls = (from: number) =>
    frames
      .slice(from)
      .flatMap((frame) =>
        frame.payload.kind === "snapshot"
          ? [frame.payload.snapshot.control]
          : frame.payload.deltas.flatMap((delta) =>
              delta.op === "state.updated" && delta.patch.control ? [delta.patch.control] : [],
            ),
      );
  return {
    child,
    frames,
    controls,
    until,
    requests: () => requests,
    makeHealthy: () => {
      healthy = true;
    },
    cutVisibleStream: () => {
      if (!heldResponse) throw new Error("No held visible stream");
      heldResponse.destroy();
    },
    send: (text: string) => command("sendText", sessionId, { text }),
    waitTerminal: (from: number) =>
      until(() => {
        let started = false;
        for (const control of controls(from)) {
          if (control.phase === "running") started = true;
          if (
            started &&
            ["completedSuccess", "error", "completedInterrupted"].includes(control.phase)
          ) {
            return control;
          }
        }
        return undefined;
      }),
  };
}

it.each(["before-token", "visible-stream", "exhausted"] as const)(
  "keeps a real NDJSON process usable after %s provider failures",
  async (kind) => {
    const run = await harness(kind);
    const start = run.frames.length;
    await run.send("Recover this provider request.");
    if (kind === "visible-stream") {
      await run.until(() =>
        run.frames
          .slice(start)
          .some((frame) => JSON.stringify(frame).includes("VISIBLE_RECOVERY_BOUNDARY"))
          ? true
          : undefined,
      );
      expect(run.requests()).toBe(1);
      expect(
        run
          .controls(start)
          .some((control) =>
            ["completedSuccess", "error", "completedInterrupted"].includes(control.phase),
          ),
      ).toBe(false);
      run.cutVisibleStream();
    }
    const terminal = await run.waitTerminal(start);
    expect(terminal.phase).toBe(kind === "exhausted" ? "error" : "completedSuccess");
    expect(run.requests()).toBe(kind === "exhausted" ? 21 : 2);
    if (kind === "exhausted")
      expect(JSON.stringify(terminal.lastError)).toMatch(
        /fixture_http_500|recoverable provider failure/u,
      );
    else expect(run.controls(start).some((control) => control.phase === "error")).toBe(false);
    expect(run.child.exitCode).toBeNull();
    expect(run.child.signalCode).toBeNull();
    run.makeHealthy();
    const second = run.frames.length;
    await run.send("Accept a second real input after recovery.");
    expect((await run.waitTerminal(second)).phase).toBe("completedSuccess");
    expect(run.requests()).toBe(kind === "exhausted" ? 22 : 3);
  },
  60_000,
);
