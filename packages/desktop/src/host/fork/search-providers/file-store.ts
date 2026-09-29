/**
 * 网络搜索渠道（fork）文件存储实现。
 *
 * 只做文件 IO 与容错，不做业务判断。
 * 路径由 service 层传入，确保解析唯一真源。
 * 见 docs/features/search-providers/design.md §6.3 与 §6.4。
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  EMPTY_FORK_SEARCH_PROVIDERS_FILE,
  parseForkSearchProvidersFile,
  type ForkSearchProvidersFile,
} from "@zcode/shared";

export interface ForkSearchProvidersFileStore {
  read(): Promise<{ file: ForkSearchProvidersFile; problems: string[] }>;
  write(file: ForkSearchProvidersFile): Promise<void>;
}

export function createForkSearchProvidersFileStore(input: {
  filePath: string;
  logger?: { warn(message: string, detail?: unknown): void };
}): ForkSearchProvidersFileStore {
  const logger = input.logger ?? { warn: () => {} };

  return {
    async read() {
      let raw: string;
      try {
        raw = await readFile(input.filePath, "utf8");
      } catch (error) {
        // 文件不存在是正常状态（还没配过渠道）；其它读失败同样降级——
        // 渠道文件是可选项，不能让设置页整页打不开。
        // EMPTY_FORK_SEARCH_PROVIDERS_FILE 为深冻结常量，此处必须返回全新的 channels 数组实例，
        // 绝不复用其 channels，防止调用方修改污染单例。
        if (!isNotFound(error)) {
          logger.warn(`[search-providers] 读取渠道文件失败: ${describe(error)}`);
        }
        return { file: { ...EMPTY_FORK_SEARCH_PROVIDERS_FILE, channels: [] }, problems: [] };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch (error) {
        logger.warn(`[search-providers] 渠道文件不是合法 JSON: ${describe(error)}`);
        return {
          file: { ...EMPTY_FORK_SEARCH_PROVIDERS_FILE, channels: [] },
          problems: ["JSON 解析失败"],
        };
      }
      const result = parseForkSearchProvidersFile(parsed);
      for (const problem of result.problems) {
        logger.warn(`[search-providers] ${problem}`);
      }
      return result;
    },
    async write(file) {
      // 并发边界：
      // 同一 host 进程内的多次编辑由 service.ts 的 promise 队列串行化，不会出现读-改-写交错；
      // 跨窗口（多 host 进程）与 WebDAV 恢复并发时是整份文件 last-write-wins。
      // 这里刻意不引入文件锁：WebDAV 那把锁是 webdav/service.ts 的私有实现，抽出来要动已交付的功能；
      // 而且即便加锁，两个「整体替换同一份文件」的意图依然是语义冲突，锁只能把它们排队、仍会丢掉其中一个。
      // 原子 rename 已经消除了真正危险的部分（读到半截文件）。
      await mkdir(dirname(input.filePath), { recursive: true });
      const temporaryPath = `${input.filePath}.${process.pid}.tmp`;
      // 临时文件 + rename：读者永远看不到半截文件（CLI 侧是 statSync+readFileSync，必须有这个保证）。
      // 显式 mode: 0o600 限制仅所有者可读写，保护包含明文 apiKey 的渠道文件。
      await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporaryPath, input.filePath);
    },
  };
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT"
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
