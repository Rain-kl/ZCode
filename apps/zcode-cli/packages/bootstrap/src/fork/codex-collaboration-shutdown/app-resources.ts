import type { ZCodeApp } from "../../app/types.js";
import type { ProtocolAppFactory } from "./contract.js";

// 共享依赖只能在实际排空后关闭；已接受但未返回的 app 也必须计入资源所有者。
interface AcceptedAppCreation {
  settled: Promise<void>;
  cleanupFailure?: { error: unknown };
}

/** 持有 app 资源而非业务 session；临时 workspace app、尚未登记的 app 也归此 owner。 */
export class ProtocolRuntimeResources {
  private stopping = false;
  private readonly apps = new Set<ZCodeApp>();
  private readonly creations = new Set<AcceptedAppCreation>();
  private readonly stoppingApps = new WeakMap<ZCodeApp, Promise<void>>();
  private closePromise?: Promise<void>;

  constructor(private readonly factory: ProtocolAppFactory) {}

  readonly create: ProtocolAppFactory = async (options) => {
    this.assertServing();
    let settle!: () => void;
    const creation: AcceptedAppCreation = {
      settled: new Promise<void>((resolve) => {
        settle = resolve;
      }),
    };
    this.creations.add(creation);
    try {
      const app = await this.factory(options);
      const originalClose = app.close?.bind(app);
      let closing: Promise<void> | undefined;
      app.close = () => {
        closing ??= Promise.resolve().then(async () => {
          await originalClose?.();
          // 只有实际成功才移除；普通 close 失败也必须阻止进程误报排空成功。
          this.apps.delete(app);
        });
        return closing;
      };
      this.apps.add(app);
      if (this.stopping) {
        // 禁止晚到 app 发布是正常关闭；实际资源清理失败必须同时交付给 drain 调用者。
        try {
          await this.stopApp(app);
        } catch (error) {
          creation.cleanupFailure = { error };
          throw error;
        }
        this.assertServing();
      }
      return app;
    } finally {
      this.creations.delete(creation);
      settle();
    }
  };

  assertServing(): void {
    if (this.stopping) throw new Error("ZCode Protocol runtime is stopping");
  }

  close(): Promise<void> {
    this.stopping = true;
    if (!this.closePromise) {
      // 同步取已接受集合，避免 factory 在微任务中完成并从集合移除后丢失其关闭失败。
      const creations = [...this.creations];
      const apps = [...this.apps];
      this.closePromise = Promise.resolve().then(async () => {
        const stopping = Promise.allSettled(apps.map((app) => this.stopApp(app)));
        await Promise.all(creations.map((creation) => creation.settled));
        const results = await stopping;
        const errors = new Set<unknown>(
          results.filter((result) => result.status === "rejected").map((result) => result.reason),
        );
        for (const creation of creations)
          if (creation.cleanupFailure) errors.add(creation.cleanupFailure.error);
        if (errors.size) throw new AggregateError([...errors], "Protocol apps shutdown failed");
      });
    }
    return this.closePromise;
  }

  private stopApp(app: ZCodeApp): Promise<void> {
    let stopping = this.stoppingApps.get(app);
    if (!stopping) {
      stopping = Promise.resolve().then(async () => {
        // finally 会用 close 失败覆盖 stop 失败；逐项尝试并保留全部错误上下文。
        const errors: unknown[] = [];
        for (const operation of [
          () => app.runtime.beginShutdown(),
          () =>
            app.runtime.stopActiveForegroundExecution?.({ reason: "Protocol runtime stopping" }),
        ]) {
          try {
            operation();
          } catch (error) {
            errors.push(error);
          }
        }
        try {
          await app.close?.();
        } catch (error) {
          errors.push(error);
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1)
          throw new AggregateError(errors, "Protocol app shutdown operations failed");
      });
      this.stoppingApps.set(app, stopping);
    }
    return stopping;
  }
}
