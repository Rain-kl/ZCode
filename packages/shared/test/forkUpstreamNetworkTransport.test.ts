import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
const entry = new URL("../src/fork/upstream-network/node.ts", import.meta.url).href;
function isolated(code: string) {
  return execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
    encoding: "utf8",
    cwd: process.cwd(),
  });
}
describe("upstream transport interception", () => {
  it("rejects fetch, HTTP and WebSocket HTTP upgrade before invoking transport", () => {
    expect(
      isolated(`
      import assert from 'node:assert/strict';
      import https from 'node:https';
      let sent = 0;
      globalThis.fetch = async () => { sent++; return new Response('ok'); };
      https.request = () => { sent++; throw new Error('transport reached'); };
      await import(${JSON.stringify(entry)});
      await assert.rejects(fetch('https://zcode.z.ai/api/v1/marketing/touch'), /FORK_UPSTREAM_REQUEST_BLOCKED/);
      assert.throws(() => https.request('https://zcode.z.ai/api/v1/remote/ws2', { headers: { Upgrade: 'websocket' } }), /FORK_UPSTREAM_REQUEST_BLOCKED/);
      assert.throws(() => https.request('https://zcode.z.ai/api/v1/marketing/touch', { host: 'allowed.example' }), /FORK_UPSTREAM_REQUEST_BLOCKED/);
      assert.equal(sent, 0);
      await fetch('https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json');
      assert.equal(sent, 1);
      assert.equal(process.env.ZCODE_MODEL_TELEMETRY_ENABLED, 'false');
      console.log('pass');
    `).trim(),
    ).toBe("pass");
  });
  it("blocks a forbidden redirect target before issuing the next request", () => {
    expect(
      isolated(`
      import assert from 'node:assert/strict';
      let sent = 0;
      globalThis.fetch = async () => { sent++; return new Response(null, { status: 302, headers: { location: 'https://zcode.z.ai/api/v1/marketing/touch?token=SECRET' } }); };
      await import(${JSON.stringify(entry)});
      await assert.rejects(fetch('https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json'), (e) => e.message.includes('FORK_UPSTREAM_REQUEST_BLOCKED') && !e.message.includes('SECRET'));
      assert.equal(sent, 1);
      console.log('pass');
    `).trim(),
    ).toBe("pass");
  });
  it("Web fetch/XHR/WS share the deny rule and relative XHR remains usable", () => {
    expect(
      isolated(`
      import assert from 'node:assert/strict';
      let sent = 0;
      globalThis.fetch = async () => { sent++; return new Response('ok'); };
      globalThis.location = { href: 'https://self-host.example/' };
      globalThis.XMLHttpRequest = class { open() { sent++; } };
      await import(${JSON.stringify(new URL("../src/fork/upstream-network/browser.ts", import.meta.url).href)});
      await assert.rejects(fetch('https://zcode.z.ai/api/v1/marketing/touch'), /FORK_UPSTREAM_REQUEST_BLOCKED/);
      assert.throws(() => new XMLHttpRequest().open('GET', 'https://zcode.z.ai/api/v1/oauth/token'), /FORK_UPSTREAM_REQUEST_BLOCKED/);
      assert.throws(() => new WebSocket('wss://zcode.z.ai/api/v1/remote/ws2'), /FORK_UPSTREAM_REQUEST_BLOCKED/);
      assert.equal(sent, 0);
      new XMLHttpRequest().open('GET', '/self-host-api');
      assert.equal(sent, 1);
      console.log('pass');
    `).trim(),
    ).toBe("pass");
  });
});
