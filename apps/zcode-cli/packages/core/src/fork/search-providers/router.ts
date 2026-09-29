import type { SearchChannel, SearchChannelFailure, SearchChannelOutcome, SearchChannelRequest } from "./channel.js";

export type { SearchChannel, SearchChannelFailure, SearchChannelOutcome, SearchChannelRequest };

/**
 * 渠道链走完仍未成功。
 *
 * 逐条携带失败原因：把不同渠道的不同失败压成一句「搜索失败」会让
 * 「为什么绕过了服务端搜索」永远查不出来（AGENTS.md 代码规范 7）。
 * failures 的顺序 = 尝试顺序。
 */
export class SearchChannelsExhaustedError extends Error {
  readonly failures: readonly SearchChannelFailure[];

  constructor(failures: readonly SearchChannelFailure[]) {
    super(formatExhaustedMessage(failures));
    this.name = "SearchChannelsExhaustedError";
    this.failures = failures;
  }
}

function formatExhaustedMessage(failures: readonly SearchChannelFailure[]): string {
  if (failures.length === 0) {
    return "No search channel is available";
  }
  const details = failures
    .map((failure) => `${failure.channelKind}(${failure.channelLabel}): ${failure.reason}`)
    .join("; ");
  return `All search channels failed: ${details}`;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  if (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError") {
    return true;
  }
  return false;
}

function describeThrown(error: unknown): string {
  if (error instanceof Error) {
    const trimmedMessage = error.message.trim();
    // 错误消息为空串时回落到错误类型名称，避免排查时丢失错误上下文
    return trimmedMessage.length > 0 ? trimmedMessage : error.name;
  }
  if (typeof error === "object" && error !== null) {
    try {
      const json = JSON.stringify(error);
      if (json !== undefined) {
        return json;
      }
    } catch {
      // 循环引用导致序列化失败时回落到对象默认字符串
    }
  }
  return String(error);
}

export async function runSearchChannels(input: {
  channels: readonly SearchChannel[];
  request: SearchChannelRequest;
}): Promise<SearchChannelOutcome> {
  // 调用前已中断则直接抛出，避免无意义的渠道执行
  if (input.request.signal !== undefined) {
    input.request.signal.throwIfAborted();
  }

  const attempts: SearchChannelFailure[] = [];

  for (const channel of input.channels) {
    // 降级尝试每轮执行前检查中断状态，防止用户取消后继续调用后续渠道产生成本
    if (input.request.signal !== undefined) {
      input.request.signal.throwIfAborted();
    }

    try {
      const result = await channel.search(input.request);
      return {
        result,
        channelKind: channel.kind,
        channelLabel: channel.label,
        attempts: [...attempts],
      };
    } catch (error) {
      // 中断属于整次调用被取消而非单个渠道失败，必须直接重抛而不能进入降级重试
      if ((input.request.signal !== undefined && input.request.signal.aborted) || isAbortError(error)) {
        throw error;
      }
      attempts.push({
        channelKind: channel.kind,
        channelLabel: channel.label,
        reason: describeThrown(error),
      });
    }
  }

  throw new SearchChannelsExhaustedError(attempts);
}
