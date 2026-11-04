import { describe, expect, it } from "vitest";
import { shouldShowSelfHostedRelaySetup } from "../src/fork/cloud-web-access/presentation.js";

describe("self-hosted web remote authentication", () => {
  it("returns to the self-hosted login form after an existing session is revoked", () => {
    expect(
      shouldShowSelfHostedRelaySetup(
        {
          configured: true,
          authenticated: true,
          endpoint: "https://relay.example.com",
          username: "owner",
        },
        { status: "auth-required" },
      ),
    ).toBe(true);
  });

  it("keeps the official login path for platforms without self-hosted Relay configuration", () => {
    expect(shouldShowSelfHostedRelaySetup(null, { status: "auth-required" })).toBe(false);
  });
});
