/**
 * 网络搜索渠道（fork）的数据契约。
 *
 * 渠道文件由桌面 host 的 `IForkSearchProvidersService` 独占写入，CLI 侧只读；
 * 两边的路径拼接必须走 `resolveForkSearchProvidersFilePath`，不允许各自 join——
 * 见 docs/features/search-providers/design.md §6.2（两侧漂移的症状是「UI 配了、模型用不到」）。
 */
import { ZCODE_AGENT_RUNTIME } from "../zcode-agent-runtime.js";

export const FORK_SEARCH_PROVIDERS_CHANNEL = "fork-search-providers";
export const FORK_SEARCH_PROVIDERS_FILE_VERSION = 1;
/** 相对于 CLI 配置目录（`ZCODE_AGENT_RUNTIME.nativeConfigDir`）。 */
export const FORK_SEARCH_PROVIDERS_RELATIVE_PATH = "fork/settings.json";

export interface ForkSearchProviderChannel {
  id: string;
  kind: "tavily";
  /** 仅 UI 标签：不进入模型可见内容，也不写进日志。 */
  label: string;
  enabled: boolean;
  apiKey: string;
}

export interface ForkSearchProvidersFile {
  version: number;
  channels: ForkSearchProviderChannel[];
}

export const EMPTY_FORK_SEARCH_PROVIDERS_FILE: ForkSearchProvidersFile = Object.freeze({
  version: FORK_SEARCH_PROVIDERS_FILE_VERSION,
  channels: [],
});

/**
 * 路径拼接的唯一实现。刻意不用 node:path，因为本模块会被浏览器侧（packages/ui）导入；
 * `/` 对 Node 的 fs API 在 Windows 上同样可用。
 */
export function resolveForkSearchProvidersFilePath(homeDir: string): string {
  return [homeDir, ZCODE_AGENT_RUNTIME.nativeConfigDir, FORK_SEARCH_PROVIDERS_RELATIVE_PATH].join(
    "/",
  );
}

/**
 * 容错解析：坏数据一律降级为「少几条渠道」，绝不抛给调用方使其启动失败。
 * 返回的 problems 会进日志，因此**不得**包含 apiKey 或 label。
 */
export function parseForkSearchProvidersFile(raw: unknown): {
  file: ForkSearchProvidersFile;
  problems: string[];
} {
  if (!isRecord(raw)) {
    return { file: { ...EMPTY_FORK_SEARCH_PROVIDERS_FILE }, problems: ["配置不是 JSON 对象"] };
  }

  const version = typeof raw.version === "number" ? raw.version : FORK_SEARCH_PROVIDERS_FILE_VERSION;
  if (version !== FORK_SEARCH_PROVIDERS_FILE_VERSION) {
    return {
      file: { version, channels: [] },
      problems: [`不支持的配置版本 ${version}，已按无渠道处理`],
    };
  }

  if (!Array.isArray(raw.channels)) {
    return { file: { version, channels: [] }, problems: ["channels 不是数组"] };
  }

  const channels: ForkSearchProviderChannel[] = [];
  const problems: string[] = [];
  raw.channels.forEach((entry, index) => {
    if (!isRecord(entry)) {
      problems.push(`第 ${index + 1} 条渠道不是对象，已忽略`);
      return;
    }
    if (typeof entry.id !== "string" || entry.id.trim() === "") {
      problems.push(`第 ${index + 1} 条渠道缺少 id，已忽略`);
      return;
    }
    if (entry.kind !== "tavily") {
      problems.push(`渠道 ${entry.id} 的类型不受支持，已忽略`);
      return;
    }
    if (typeof entry.apiKey !== "string") {
      problems.push(`渠道 ${entry.id} 缺少 apiKey，已忽略`);
      return;
    }
    channels.push({
      id: entry.id,
      kind: "tavily",
      label: typeof entry.label === "string" ? entry.label : "",
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
      apiKey: entry.apiKey,
    });
  });

  return { file: { version, channels }, problems };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
