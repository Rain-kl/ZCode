import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import type { HttpClientPort, Model, ModelTextResult } from "@zcode/contracts";
import {
  parseForkSearchProvidersFile,
  resolveForkSearchProvidersFilePath,
  type ForkSearchProviderChannel,
} from "@zcode/shared";
import { createTavilyChannel } from "./tavily.js";
import type { SearchChannel, SearchChannelRequest } from "./channel.js";

interface CacheEntry {
  channels: ForkSearchProviderChannel[];
  mtimeMs: number;
}

/**
 * 模块级缓存：暴露门是同步的（`shouldExposeWebSearch` 在 getTools 里），
 * 所以这里用 statSync 判失效、只在 mtime 变化时读文件。
 * 缓存键是文件路径，进程内共享（渠道文件本来就是每用户一份，不是每会话一份）。
 */
const cache = new Map<string, CacheEntry>();

/** 测试与「用户刚改完设置」的强制失效入口。 */
export function resetSearchChannelCacheForTests(): void {
  cache.clear();
}

function readChannels(filePath: string): ForkSearchProviderChannel[] {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(filePath).mtimeMs;
  } catch {
    // 文件不存在是正常状态（独立 CLI 从未配置过渠道）。
    cache.delete(filePath);
    return [];
  }

  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.channels;
  }

  let channels: ForkSearchProviderChannel[] = [];
  try {
    const parsed = parseForkSearchProvidersFile(JSON.parse(readFileSync(filePath, "utf8")) as unknown);
    channels = parsed.file.channels;
    for (const problem of parsed.problems) {
      // 渠道文件是可选项：坏配置降级为「少几条渠道」，但必须留痕，
      // 否则用户改了配置却看不到任何反馈。这里不含 apiKey/label。
      console.warn(`[search-providers] ${problem}`);
    }
  } catch (error) {
    console.warn(
      `[search-providers] 渠道文件无法解析，已按无渠道处理: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    channels = [];
  }

  cache.set(filePath, { channels, mtimeMs });
  return channels;
}

/** 渠道契约（含 id / label / enabled / apiKey），供 UI 侧组装与计数使用。 */
export function loadForkSearchProviderChannels(options: { homeDir?: string } = {}): ForkSearchProviderChannel[] {
  const home = options.homeDir !== undefined ? options.homeDir : homedir();
  return readChannels(resolveForkSearchProvidersFilePath(home));
}

/** 可调用的渠道链：只含启用中的 Tavily 渠道，顺序即降级顺序。 */
export function loadForkSearchChannels(input: {
  homeDir?: string;
  httpClientPort: HttpClientPort;
}): (SearchChannel & { id: string })[] {
  return loadForkSearchProviderChannels(input)
    .filter((channel) => channel.enabled)
    .map((channel) =>
      Object.assign(
        createTavilyChannel({
          label: channel.label,
          apiKey: channel.apiKey,
          httpClientPort: input.httpClientPort,
        }),
        { id: channel.id },
      ),
    );
}

/**
 * 渠道数 = (模型支持服务端搜索 ? 1 : 0) + 启用中的 Tavily 渠道数。
 * 这是工具暴露门唯一的输入（0 → 不暴露）。
 */
export function countAvailableSearchChannels(input: {
  model: Model | undefined;
  homeDir?: string;
}): number {
  const serverCount =
    input.model !== undefined && input.model.properties.supportsNativeWebSearch === true ? 1 : 0;
  const tavilyCount = loadForkSearchProviderChannels(input).filter((c) => c.enabled).length;
  return serverCount + tavilyCount;
}

/** 渠道链的第一环：服务端搜索。其执行体由上游 websearch.ts 注入（Task 6）。 */
export function createServerSearchChannel(input: {
  label: string;
  execute: (request: SearchChannelRequest) => Promise<ModelTextResult>;
}): SearchChannel {
  return { kind: "server", label: input.label, search: input.execute };
}

export function buildSearchChannelChain(input: {
  homeDir?: string;
  httpClientPort?: HttpClientPort;
  serverChannel?: SearchChannel;
}): SearchChannel[] {
  const chain: SearchChannel[] = [];
  if (input.serverChannel) chain.push(input.serverChannel);
  if (input.httpClientPort) {
    chain.push(...loadForkSearchChannels({ ...input, httpClientPort: input.httpClientPort }));
  }
  return chain;
}

