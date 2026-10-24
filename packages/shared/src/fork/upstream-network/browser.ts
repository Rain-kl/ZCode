import { assertUpstreamRequestAllowed } from "./contract.js";
import { createUpstreamPolicyFetch } from "./module.js";

// shared 同时在无 DOM 的 Node 工程编译，只声明本入口实际使用的浏览器端口。
const browser = globalThis as typeof globalThis & {
  location: { href: string };
  XMLHttpRequest?: {
    prototype: {
      open(this: unknown, method: string, url: string | URL, ...options: unknown[]): void;
    };
  };
};
globalThis.fetch = createUpstreamPolicyFetch(globalThis.fetch.bind(globalThis));
// Worker/无 DOM 入口可能只有 fetch；只对实际存在的传输安装门禁，不创建新的传输能力。
if (browser.XMLHttpRequest) {
  const prototype = browser.XMLHttpRequest.prototype;
  const originalOpen = prototype.open;
  prototype.open = function (method, url, ...options) {
    assertUpstreamRequestAllowed(new URL(String(url), browser.location.href).href, method);
    return Reflect.apply(originalOpen, this, [method, url, ...options]);
  };
}
const NativeWebSocket = globalThis.WebSocket;
globalThis.WebSocket = class extends NativeWebSocket {
  constructor(...args: ConstructorParameters<typeof NativeWebSocket>) {
    assertUpstreamRequestAllowed(new URL(String(args[0]), browser.location.href).href);
    super(...args);
  }
};
