import type { CancellationToken, Event } from "./foundation.js";

export interface IChannel {
  call<T>(command: string, arg?: any, cancellationToken?: CancellationToken): Promise<T>;
  listen<T>(event: string, arg?: any): Event<T>;
}

export interface IServerChannel<TContext = string> {
  call<T>(
    ctx: TContext,
    command: string,
    arg?: any,
    cancellationToken?: CancellationToken,
  ): Promise<T>;
  listen<T>(ctx: TContext, event: string, arg?: any): Event<T>;
}

export const enum RequestType {
  Promise = 100,
  PromiseCancel = 101,
  EventListen = 102,
  EventDispose = 103,
}

export const enum ResponseType {
  Initialize = 200,
  PromiseSuccess = 201,
  PromiseError = 202,
  PromiseErrorObj = 203,
  EventFire = 204,
}

export type IRawResponse =
  | {
      type: ResponseType.Initialize;
      // FORK(rpc-channel-manifest): 已注册通道清单；旧服务端不带该字段（undefined = 清单未知）
      channels?: readonly string[];
    }
  | { type: ResponseType.PromiseSuccess; id: number; data: any }
  | {
      type: ResponseType.PromiseError;
      id: number;
      data: {
        message: string;
        name: string;
        stack: string[] | undefined;
        code?: unknown;
        kind?: unknown;
        status?: unknown;
        retryAfterMs?: unknown;
        data?: unknown;
        detail?: unknown;
        details?: unknown;
        taskId?: unknown;
        traceId?: unknown;
      };
    }
  | { type: ResponseType.PromiseErrorObj; id: number; data: any }
  | { type: ResponseType.EventFire; id: number; data: any };

export type IHandler = (response: IRawResponse) => void;

export interface IChannelServer<TContext = string> {
  registerChannel(channelName: string, channel: IServerChannel<TContext>): void;
  ready?(): void;
}

export interface IChannelClient {
  getChannel<T extends IChannel>(channelName: string): T;
  // FORK(rpc-channel-manifest): 服务端在 Initialize 里声明的已注册通道清单；旧服务端不含该字段时为 undefined
  channelNames?(): readonly string[] | undefined;
  // FORK(rpc-channel-manifest): Initialize 是否已到达。调用方据此判断「清单未知」是握手未完成还是旧服务端
  isInitialized?(): boolean;
  // FORK(rpc-channel-manifest): Initialize 到达时触发；订阅方据此重新判定通道可用性
  readonly onDidInitialize?: Event<void>;
}
