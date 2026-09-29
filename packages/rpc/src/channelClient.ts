import { VSBuffer } from "./buffer.js";
import { CancellationToken, Event, Emitter, type IDisposable } from "./foundation.js";
import { BufferReader, BufferWriter, deserialize, serialize } from "./serialization.js";
import type { IMessagePassingProtocol } from "./protocol.js";
import {
  type IChannel,
  type IChannelClient,
  type IHandler,
  type IRawResponse,
  RequestType,
  ResponseType,
} from "./channels.shared.js";

enum State {
  Uninitialized,
  Idle,
}

export class ChannelClient implements IChannelClient, IDisposable {
  private state = State.Uninitialized;
  private isDisposed = false;
  private activeRequests = new Set<IDisposable>();
  private handlers = new Map<number, IHandler>();
  // Promise 请求和事件监听共用 handlers，但只有前者需要在连接终结时 reject。
  // 单独维护 reject map，避免 dispose 把事件订阅误当成挂起的 RPC 请求。
  private pendingRejections = new Map<number, (error: Error) => void>();
  private lastRequestId = 0;
  private protocolListener: IDisposable | null;
  // FORK(rpc-channel-manifest): 服务端在 Initialize 里声明的已注册通道；undefined 表示清单未知
  // （旧服务端，或 Initialize 尚未到达），此时调用方必须保持历史行为。
  private channelManifest: readonly string[] | undefined = undefined;

  private readonly _onDidInitialize = new Emitter<void>();
  readonly onDidInitialize = this._onDidInitialize.event;

  constructor(private protocol: IMessagePassingProtocol) {
    this.protocolListener = this.protocol.onMessage((msg) => this.onBuffer(msg));
  }

  /** FORK(rpc-channel-manifest): 同步读取最近一次 Initialize 声明的通道清单；见 FEATURES.md 的 rpc-channel-manifest 条目 */
  channelNames(): readonly string[] | undefined {
    return this.channelManifest;
  }

  /** FORK(rpc-channel-manifest): 是否已收到对端 Initialize。false 时清单未知只是「握手未完成」。 */
  isInitialized(): boolean {
    return this.state === State.Idle;
  }

  getChannel<T extends IChannel>(channelName: string): T {
    return {
      call: (command: string, arg?: any, cancellationToken?: CancellationToken) => {
        if (this.isDisposed) {
          return Promise.reject(new Error("ChannelClient is disposed"));
        }
        return this.requestPromise(channelName, command, arg, cancellationToken);
      },
      listen: (event: string, arg?: any) => {
        if (this.isDisposed) {
          return Event.None;
        }
        return this.requestEvent(channelName, event, arg);
      },
    } as T;
  }

  private requestPromise(
    channelName: string,
    name: string,
    arg?: any,
    cancellationToken = CancellationToken.None,
  ): Promise<any> {
    const id = this.lastRequestId++;

    if (cancellationToken.isCancellationRequested) {
      return Promise.reject(new Error("Cancelled"));
    }

    let disposable: IDisposable | undefined;
    const result = new Promise<any>((resolve, reject) => {
      this.pendingRejections.set(id, reject);
      const doRequest = () => {
        // dispose/cancel 可能发生在 Initialize 之前；此时不能再把已经 rejected
        // 的请求发送到新连接或已终结的传输上。
        if (this.isDisposed || !this.pendingRejections.has(id)) {
          return;
        }

        const handler: IHandler = (response) => {
          switch (response.type) {
            case ResponseType.PromiseSuccess:
              this.handlers.delete(id);
              this.pendingRejections.delete(id);
              resolve(response.data);
              return;
            case ResponseType.PromiseError: {
              this.handlers.delete(id);
              this.pendingRejections.delete(id);
              const error = new Error(response.data.message) as Error & Record<string, unknown>;
              error.name = response.data.name;
              if (response.data.stack) {
                error.stack = response.data.stack.join("\n");
              }
              const passthroughKeys = [
                "code",
                "kind",
                "status",
                "retryAfterMs",
                "data",
                "detail",
                "details",
                "taskId",
                "traceId",
              ] as const;
              for (const key of passthroughKeys) {
                const value = response.data[key];
                if (value !== undefined) {
                  error[key] = value;
                }
              }
              reject(error);
              return;
            }
            case ResponseType.PromiseErrorObj:
              this.handlers.delete(id);
              this.pendingRejections.delete(id);
              reject(response.data);
              return;
          }
        };

        this.handlers.set(id, handler);
        this.sendRequest(RequestType.Promise, id, channelName, name, arg);
      };

      if (this.state === State.Idle) {
        doRequest();
      } else {
        this.whenInitialized().then(doRequest);
      }

      disposable = cancellationToken.onCancellationRequested(() => {
        if (!this.pendingRejections.has(id)) {
          return;
        }
        this.sendCancelOrDispose(RequestType.PromiseCancel, id);
        this.handlers.delete(id);
        this.pendingRejections.delete(id);
        reject(new Error("Cancelled"));
      });
      this.activeRequests.add(disposable);
    });

    return result.finally(() => {
      disposable?.dispose();
      if (disposable) {
        this.activeRequests.delete(disposable);
      }
    });
  }

  private requestEvent(channelName: string, name: string, arg?: any): Event<any> {
    const id = this.lastRequestId++;
    const emitter = new Emitter<any>({
      onWillAddFirstListener: () => {
        const doRequest = () => {
          this.activeRequests.add(emitter);
          this.sendRequest(RequestType.EventListen, id, channelName, name, arg);
        };

        if (this.state === State.Idle) {
          doRequest();
        } else {
          this.whenInitialized().then(doRequest);
        }
      },
      onDidRemoveLastListener: () => {
        this.activeRequests.delete(emitter);
        this.sendCancelOrDispose(RequestType.EventDispose, id);
        this.handlers.delete(id);
      },
    });

    this.handlers.set(id, (response) => {
      emitter.fire((response as { data: any }).data);
    });

    return emitter.event;
  }

  private sendRequest(
    type: RequestType,
    id: number,
    channelName: string,
    name: string,
    arg?: any,
  ): void {
    const writer = new BufferWriter();
    serialize(writer, [type, id, channelName, name]);
    serialize(writer, arg);
    try {
      this.protocol.send(writer.buffer);
    } catch {
      /* noop */
    }
  }

  private sendCancelOrDispose(
    type: RequestType.PromiseCancel | RequestType.EventDispose,
    id: number,
  ): void {
    const writer = new BufferWriter();
    serialize(writer, [type, id]);
    serialize(writer, undefined);
    try {
      this.protocol.send(writer.buffer);
    } catch {
      /* noop */
    }
  }

  private onBuffer(message: VSBuffer): void {
    const reader = new BufferReader(message);
    const header = deserialize(reader);
    const body = deserialize(reader);
    const type = header[0] as ResponseType;

    switch (type) {
      case ResponseType.Initialize:
        // FORK(rpc-channel-manifest): 清单缺字段（旧服务端）时保持 undefined，调用方按「未知」处理
        this.onResponse({
          type: ResponseType.Initialize,
          channels: readChannelManifest(body),
        });
        return;
      case ResponseType.PromiseSuccess:
      case ResponseType.PromiseError:
      case ResponseType.EventFire:
      case ResponseType.PromiseErrorObj:
        this.onResponse({
          type,
          id: header[1],
          data: body,
        } as IRawResponse);
        return;
    }
  }

  private onResponse(response: IRawResponse): void {
    if (response.type === ResponseType.Initialize) {
      // 只在服务端确实带了清单时才覆盖：旧服务端不带该字段，不能把已有清单清成未知。
      if (response.channels) {
        this.channelManifest = response.channels;
      }
      this.state = State.Idle;
      this._onDidInitialize.fire();
      return;
    }

    this.handlers.get(response.id)?.(response);
  }

  private whenInitialized(): Promise<void> {
    if (this.state === State.Idle) {
      return Promise.resolve();
    }
    return Event.toPromise(this.onDidInitialize);
  }

  dispose(reason?: Error): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.protocolListener?.dispose();
    this.protocolListener = null;

    const rejection = reason ?? new Error("ChannelClient disposed");
    if (!reason) {
      rejection.name = "ConnectionClosed";
    }
    // 传输已终结时，所有已发出以及排队等待 Initialize 的 Promise 请求都必须
    // fail-closed。否则上层的 in-flight 去重 Promise 会永久占用 workspace key。
    for (const [id, reject] of this.pendingRejections) {
      this.pendingRejections.delete(id);
      this.handlers.delete(id);
      reject(rejection);
    }
    for (const disposable of this.activeRequests) {
      disposable.dispose();
    }
    this.activeRequests.clear();
    this.pendingRejections.clear();
    this._onDidInitialize.dispose();
  }
}

/**
 * FORK(rpc-channel-manifest): 解析 Initialize 载荷里的通道清单。
 * 只接受非空字符串数组；缺失、类型不符或空数组都返回 undefined（= 清单未知，按历史行为建代理）。
 * 空数组按「未知」处理是有意的：调用方若把「本端没注册任何通道」当真，会静默把可用服务显示成
 * 不支持，这比一次可见的超时报错更难排查；而清单非空的正常服务端不受影响。
 */
function readChannelManifest(payload: unknown): readonly string[] | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const channels = (payload as { channels?: unknown }).channels;
  if (!Array.isArray(channels) || channels.length === 0) {
    return undefined;
  }
  const names = channels.filter((name): name is string => typeof name === "string");
  return names.length === 0 ? undefined : names;
}
