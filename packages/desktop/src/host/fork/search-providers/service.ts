/**
 * 网络搜索渠道（fork）宿主服务实现。
 *
 * 桌面 host 的 `IForkSearchProvidersService` 独占写入，渲染层经 RPC 调用。
 * 路径由 resolveForkSearchProvidersFilePath(homedir()) 统一解析，保证与 CLI 侧唯一真源一致。
 * 进程内写操作通过 Promise 队列串行化；跨进程整份文件 last-write-wins。
 * 见 docs/features/search-providers/design.md §3, §6.2, §6.4, §10.3。
 */
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import type { IForkSearchProvidersService } from "@zcode/services";
import {
  FORK_SEARCH_PROVIDERS_FILE_VERSION,
  resolveForkSearchProvidersFilePath,
  type ForkSearchProviderChannel,
  type ForkSearchProvidersFile,
} from "@zcode/shared";
import {
  createForkSearchProvidersFileStore,
  type ForkSearchProvidersFileStore,
} from "./file-store.js";

export function createForkSearchProvidersService(options?: {
  store?: ForkSearchProvidersFileStore;
  logger?: { warn(message: string, detail?: unknown): void };
}): IForkSearchProvidersService {
  // 路径的唯一真源是 CLI 配置目录（homedir + nativeConfigDir）。
  // 刻意不用 getDataBaseDir()/getZCodeDataRootDir()：它们在隔离 home / ZCODE_DATA_BASE_DIR
  // 下会与 CLI 的解析分叉，症状是「UI 配了、模型用不到」。见 design.md §6.2。
  const store =
    options?.store ??
    createForkSearchProvidersFileStore({
      filePath: resolveForkSearchProvidersFilePath(homedir()),
      logger: options?.logger,
    });

  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
  }

  return {
    async list(): Promise<ForkSearchProvidersFile> {
      return enqueue(async () => {
        const { file } = await store.read();
        return file;
      });
    },

    async addChannel(input: {
      kind: "tavily";
      label: string;
      apiKey: string;
    }): Promise<ForkSearchProvidersFile> {
      return enqueue(async () => {
        const { file } = await store.read();
        const newChannel: ForkSearchProviderChannel = {
          id: randomUUID(),
          kind: input.kind,
          // label 原样保存，不得截断；且不得写进日志
          label: input.label,
          enabled: true,
          apiKey: input.apiKey,
        };
        const nextFile: ForkSearchProvidersFile = {
          version: FORK_SEARCH_PROVIDERS_FILE_VERSION,
          channels: [...file.channels, newChannel],
        };
        await store.write(nextFile);
        return nextFile;
      });
    },

    async updateChannel(
      id: string,
      patch: { label?: string; apiKey?: string; enabled?: boolean },
    ): Promise<ForkSearchProvidersFile> {
      return enqueue(async () => {
        const { file } = await store.read();
        const nextChannels = file.channels.map((channel) => {
          if (channel.id !== id) {
            return channel;
          }
          return {
            ...channel,
            label: patch.label !== undefined ? patch.label : channel.label,
            apiKey: patch.apiKey !== undefined ? patch.apiKey : channel.apiKey,
            enabled: patch.enabled !== undefined ? patch.enabled : channel.enabled,
          };
        });
        const nextFile: ForkSearchProvidersFile = {
          version: FORK_SEARCH_PROVIDERS_FILE_VERSION,
          channels: nextChannels,
        };
        await store.write(nextFile);
        return nextFile;
      });
    },

    async removeChannel(id: string): Promise<ForkSearchProvidersFile> {
      return enqueue(async () => {
        const { file } = await store.read();
        const nextChannels = file.channels.filter((channel) => channel.id !== id);
        const nextFile: ForkSearchProvidersFile = {
          version: FORK_SEARCH_PROVIDERS_FILE_VERSION,
          channels: nextChannels,
        };
        await store.write(nextFile);
        return nextFile;
      });
    },

    async reorder(ids: string[]): Promise<ForkSearchProvidersFile> {
      return enqueue(async () => {
        const { file } = await store.read();
        const map = new Map(file.channels.map((c) => [c.id, c]));
        const nextChannels: ForkSearchProviderChannel[] = [];
        const seen = new Set<string>();

        for (const id of ids) {
          const channel = map.get(id);
          if (channel && !seen.has(id)) {
            seen.add(id);
            nextChannels.push(channel);
          }
        }
        for (const channel of file.channels) {
          if (!seen.has(channel.id)) {
            nextChannels.push(channel);
          }
        }

        const nextFile: ForkSearchProvidersFile = {
          version: FORK_SEARCH_PROVIDERS_FILE_VERSION,
          channels: nextChannels,
        };
        await store.write(nextFile);
        return nextFile;
      });
    },
  };
}
