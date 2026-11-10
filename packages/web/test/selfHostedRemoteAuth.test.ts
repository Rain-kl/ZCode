import { describe, expect, it, vi } from "vitest";
import { WebRemoteControlEntry } from "../src/web-remote-control/app/webRemoteControlEntry.js";
import { createSelfHostedRemoteAuth } from "../src/web-remote-control/adapters/selfHostedRemoteAuth.js";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const session = {
  token: "signed-payload.signature",
  userInfo: { id: "owner", username: "owner", displayName: "Owner" },
};

describe("self-hosted Web remote authentication", () => {
  it("logs in against the same-origin relay and restores after refresh", async () => {
    const storage = new MemoryStorage();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json(session);
    };
    const auth = createSelfHostedRemoteAuth({
      origin: "https://relay.example",
      storage,
      fetcher,
    });

    await auth.startLogin({ username: " owner ", password: "secret" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://relay.example/api/fork-remote/auth/login");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ username: "owner", password: "secret" }));
    expect(auth.getZCodeJwtToken()).toBe(session.token);
    expect(auth.getActiveAccount()).toEqual({
      displayName: "Owner",
      provider: "self-hosted",
    });

    const restored = createSelfHostedRemoteAuth({
      origin: "https://relay.example",
      storage,
      fetcher,
    });
    expect(restored.getZCodeJwtToken()).toBe(session.token);
    expect(calls, "refresh restore must not submit the password again").toHaveLength(1);
  });

  it("reports invalid credentials without persisting the password or a partial session", async () => {
    const storage = new MemoryStorage();
    const auth = createSelfHostedRemoteAuth({
      origin: "https://relay.example",
      storage,
      fetcher: async () => new Response(null, { status: 401 }),
    });

    await expect(
      auth.startLogin({ username: "owner", password: "wrong-password" }),
    ).rejects.toMatchObject({ reason: "invalid-credentials" });
    expect(auth.getZCodeJwtToken()).toBeNull();
    expect([...storage.values.values()].some((value) => value.includes("wrong-password"))).toBe(
      false,
    );
  });

  it("keeps relay failures distinguishable with their HTTP context", async () => {
    const auth = createSelfHostedRemoteAuth({
      origin: "https://relay.example",
      storage: new MemoryStorage(),
      fetcher: async () => new Response(null, { status: 503 }),
    });

    await expect(auth.startLogin({ username: "owner", password: "secret" })).rejects.toMatchObject({
      reason: "relay-unavailable",
      message: "Relay login failed with HTTP 503",
    });
  });

  it("restores legacy sessions regardless of their stored expiry and clears damaged ones", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "zcode:self-hosted-remote-session",
      JSON.stringify({ ...session, expiresAt: "2028-01-01T00:00:00.000Z" }),
    );
    const legacy = createSelfHostedRemoteAuth({
      origin: "https://relay.example",
      storage,
      fetcher: async () => Response.json(session),
    });
    expect(legacy.getZCodeJwtToken()).toBe(session.token);

    storage.setItem("zcode:self-hosted-remote-session", JSON.stringify({ userInfo: {} }));
    expect(legacy.getZCodeJwtToken()).toBeNull();
    expect(storage.getItem("zcode:self-hosted-remote-session")).toBeNull();

    await legacy.startLogin({ username: "owner", password: "secret" });
    await legacy.logout();
    expect(legacy.getZCodeJwtToken()).toBeNull();
    expect(legacy.getActiveAccount()).toBeNull();
  });

  it("treats unavailable browser storage as logged out without leaking a partial session", async () => {
    const unavailableStorage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
      getItem: () => {
        throw new Error("storage denied");
      },
      setItem: () => {
        throw new Error("storage denied");
      },
      removeItem: () => {
        throw new Error("storage denied");
      },
    };
    const auth = createSelfHostedRemoteAuth({
      origin: "https://relay.example",
      storage: unavailableStorage,
      fetcher: async () => Response.json(session),
    });

    expect(auth.getZCodeJwtToken()).toBeNull();
    await expect(auth.startLogin({ username: "owner", password: "secret" })).rejects.toMatchObject({
      reason: "relay-unavailable",
    });
    await auth.logout();
    expect(auth.getActiveAccount()).toBeNull();
  });

  it("Entry submits credentials, then continues through the existing device admission", async () => {
    const storage = new MemoryStorage();
    const auth = createSelfHostedRemoteAuth({
      origin: "https://relay.example",
      storage,
      fetcher: async () => Response.json(session),
    });
    const views: string[] = [];
    const entry = new WebRemoteControlEntry({
      auth,
      getHref: () => "https://relay.example/remote/v4",
      replaceHref: () => {},
      storage,
      locale: "en-US",
      devices: async () => [],
      subscribeVisible: () => () => {},
      token: async () => "unused",
      connect: vi.fn(),
      onView: (view) => views.push(view.kind),
    });

    await entry.start();
    expect(views).toEqual(["login"]);
    await entry.startLogin({ username: "owner", password: "secret" });
    expect(views).toEqual(["login", "devices", "devices"]);
  });

  it("shows the device list on a plain entry even when the last device is online", async () => {
    const storage = new MemoryStorage();
    storage.setItem("zcode-web-remote-last-device-sid", "device-1");
    const auth = createSelfHostedRemoteAuth({
      origin: "https://relay.example",
      storage,
      fetcher: async () => Response.json(session),
    });
    await auth.startLogin({ username: "owner", password: "secret" });
    const connect = vi.fn();
    const views: string[] = [];
    const entry = new WebRemoteControlEntry({
      auth,
      getHref: () => "https://relay.example/remote/v4",
      replaceHref: vi.fn(),
      storage,
      locale: "en-US",
      devices: async () => [{ device_sid: "device-1", device_mid: "machine-1", online: true, created_at: 1, meta: {} }],
      subscribeVisible: () => () => {},
      token: async () => "unused",
      connect,
      onView: (view) => views.push(view.kind),
    });
    await entry.start();
    expect(views.at(-1)).toBe("devices");
    expect(connect).not.toHaveBeenCalled();
    entry.selectDevice("device-1");
    expect(connect).toHaveBeenCalledOnce();
  });

  it("does not treat OAuth-shaped remote URLs as an official login callback", async () => {
    const storage = new MemoryStorage();
    const auth = createSelfHostedRemoteAuth({
      origin: "https://relay.example",
      storage,
      fetcher: async () => Response.json(session),
    });
    const views: string[] = [];
    const entry = new WebRemoteControlEntry({
      auth,
      getHref: () => "https://relay.example/remote/v4?state=legacy&code=oauth-code",
      replaceHref: () => {},
      storage,
      locale: "en-US",
      devices: async () => [],
      subscribeVisible: () => () => {},
      token: async () => "unused",
      connect: vi.fn(),
      onView: (view) => views.push(view.kind),
    });

    await entry.start();
    expect(views).toEqual(["login"]);
  });
});
