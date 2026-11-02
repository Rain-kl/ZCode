import { afterEach } from "vitest";
import { createSessionId, modelMessageContentToText, type ModelRequest } from "@zcode/contracts";
import { createTestAgentRuntime } from "../../tests/test-agent-runtime.js";
import { createTestModelFactory } from "../../tests/test-runtime-model.js";
import { createRecordingSubagentSessionStore } from "../../tests/subagent-test-store.js";
import { createTestSessionEventStore } from "../../tests/test-event-store.js";

const roots: ReturnType<typeof createTestAgentRuntime>[] = [];
afterEach(async () => {
  for (const runtime of roots.splice(0)) await runtime.closeBrowserSession();
});
const done = { text: "finished", finishReason: "stop" as const, usage: {} };
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function setup(generate: Parameters<typeof createTestModelFactory>[0]["generateText"]) {
  const store = createRecordingSubagentSessionStore();
  const rootId = createSessionId("collaboration-runtime-root");
  const runtime = createTestAgentRuntime(
    rootId,
    {
      mode: "yolo",
      workingDirectory: "/tmp",
      maxTurns: 8,
      memory: { enabled: false },
    },
    {
      eventStore: createTestSessionEventStore(),
      sessionStore: store,
      modelFactory: createTestModelFactory({ generateText: generate }),
      modelCatalogPort: {
        listModels: () => [
          {
            providerId: "test",
            modelId: "default-runtime-model",
            reasoningLevels: ["disabled"],
            current: true,
          },
        ],
      },
    },
  );
  roots.push(runtime);
  return { runtime, store, rootId };
}
async function tool(
  runtime: ReturnType<typeof createTestAgentRuntime>,
  name: string,
  input: unknown,
  id = name,
) {
  return runtime.getToolExecutor().execute({ id, name, input });
}
const texts = (request: ModelRequest) =>
  request.messages.map((m) => modelMessageContentToText(m.content)).join("\n");

export { roots, done, gate, setup, tool, texts };
