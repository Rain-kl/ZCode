import { describe, expect, it } from "vitest";
import { startDraftSessionPrewarm } from "../src/v4/composer/useDraftSessionPrewarm.js";

describe("draft session prewarm failures", () => {
  it("preserves the command rejection reason instead of discarding it", async () => {
    const errors: unknown[] = [];
    let settled!: () => void;
    const completion = new Promise<void>((resolve) => {
      settled = resolve;
    });

    startDraftSessionPrewarm({
      workspaceKey: "/workspace",
      dispatchCommand: async () =>
        ({
          status: "rejected",
          reasonCode: "model-not-ready",
        }) as never,
      onReady: () => {},
      onSettled: settled,
      onError: (error) => errors.push(error),
    });
    await completion;

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect((errors[0] as Error).message).toContain("model-not-ready");
  });
});
