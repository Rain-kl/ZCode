const PERSISTED_OUTPUT_OPEN_TAG = "<persisted-output>";
const PERSISTED_OUTPUT_CLOSE_TAG = "</persisted-output>";
// Artifact strategy uses resultBudget as the persistence trigger; once persisted, this independent
// preview budget controls the provider-visible <persisted-output> snippet.
const PERSISTED_OUTPUT_PREVIEW_CHARS = 2_000;

interface PersistedOutputEnvelopeInput {
  content: string;
  formatBytes: (bytes: number) => string;
  originalBytes: number;
  persistedPath: string;
  previewChars: number;
}

// FORK(webfetch-direct-return): 默认预览 2,000 字符对抓取正文偏短（表格、版本列表会被截掉），
// 故允许调用方覆写长度；其余工具不传即保持 2,000 不变。见 FEATURES.md 的 webfetch-direct-return 条目。
export function formatGenericPersistedOutputContent(input: {
  content: string;
  originalBytes: number;
  persistedPath: string;
  previewChars?: number;
}): string {
  return formatPersistedOutputEnvelope({
    content: input.content,
    formatBytes: formatDecimalBytes,
    originalBytes: input.originalBytes,
    persistedPath: input.persistedPath,
    previewChars: input.previewChars ?? PERSISTED_OUTPUT_PREVIEW_CHARS,
  });
}

export function formatPersistedOutputEnvelope(input: PersistedOutputEnvelopeInput): string {
  const preview = previewFirstChars(input.content, input.previewChars);
  return [
    PERSISTED_OUTPUT_OPEN_TAG,
    `Output too large (${input.formatBytes(input.originalBytes)}). Full output saved to: ${input.persistedPath}`,
    "",
    `Preview (first ${input.formatBytes(input.previewChars)}):`,
    preview.preview,
    preview.hasMore ? "..." : undefined,
    PERSISTED_OUTPUT_CLOSE_TAG,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export function isPersistedOutputContent(content: string): boolean {
  return (
    content.startsWith(PERSISTED_OUTPUT_OPEN_TAG) && content.includes(PERSISTED_OUTPUT_CLOSE_TAG)
  );
}

function previewFirstChars(
  content: string,
  maxChars: number,
): { preview: string; hasMore: boolean } {
  if (content.length <= maxChars) return { preview: content, hasMore: false };

  const newlineIndex = content.slice(0, maxChars).lastIndexOf("\n");
  const endIndex = newlineIndex > maxChars * 0.5 ? newlineIndex : maxChars;
  return {
    preview: content.slice(0, endIndex),
    hasMore: true,
  };
}

function formatDecimalBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${Math.round(bytes / 1_000_000_000)} GB`;
}
