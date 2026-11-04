import { describe, expect, it, vi } from "vitest";
import { appSettingsSchema } from "@zcode/shared";
import {
  createDesktopSelfHostedRemoteRelayConfiguration,
  type DesktopSelfHostedRemoteRelaySettings,
} from "#src/fork/cloud-web-access/relayConfiguration.js";

function fixture(
  initial?: DesktopSelfHostedRemoteRelaySettings["webRemoteControlSelfHostedRelay"],
) {
  let settings: DesktopSelfHostedRemoteRelaySettings = {
    webRemoteControlSelfHostedRelay: initial,
  };
  const credentials = new Map<string, string>();
  const deleted: string[] = [];
  const service = createDesktopSelfHostedRemoteRelayConfiguration({
    loadSettings: async () => settings,
    patchSettings: async (patch) => {
      settings = { ...settings, ...patch };
    },
    credentialStore: {
      load: async (key) => credentials.get(key) ?? null,
      save: async (key, value) => {
        credentials.set(key, value);
      },
      delete: async (key) => {
        deleted.push(key);
        credentials.delete(key);
      },
    },
    randomId: () => "generation-1",
  });
  return { service, credentials, deleted, readSettings: () => settings };
}

describe("Desktop self-hosted remote relay configuration", () => {
  it("keeps non-secret Relay metadata in the shared AppSettings contract", () => {
    const relay = {
      endpointOrigin: "https://relay.example.com",
      username: "owner",
      userId: "owner",
      tokenCredentialKey: "session-key",
    };
    expect(appSettingsSchema.parse({ webRemoteControlSelfHostedRelay: relay })).toMatchObject({
      webRemoteControlSelfHostedRelay: relay,
    });
  });

  it("validates the Relay login contract and persists only non-secret metadata plus a credential reference", async () => {
    const f = fixture();
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            token: "session-secret",
            userInfo: { id: "owner", username: "owner", displayName: "Owner" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const result = await f.service.configure(
      {
        endpoint: "https://relay.example.com",
        username: " owner ",
        password: "password",
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://relay.example.com/api/fork-remote/auth/login"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "owner", password: "password" }),
      }),
    );
    expect(result).toMatchObject({
      configured: true,
      endpoint: "https://relay.example.com",
      username: "owner",
    });
    expect(f.readSettings().webRemoteControlSelfHostedRelay).toEqual({
      endpointOrigin: "https://relay.example.com",
      username: "owner",
      userId: "owner",
      tokenCredentialKey: "web-remote-control:self-hosted:session:generation-1",
    });
    expect(JSON.stringify(f.readSettings())).not.toContain("session-secret");
    expect(JSON.stringify(f.readSettings())).not.toContain("password");
    expect(f.credentials.get("web-remote-control:self-hosted:session:generation-1")).toBe(
      "session-secret",
    );
  });

  it("rejects insecure non-loopback endpoints and mismatched identities without changing settings", async () => {
    const f = fixture();
    await expect(
      f.service.configure(
        {
          endpoint: "http://relay.example.com",
          username: "owner",
          password: "password",
        },
        vi.fn(),
      ),
    ).rejects.toThrow("HTTPS");
    await expect(
      f.service.configure(
        {
          endpoint: "https://relay.example.com",
          username: "owner",
          password: "password",
        },
        async () =>
          new Response(
            JSON.stringify({
              token: "secret",
              userInfo: {
                id: "other",
                username: "other",
                displayName: "Other",
              },
            }),
            { status: 200 },
          ),
      ),
    ).rejects.toThrow("different account identity");
    expect(f.readSettings().webRemoteControlSelfHostedRelay).toBeUndefined();
    expect(f.credentials.size).toBe(0);
  });

  it("loads a stored session for the existing manager without a time expiry", async () => {
    const current = {
      endpointOrigin: "https://relay.example.com",
      username: "owner",
      userId: "owner",
      tokenCredentialKey: "session-key",
    };
    const f = fixture(current);
    f.credentials.set("session-key", "session-secret");
    await expect(f.service.getLogin()).resolves.toEqual({
      userId: "owner",
      jwt: "session-secret",
    });
    await expect(f.service.getStatus()).resolves.toMatchObject({
      configured: true,
      authenticated: true,
    });

    // 旧设置文件可能保留 expiresAt；它不参与认证判定，不能因此回到未登录状态。
    const legacy = fixture({
      ...current,
      expiresAt: "2026-11-02T12:00:00.000Z",
    } as DesktopSelfHostedRemoteRelaySettings["webRemoteControlSelfHostedRelay"]);
    legacy.credentials.set("session-key", "session-secret");
    await expect(legacy.service.getLogin()).resolves.toEqual({
      userId: "owner",
      jwt: "session-secret",
    });
    await expect(legacy.service.getStatus()).resolves.toMatchObject({
      configured: true,
      authenticated: true,
    });
  });

  it("keeps the previous configuration if settings persistence fails", async () => {
    const old = {
      endpointOrigin: "https://old.example.com",
      username: "old",
      userId: "old",
      tokenCredentialKey: "old-key",
    };
    const f = fixture(old);
    f.credentials.set("old-key", "old-secret");
    const failing = createDesktopSelfHostedRemoteRelayConfiguration({
      loadSettings: async () => f.readSettings(),
      patchSettings: async () => {
        throw new Error("settings unavailable");
      },
      credentialStore: {
        load: async (key) => f.credentials.get(key) ?? null,
        save: async (key, value) => void f.credentials.set(key, value),
        delete: async (key) => void f.credentials.delete(key),
      },
      randomId: () => "new-generation",
    });

    await expect(
      failing.configure(
        {
          endpoint: "https://new.example.com",
          username: "new",
          password: "password",
        },
        async () =>
          new Response(
            JSON.stringify({
              token: "new-secret",
              userInfo: { id: "new", username: "new", displayName: "New" },
            }),
            { status: 200 },
          ),
      ),
    ).rejects.toThrow("settings unavailable");
    expect(f.readSettings().webRemoteControlSelfHostedRelay).toEqual(old);
    expect(f.credentials.get("old-key")).toBe("old-secret");
    expect(f.credentials.has("web-remote-control:self-hosted:session:new-generation")).toBe(false);
  });
});
