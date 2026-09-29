/**
 * 把错误压成一条可读消息：展开 `cause` 链。
 *
 * 起因：host 侧出网走 undici，连接层失败时抛的是 `TypeError: fetch failed`，
 * 真正的原因（TLS 被重置、DNS 失败、代理不可达…）挂在 `error.cause` 上。
 * 原先各处直接取 `error.message`，于是设置页永远只显示 "fetch failed"，
 * 用户与排查者都拿不到任何线索（本次「WebDAV 一直 fetch failed」即为此）。
 *
 * 只做展开，不改变错误语义：返回的仍是字符串，用于 `ForkWebdavStatus.lastError` 与日志。
 */

const MAX_CAUSE_DEPTH = 5;

function describeSingle(error: unknown): string | null {
  if (error instanceof Error) {
    // undici 的 cause 里常带 code（ECONNRESET / ENOTFOUND…），它对定位最关键。
    const code = (error as { code?: unknown }).code;
    const codeSuffix = typeof code === "string" && code.length > 0 ? ` [${code}]` : "";
    return `${error.name}: ${error.message}${codeSuffix}`;
  }
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  if (error === undefined || error === null) {
    return null;
  }
  return String(error);
}

export function describeForkWebdavError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    const described = describeSingle(current);
    if (described === null) {
      break;
    }
    // 只去掉紧邻重复项：有些库会把同一个 message 既放外层又放 cause。
    if (parts.at(-1) !== described) {
      parts.push(described);
    }
    current = (current as { cause?: unknown } | null | undefined)?.cause;
  }
  return parts.length > 0 ? parts.join(" ← ") : String(error);
}
