/**
 * 系统指令（fork）：只读文件端口。
 *
 * agent 进程直接读盘，与 `~/.zcode/AGENTS.md`、`MEMORY.md`、`~/.zcode/agents/*.md` 同模式；
 * 宿主侧服务是唯一写入方（第 2 期）。这里挂掉的正确表现是「回到系统默认继续干活」，
 * 所以任何异常都转成 diagnostic，绝不向上抛——一个坏掉的用户配置文件不该让会话起不来。
 * 见 docs/features/identity-preset/design.md 第 5、8 节。
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  FORK_IDENTITY_PRESET_PROFILE_EXTENSION,
  FORK_IDENTITY_PRESET_PROFILES_DIRNAME,
  FORK_IDENTITY_PRESET_STATE_FILENAME,
  FORK_IDENTITY_PRESET_STATE_SCHEMA_VERSION,
  isValidForkIdentityPresetId,
  parseForkIdentityPresetStateFile,
} from "@zcode/shared";

import {
  resolveActiveIdentityPreset,
  type IdentityPresetContent,
  type ResolvedIdentityPreset,
} from "./identityManager.js";
import { parseIdentityPresetFile } from "./profile-file.js";

export interface IdentityPresetLoadOutcome {
  preset?: ResolvedIdentityPreset;
  /** 非致命诊断（状态文件损坏或不被识别 / 配置目录不可读 / activeId 悬空），由 runtime 记 warn 日志。 */
  diagnostic?: string;
}

export interface IdentityPresetPort {
  loadActive(): Promise<IdentityPresetLoadOutcome>;
}

export function createFileIdentityPresetPort(input: { root: string }): IdentityPresetPort {
  return {
    loadActive: async () => loadActiveFromRoot(input.root),
  };
}

async function loadActiveFromRoot(root: string): Promise<IdentityPresetLoadOutcome> {
  const statePath = join(root, FORK_IDENTITY_PRESET_STATE_FILENAME);
  let stateText: string;
  try {
    stateText = await readFile(statePath, "utf8");
  } catch {
    // 目录或状态文件不存在 = 未启用；这是首次使用与「关了同步的机器」的正常状态。
    return {};
  }

  let raw: unknown;
  try {
    raw = JSON.parse(stateText);
  } catch {
    // 文件在但读不成 JSON：只能判定为未启用，但要让用户知道是哪个文件坏了，故带诊断而非静默。
    return { diagnostic: `${FORK_IDENTITY_PRESET_STATE_FILENAME} 不是合法 JSON，已回退系统默认` };
  }
  const unhonoredReason = describeUnhonoredState(raw);
  if (unhonoredReason !== null) {
    // 文件在场却读不懂：必须留下诊断，否则用户只看到「配置莫名不生效」，日志里什么都没有。
    return {
      diagnostic: `${FORK_IDENTITY_PRESET_STATE_FILENAME} 存在但无法识别（${unhonoredReason}），已回退系统默认`,
    };
  }
  const state = parseForkIdentityPresetStateFile(raw);
  if (!state.enabled || state.activeId === null) {
    return {};
  }

  const { profiles, directoryErrorCode } = await readProfiles(root, state.activeId);
  if (directoryErrorCode !== undefined) {
    // 目录读不到和「配置不存在」都回退系统默认，但对用户是两件事：前者要修目录权限/形态，
    // 后者要改 activeId 或补文件。这里不许把前者写成后者，否则诊断就是在误导排查方向。
    return {
      diagnostic: `${join(root, FORK_IDENTITY_PRESET_PROFILES_DIRNAME)} 目录不可读（${directoryErrorCode}），已回退系统默认`,
    };
  }
  const preset = resolveActiveIdentityPreset({ ...state, profiles });
  if (!preset) {
    return { diagnostic: `激活的配置 ${state.activeId} 不存在或为空，已回退系统默认` };
  }
  return { preset };
}

interface ReadProfilesResult {
  // 内容层：注入开关属于功能状态（由 loadActive 注入），不属于每份配置。
  profiles: Map<string, IdentityPresetContent>;
  /** 目录读不到时的 errno 码（EACCES / ENOTDIR / ENOENT…）；有值即表示「目录不可读」而非「配置不存在」。 */
  directoryErrorCode?: string;
}

async function readProfiles(root: string, activeId: string): Promise<ReadProfilesResult> {
  const profiles = new Map<string, IdentityPresetContent>();
  const dir = join(root, FORK_IDENTITY_PRESET_PROFILES_DIRNAME);
  let fileNames: string[];
  try {
    fileNames = await readdir(dir);
  } catch (error) {
    // 目录读不到（不存在 / 无权限 / 路径其实是文件）与「这份配置不存在」对激活结果等价：
    // 都回退系统默认，会话照常起来，所以吞掉异常是安全的；但错误码必须带出去，
    // 否则上层只能把「目录不可读」谎报成「配置不存在」。
    return { profiles, directoryErrorCode: describeErrorCode(error) };
  }
  for (const fileName of fileNames) {
    if (!fileName.endsWith(FORK_IDENTITY_PRESET_PROFILE_EXTENSION)) continue;
    const id = fileName.slice(0, -FORK_IDENTITY_PRESET_PROFILE_EXTENSION.length);
    if (!isValidForkIdentityPresetId(id)) continue;
    // 只读激活的那一份：列表类需求走宿主服务，agent 侧不需要为目录里每个文件付 IO。
    if (id !== activeId) continue;
    try {
      const text = await readFile(join(dir, fileName), "utf8");
      const parsed = parseIdentityPresetFile(text, id);
      profiles.set(id, { id, name: parsed.name, content: parsed.content });
    } catch {
      // 单个文件读失败（权限 / 短暂占用）与「文件不存在」对激活结果等价：都回退系统默认。
      continue;
    }
  }
  return { profiles };
}

/** 只取 errno 码：Error 对象里的 message 可能含路径等噪音，码足够区分「没权限」与「路径不是目录」。 */
function describeErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.length > 0 ? code : "未知错误";
}

/**
 * 「状态文件在场但契约不认」的窄判定：认得返回 null，否则返回可读原因。
 *
 * 为什么不在契约里做：`parseForkIdentityPresetStateFile` 刻意把「文件不存在」与「文件坏掉」
 * 归零成同一份 fallback，这样一次读取失败永远不会诱使调用方覆写用户文件。但 agent 侧必须
 * 区分二者：前者是首次使用与「关了同步的机器」的常态（不记日志），后者是用户配置坏了
 * （要留 warn 让人去修）；而这两者在解析结果上同形（用户主动关闭也是
 * `{ enabled: false, activeId: null }`），只能由读盘这一层对照原始字段判定。
 * 判定只引用契约自身的常量与导出的 id 规则，不复制其校验逻辑。
 */
function describeUnhonoredState(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) {
    return "内容不是 JSON 对象";
  }
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== FORK_IDENTITY_PRESET_STATE_SCHEMA_VERSION) {
    return `schemaVersion=${JSON.stringify(record.schemaVersion)} 不是当前支持的版本`;
  }
  if (typeof record.enabled !== "boolean") {
    return `enabled=${JSON.stringify(record.enabled)} 不是布尔值`;
  }
  if (
    record.activeId !== undefined &&
    record.activeId !== null &&
    !(typeof record.activeId === "string" && isValidForkIdentityPresetId(record.activeId))
  ) {
    return `activeId=${JSON.stringify(record.activeId)} 不符合 id 规则`;
  }
  return null;
}
