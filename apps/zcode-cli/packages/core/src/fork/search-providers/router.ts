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

function describeThrown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function runSearchChannels(input: {
  channels: readonly SearchChannel[];
  request: SearchChannelRequest;
}): Promise<SearchChannelOutcome> {
  const attempts: SearchChannelFailure[] = [];

  for (const channel of input.channels) {
    try {
      const result = await channel.search(input.request);
      return {
        result,
        channelKind: channel.kind,
        channelLabel: channel.label,
        attempts: [...attempts],
      };
    } catch (error) {
      attempts.push({
        channelKind: channel.kind,
        channelLabel: channel.label,
        reason: describeThrown(error),
      });
    }
  }

  throw new SearchChannelsExhaustedError(attempts);
}
