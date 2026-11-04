import assert from "node:assert/strict";
import { test } from "node:test";
import { createClientScenesService } from "../src/client-scenes/clientScenesService.js";

test("scene selection returns only requested content while full catalog stays complete", async () => {
  const catalog = {
    code: 0,
    msg: "ok",
    data: [
      {
        namespace: "client",
        scene: "draft-suggestion",
        options: { prompts: { contents: { en: "Draft" } } },
      },
      {
        namespace: "client",
        scene: "automation",
        options: { prompts: { contents: { en: "Automation" } } },
      },
    ],
  };
  const service = createClientScenesService({
    apiClient: { request: async () => Response.json(catalog) },
  });
  assert.deepEqual((await service.list({ scene: "draft-suggestion" })).data, [catalog.data[0]]);
  assert.deepEqual(await service.list(), catalog);
  assert.deepEqual((await service.list({ scene: "absent" })).data, []);
});

test("filtered catalog preserves business and transport error context", async () => {
  const rejected = { code: 42, msg: "catalog unavailable", data: null };
  const service = createClientScenesService({
    apiClient: { request: async () => Response.json(rejected) },
  });
  assert.deepEqual(await service.list({ scene: "draft-suggestion" }), rejected);
  const failed = createClientScenesService({
    apiClient: {
      request: async () => new Response("catalog upstream unavailable", { status: 503 }),
    },
  });
  await assert.rejects(
    failed.list({ scene: "draft-suggestion" }),
    (error: Error & { status?: number; url?: string }) =>
      error.status === 503 &&
      error.message.includes("catalog upstream unavailable") &&
      Boolean(error.url),
  );
});
