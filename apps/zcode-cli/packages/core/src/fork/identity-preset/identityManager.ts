/**
 * 系统指令（fork）：受控身份段的构造与激活项解析。
 *
 * 对外只做两件事：把用户配置变成与 `context/sections/identity.ts` 同构的 ContextSection，
 * 以及「开关 + 激活 id + 配置集合 → 生效的那一份」。解析细节（frontmatter、状态文件容错）
 * 分别归 profile-file.ts 与 shared 的契约。
 * 见 docs/features/identity-preset/design.md 第 6 节。
 */
import type { ContextSection } from "../../context/types.js";
import { estimateTokens } from "../../context/utils.js";

export interface ResolvedIdentityPreset {
  id: string;
  name: string;
  content: string;
}

export function buildIdentityPresetSection(preset: ResolvedIdentityPreset): ContextSection {
  const content = preset.content;
  return {
    name: "Agent Identity",
    // 沿用 `identity` 这个 source：下游（assembleSystemMessages 的缓存分层、context 用量
    // 统计、恢复快照）都按 source 分流，换一个新 source 会让这些地方各漏一路。
    source: "identity",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}

export function resolveActiveIdentityPreset(input: {
  enabled: boolean;
  activeId: string | null;
  profiles: ReadonlyMap<string, ResolvedIdentityPreset>;
}): ResolvedIdentityPreset | undefined {
  if (!input.enabled || input.activeId === null) return undefined;
  const preset = input.profiles.get(input.activeId);
  // 悬空 activeId 等同关闭：让会话回到系统默认，而不是让 agent 起不来。
  if (!preset || preset.content.trim().length === 0) return undefined;
  return preset;
}
