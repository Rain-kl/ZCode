/**
 * WebFetch 短内容直通策略（二开）。
 *
 * 规则与口径见 docs/features/webfetch-direct-passthrough/design.md：
 * 正文去掉标点后 < 15000 字、发起本次调用的请求剩余上下文预算 >= 30000、
 * 且原始长度仍在模型输入上限内时，跳过「加工模型」总结，直接把正文交给调用方模型。
 *
 * 三个条件都是 fail-safe 方向：任何一条不满足（含预算不可得）都回落到上游的两段式流程。
 */

/** 去标点后的字数上限：严格小于才直通。 */
export const FORK_WEBFETCH_DIRECT_MAX_CONTENT_CHARS = 15_000;
/** 剩余上下文预算下限（token，runtime 自己的估算口径）。 */
export const FORK_WEBFETCH_DIRECT_MIN_REMAINING_TOKENS = 30_000;
/**
 * 原始字符上限，与 webfetch-constants 的 MAX_MODEL_INPUT_CHARS 同值。
 * 「几乎全是标点」的页面可以让人数为 0 地去标点字数，没有这道守卫就会把巨量正文灌进上下文。
 */
export const FORK_WEBFETCH_DIRECT_MAX_RAW_CHARS = 100_000;

const PUNCTUATION_PATTERN = /\p{P}/u;

export type ForkWebfetchDirectReason =
  | "direct"
  | "content_too_long"
  | "content_too_long_raw"
  | "remaining_unknown"
  | "remaining_insufficient";

export interface ForkWebfetchDirectDecision {
  direct: boolean;
  reason: ForkWebfetchDirectReason;
  /** 去标点后的码点数；原始长度守卫先触发时不做计数，为 undefined。 */
  contentChars: number | undefined;
}

/**
 * 统计「字数」：Unicode 码点数量，排除 `P*`（标点）类字符。
 * 空白、换行、`S*`（符号，如 `+` `=` `$`）都计入——保守方向，只会更早回落总结。
 */
export function countForkWebfetchContentChars(content: string): number {
  let count = 0;
  for (const character of content) {
    if (PUNCTUATION_PATTERN.test(character)) continue;
    count += 1;
  }
  return count;
}

export function decideForkWebfetchDirectPassThrough(input: {
  content: string;
  remainingContextTokens: number | undefined;
}): ForkWebfetchDirectDecision {
  // 长度守卫先于逐字符计数：它只读 length，也是唯一能拦住「标点灌水」的判定。
  if (input.content.length > FORK_WEBFETCH_DIRECT_MAX_RAW_CHARS) {
    return { direct: false, reason: "content_too_long_raw", contentChars: undefined };
  }

  const contentChars = countForkWebfetchContentChars(input.content);
  if (contentChars >= FORK_WEBFETCH_DIRECT_MAX_CONTENT_CHARS) {
    return { direct: false, reason: "content_too_long", contentChars };
  }

  const remaining = input.remainingContextTokens;
  if (remaining === undefined || !Number.isFinite(remaining)) {
    return { direct: false, reason: "remaining_unknown", contentChars };
  }
  if (remaining < FORK_WEBFETCH_DIRECT_MIN_REMAINING_TOKENS) {
    return { direct: false, reason: "remaining_insufficient", contentChars };
  }

  return { direct: true, reason: "direct", contentChars };
}
