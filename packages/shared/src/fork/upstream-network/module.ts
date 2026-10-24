import { assertUpstreamRequestAllowed } from "./contract.js";
export { isUpstreamRequestAllowed, assertUpstreamRequestAllowed } from "./contract.js";

export function createUpstreamPolicyFetch(
  transport: typeof fetch,
  aliases: () => readonly string[] = () => [],
): typeof fetch {
  return async (input, init) => {
    let request = new Request(input, init);
    const redirect = request.redirect;
    for (let count = 0; count <= 20; count++) {
      assertUpstreamRequestAllowed(request.url, request.method, aliases());
      const replay = request.clone();
      const response = await transport(request, { redirect: "manual" });
      if (response.type === "opaqueredirect")
        throw new TypeError("Fork network policy cannot verify opaque redirect target");
      const location = response.headers.get("location");
      if (
        ![301, 302, 303, 307, 308].includes(response.status) ||
        !location ||
        redirect === "manual"
      ) {
        void replay.body?.cancel();
        return response;
      }
      await response.body?.cancel();
      if (redirect === "error") throw new TypeError("Redirect is not allowed");
      const target = new URL(location, request.url);
      const dropBody =
        (response.status === 303 && !["GET", "HEAD"].includes(request.method)) ||
        ([301, 302].includes(response.status) && request.method === "POST");
      const method = dropBody ? "GET" : request.method;
      assertUpstreamRequestAllowed(target.href, method, aliases());
      const headers = new Headers(request.headers);
      if (target.origin !== new URL(request.url).origin) {
        for (const key of ["authorization", "cookie", "proxy-authorization"]) headers.delete(key);
      }
      if (dropBody) {
        for (const key of [
          "content-type",
          "content-length",
          "content-encoding",
          "content-language",
          "content-location",
        ])
          headers.delete(key);
        request = new Request(target, { method, headers, signal: request.signal, redirect });
      } else {
        request = new Request(target, replay);
        request = new Request(request, { headers });
      }
    }
    throw new TypeError("Too many redirects");
  };
}
