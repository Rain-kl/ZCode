import { describe, expect, it } from "vitest";
import { createUpstreamPolicyFetch } from "./module.js";
import { isUpstreamRequestAllowed } from "./contract.js";

describe("fork upstream request boundary", () => {
  it.each([
    "https://zcode.z.ai/api/v1/marketing/touch",
    "https://zcode.z.ai/api/v1/marketing/touch/action",
    "https://zcode.z.ai/api/v1/client/configs",
    "https://zcode.z.ai/api/v1/oauth/token",
    "https://zcode.z.ai/api/v1/remote/token",
    "wss://zcode.z.ai/api/v1/remote/ws2",
    "https://zcode.z.ai/api/v1/new-unreviewed-api",
    "https://api.z.ai/api/auth/z/login",
    "https://open.bigmodel.cn/api/anthropic",
    "https://rum.aliyuncs.com/report",
    "https://cdn-zcode.z.ai/marketing/banner.png",
    "https://cdn-zcode.z.ai:444/zcode/official-plugin/marketplace.json",
    "https://user:pass@cdn-zcode.z.ai/zcode/official-plugin/marketplace.json",
    "https://cdn-zcode.z.ai/zcode/official-plugin/%2e%2e/marketing",
  ])("blocks %s", (url) => expect(isUpstreamRequestAllowed(url)).toBe(false));
  it.each([
    "https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json",
    "https://cdn-zcode.z.ai/zcode/official-plugin/assets/github/icon.png",
    "https://cdn.codegeex.cn/zcode/electron/releases/3.0/node.tar.gz",
    "https://zcode.z.ai/docs",
    "https://zcode.z.ai/api/v1/client/scenes",
    "https://github.com/Rain-kl/ZCode/releases/latest/download/latest.yml",
    "https://my-provider.example/v1/messages",
    "http://127.0.0.1:8080/webdav/",
  ])("retains %s", (url) => expect(isUpstreamRequestAllowed(url)).toBe(true));
  it("only permits read methods on anonymous upstream resources", () => {
    expect(isUpstreamRequestAllowed("https://zcode.z.ai/api/v1/client/scenes", "POST")).toBe(false);
    const url = "https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json";
    expect(isUpstreamRequestAllowed(url, "POST")).toBe(false);
    expect(isUpstreamRequestAllowed(url, "HEAD")).toBe(true);
  });
  it("treats configured upstream aliases as upstream, including localhost overrides", () => {
    expect(
      isUpstreamRequestAllowed("http://localhost:1234/api/v1/marketing/touch", "GET", [
        "http://localhost:1234",
      ]),
    ).toBe(false);
  });
  it.each([301, 302, 303, 307, 308])(
    "retains third-party POST redirect semantics for %s",
    async (status) => {
      const calls: Array<{ method: string; body: string; authorization: string | null }> = [];
      const transport: typeof fetch = async (input) => {
        const request = input as Request;
        calls.push({
          method: request.method,
          body: await request.text(),
          authorization: request.headers.get("authorization"),
        });
        return calls.length === 1
          ? new Response(null, {
              status,
              headers: { location: "https://other-provider.example/v1" },
            })
          : new Response("ok");
      };
      await createUpstreamPolicyFetch(transport)("https://my-provider.example/v1", {
        method: "POST",
        headers: { authorization: "Bearer PRIVATE" },
        body: "payload",
      });
      expect(calls[1]).toEqual({
        method: status >= 307 ? "POST" : "GET",
        body: status >= 307 ? "payload" : "",
        authorization: null,
      });
    },
  );
  it("preserves explicit Node dispatcher and allows docs when the standard API origin is configured", async () => {
    expect(isUpstreamRequestAllowed("https://zcode.z.ai/docs", "GET", ["https://zcode.z.ai"])).toBe(
      true,
    );
    const dispatcher = {};
    let observed: unknown;
    const init: RequestInit = {};
    Object.defineProperty(init, "dispatcher", { value: dispatcher });
    await createUpstreamPolicyFetch(async (_request, options) => {
      observed = (options as RequestInit & { dispatcher: unknown }).dispatcher;
      return new Response("ok");
    })("https://my-provider.example/v1", init);
    expect(observed).toBe(dispatcher);
  });
});
