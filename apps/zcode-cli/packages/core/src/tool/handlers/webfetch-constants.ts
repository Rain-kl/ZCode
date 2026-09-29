export const WEBFETCH_TOOL_NAME = "WebFetch";
export const DEFAULT_WEBFETCH_TIMEOUT_MS = 60_000;
export const MAX_WEBFETCH_URL_CHARS = 2_000;
export const MAX_WEBFETCH_RESPONSE_BYTES = 10 * 1024 * 1024;
export const MAX_MODEL_INPUT_CHARS = 100_000;
export const MAX_WEBFETCH_MODEL_BYTES = 100_000;
// FORK(webfetch-direct-return): 落盘的**字符**阈值（用户口径的「字」＝ UTF-16 字符），
// 超过它才把正文落盘为 artifact；见 FEATURES.md 的 webfetch-direct-return 条目。
export const MAX_WEBFETCH_PERSIST_CHARS = 15_000;
// FORK(webfetch-direct-return): 落盘后模型可见的预览长度。共享信封默认 2,000 字符，对抓取正文太短，
// 这里单独提高到 10,000 字符；见 FEATURES.md 的 webfetch-direct-return 条目。
export const MAX_WEBFETCH_PERSIST_PREVIEW_CHARS = 10_000;
export const CACHE_TTL_MS = 15 * 60 * 1000;
export const CACHE_MAX_BYTES = 50 * 1024 * 1024;
export const MAX_REDIRECTS = 10;

export const WEBFETCH_USER_AGENT = "ZCode-WebFetch/0.1 (+https://zcode.ai; coding-agent-cli)";
