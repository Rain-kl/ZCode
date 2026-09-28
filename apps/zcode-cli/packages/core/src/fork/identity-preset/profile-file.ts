/**
 * 系统指令（fork）：单个配置文件的 frontmatter 解析与序列化。
 *
 * 格式与 `~/.zcode/agents/*.md` 同构，但不复用那份带完整字段的 YAML 解析器：
 * 这里只需要一个 `name`，引入 YAML 解析器会让「用户手改出一个语法错误」变成整份配置读不出来。
 * 只认第一段 frontmatter 里的 `name:` 行，其余原样交回正文，坏输入退化为「用文件名当名字」。
 * 见 docs/features/identity-preset/design.md 第 5.2 节。
 */
import { normalizeForkIdentityPresetName } from "@zcode/shared";

// 空 frontmatter（`---\n---\nbody`）也要吃掉两行分隔符：否则 `---` 会原样进入系统提示词正文。
// 放宽后捕获组可能缺席，读取侧用 `?? ""` 兜住（未闭合的 frontmatter 仍整体当正文，不放行）。
const FRONTMATTER_PATTERN = /^---\r?\n(?:([\s\S]*?)\r?\n)?---\r?\n?/;
const NAME_LINE_PATTERN = /^name:[ \t]*(.*)$/m;

export interface ParsedIdentityPresetFile {
  name: string;
  content: string;
}

export function parseIdentityPresetFile(
  text: string,
  fallbackName: string,
): ParsedIdentityPresetFile {
  const match = FRONTMATTER_PATTERN.exec(text);
  const body = (match ? text.slice(match[0].length) : text).trim();
  const rawName = match ? NAME_LINE_PATTERN.exec(match[1] ?? "")?.[1] : undefined;
  const name = rawName === undefined ? null : stripQuotes(rawName);
  return {
    name: normalizeForkIdentityPresetName(name ?? "") ?? fallbackName,
    content: body,
  };
}

export function serializeIdentityPresetFile(profile: { name: string; content: string }): string {
  return `---\nname: ${profile.name}\n---\n\n${profile.content}\n`;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && /^".*"$/.test(trimmed)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
