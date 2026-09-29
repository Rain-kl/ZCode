import {
  isHttpClientPortError,
  type HttpClientPort,
  type HttpClientRequest,
  type HttpClientResponse,
  type ModelTextResult,
} from "@zcode/contracts";
import type { SearchChannel, SearchChannelRequest } from "./channel.js";

export const TAVILY_SEARCH_ENDPOINT = "https://api.tavily.com/search";
const TAVILY_DEFAULT_TIMEOUT_MS = 30_000;
/** 厂商上限，见官方 OpenAPI 的 include_domains / exclude_domains 约束。 */
const TAVILY_MAX_INCLUDE_DOMAINS = 300;
const TAVILY_MAX_EXCLUDE_DOMAINS = 150;

export interface TavilyResultItem {
  url: string;
  title?: string;
  pageAge?: string;
}

export function buildTavilySearchRequest(input: {
  query: string;
  apiKey: string;
  allowedDomains?: string[];
  blockedDomains?: string[];
  maxResults?: number;
  maxUses?: number;
}): HttpClientRequest {
  const body: Record<string, unknown> = { query: input.query };
  if (input.maxResults !== undefined) body.max_results = input.maxResults;
  const include = input.allowedDomains?.slice(0, TAVILY_MAX_INCLUDE_DOMAINS);
  if (include && include.length > 0) body.include_domains = include;
  const exclude = input.blockedDomains?.slice(0, TAVILY_MAX_EXCLUDE_DOMAINS);
  if (exclude && exclude.length > 0) body.exclude_domains = exclude;
  // input.maxUses 有意忽略：Tavily 只发一次请求，「搜几次」对它没有意义。

  return {
    url: TAVILY_SEARCH_ENDPOINT,
    method: "POST",
    headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
    body: new TextEncoder().encode(JSON.stringify(body)),
    timeoutMs: TAVILY_DEFAULT_TIMEOUT_MS,
  };
}

interface NormalizedTavilyEntry {
  url: string;
  title?: string;
  pageAge?: string;
  content: string;
}

/**
 * 校验并规范化单条 Tavily 结果。
 * URL 必须为非空字符串；标题若为空串则回退到 undefined（便于 items 表达与 text 回退到 url）。
 */
function normalizeTavilyEntry(entry: unknown): NormalizedTavilyEntry | undefined {
  if (!isRecord(entry) || typeof entry.url !== "string" || entry.url === "") {
    return undefined;
  }
  return {
    url: entry.url,
    title: typeof entry.title === "string" && entry.title !== "" ? entry.title : undefined,
    pageAge:
      // 实测：真实响应默认不含 published_date（只在显式请求或 topic=news 时出现）。
      // 这里保持宽容读取、但不为了它加 include_published_date（beta 且无消费方）。
      typeof entry.published_date === "string" && entry.published_date !== ""
        ? entry.published_date
        : undefined,
    content: typeof entry.content === "string" ? entry.content.trim() : "",
  };
}

export function mapTavilyResponse(payload: unknown): { items: TavilyResultItem[]; text: string } {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new Error("Tavily response has no results array");
  }

  const entries: NormalizedTavilyEntry[] = payload.results.flatMap((entry) => {
    const normalized = normalizeTavilyEntry(entry);
    return normalized !== undefined ? [normalized] : [];
  });

  const items: TavilyResultItem[] = entries.map((entry) => ({
    url: entry.url,
    title: entry.title,
    pageAge: entry.pageAge,
  }));

  const text = entries
    .map((entry) => {
      const displayTitle = entry.title ?? entry.url;
      return `- ${displayTitle} (${entry.url})${entry.content ? `: ${entry.content}` : ""}`;
    })
    .join("\n");

  return { items, text };
}

/** 把状态码与厂商错误消息合成一句可诊断的原因；厂商消息缺失时不编造。 */
export function classifyTavilyFailure(status: number, bodyText: string, statusText: string): string {
  const vendorMessage = extractVendorError(bodyText);
  const base = `Tavily search failed with HTTP ${status} ${statusText}`.trim();
  return vendorMessage ? `${base}: ${vendorMessage}` : base;
}

function extractVendorError(bodyText: string): string | undefined {
  // 厂商 detail 有三种形状：对象（400/401/429/432/433/500）、数组（422 的 pydantic 校验错误）、
  // 纯字符串（405，我们不会触发）。只承诺前两种；其余退回状态码，不编造消息。
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (!isRecord(parsed)) return undefined;
    const detail = parsed.detail;
    if (isRecord(detail) && typeof detail.error === "string") return detail.error;
    if (Array.isArray(detail)) {
      const messages = detail.flatMap((entry) =>
        isRecord(entry) && typeof entry.msg === "string" ? [entry.msg] : [],
      );
      if (messages.length > 0) return messages.join("; ");
    }
  } catch {
    // 非 JSON 错误体（网关 HTML 等）：交给状态码表达，不编造消息。
    return undefined;
  }
  return undefined;
}

export function createTavilyChannel(input: {
  label: string;
  apiKey: string;
  httpClientPort: HttpClientPort;
  timeoutMs?: number;
}): SearchChannel {
  return {
    kind: "tavily",
    label: input.label,
    async search(request: SearchChannelRequest): Promise<ModelTextResult> {
      const httpRequest = buildTavilySearchRequest({
        query: request.query,
        apiKey: input.apiKey,
        ...(request.allowedDomains ? { allowedDomains: request.allowedDomains } : {}),
        ...(request.blockedDomains ? { blockedDomains: request.blockedDomains } : {}),
        ...(request.maxResults === undefined ? {} : { maxResults: request.maxResults }),
      });

      let response: HttpClientResponse;
      try {
        response = await input.httpClientPort.request(
          { ...httpRequest, ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }) },
          request.signal ? { signal: request.signal } : {},
        );
      } catch (error) {
        // 传输层失败（DNS/代理/超时）没有状态码，必须把底层原因带出去，
        // 否则降级链里只会看到一句 "fetch failed"。
        if (isHttpClientPortError(error)) {
          throw new Error(`Tavily search transport failure (${error.code}): ${error.message}`);
        }
        throw error instanceof Error ? error : new Error(String(error));
      }

      const bodyText = new TextDecoder().decode(response.body);
      if (response.status < 200 || response.status >= 300) {
        throw new Error(classifyTavilyFailure(response.status, bodyText, response.statusText));
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(bodyText);
      } catch (error) {
        // 200 但响应体非合法 JSON（如网关返回 HTML）时，说明 Tavily 返回了非 JSON 响应体并带上状态码，保留 cause
        throw new Error(`Tavily 返回了非 JSON 响应体 (HTTP ${response.status})`, { cause: error });
      }

      const mapped = mapTavilyResponse(parsed);
      return {
        text: mapped.text,
        finishReason: "stop",
        usage: {},
        toolResults: [
          { id: "tavily-search", name: "web_search", input: { query: request.query }, output: mapped.items },
        ],
      };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
