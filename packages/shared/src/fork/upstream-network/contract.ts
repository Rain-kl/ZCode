/** 单一上游请求判定。新增上游接口默认拒绝，只有经过审核的匿名功能路径可出网。 */
export function isUpstreamRequestAllowed(
  raw: string,
  method = "GET",
  aliases: readonly string[] = [],
): boolean {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const upstream = ["z.ai", "bigmodel.cn", "codegeex.cn", "zhipuai.cn", "zhipuai.com"].some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  const telemetry = /(^|\.)(rum|arms|retcode)[-.]/.test(host) || host === "rum.aliyuncs.com";
  const alias =
    !upstream &&
    aliases.some((origin) => {
      try {
        return new URL(origin).origin === url.origin;
      } catch {
        return false;
      }
    });
  if (!upstream && !telemetry && !alias) return true;
  if (telemetry || alias || url.protocol !== "https:" || url.port || url.username || url.password)
    return false;
  if (!["GET", "HEAD"].includes(method.toUpperCase())) return false;
  // 编码斜杠/点不能改变资源目录边界；URL 本身会消除标准的 .. 路径。
  if (/%(2e|2f|5c|25)/i.test(url.pathname)) return false;
  if (["cdn-zcode.z.ai", "cdn.codegeex.cn"].includes(host)) {
    return ["/zcode/official-plugin/", "/zcode/electron/releases/"].some((prefix) =>
      url.pathname.startsWith(prefix),
    );
  }
  return (
    host === "zcode.z.ai" &&
    (url.pathname === "/api/v1/client/scenes" ||
      url.pathname === "/docs" ||
      url.pathname.startsWith("/docs/"))
  );
}

export function assertUpstreamRequestAllowed(
  raw: string,
  method = "GET",
  aliases: readonly string[] = [],
): void {
  if (!isUpstreamRequestAllowed(raw, method, aliases)) {
    const url = new URL(raw);
    // 仅记录 origin/path，不暴露 query 中的一次性 token 或账号凭据。
    throw new Error(`FORK_UPSTREAM_REQUEST_BLOCKED: ${method} ${url.origin}${url.pathname}`);
  }
}
