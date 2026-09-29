export const WEBFETCH_TOOL_NAME = "WebFetch";
export const DEFAULT_WEBFETCH_TIMEOUT_MS = 60_000;
export const MAX_WEBFETCH_URL_CHARS = 2_000;
export const MAX_WEBFETCH_RESPONSE_BYTES = 10 * 1024 * 1024;
export const MAX_MODEL_INPUT_CHARS = 100_000;
export const MAX_WEBFETCH_MODEL_BYTES = 100_000;
// FORK(webfetch-direct-return): 单次抓取的正文内联进上下文的字节上限，由 resultBudget 消费；
// 超出即落盘为 artifact、模型只拿到头部预览与路径。见 FEATURES.md 的 webfetch-direct-return 条目。
export const MAX_WEBFETCH_INLINE_BYTES = 32 * 1024;
export const CACHE_TTL_MS = 15 * 60 * 1000;
export const CACHE_MAX_BYTES = 50 * 1024 * 1024;
export const MAX_REDIRECTS = 10;

export const WEBFETCH_USER_AGENT = "ZCode-WebFetch/0.1 (+https://zcode.ai; coding-agent-cli)";
