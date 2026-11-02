import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionId, type ModelSelection } from "@zcode/contracts";
import { createTestAgentRuntime } from "./test-agent-runtime.js";
import { createTestModelFactory } from "./test-runtime-model.js";
import { createTestSessionEventStore } from "./test-event-store.js";
import { AgentRuntime } from "../src/runtime.js";

describe("Subagent 有效选择到实际执行", () => {
  afterEach(() => vi.restoreAllMocks());
  const parent = {
    providerId: "custom-provider",
    modelId: "parent-model",
    options: { reasoningLevel: "high" },
  };
  const original = {
    providerId: "account:bigmodel-individual-coding-plan",
    modelId: "GLM-5.3",
    options: { reasoningLevel: "high" },
  };
  const effective = { ...original, providerId: "account:bigmodel-team-coding-plan" };

  it.each(["explicit", "inherit", "inherit-plan", "override", "unavailable"] as const)(
    "%s：通过 Agent tool 创建真实 child 并检查请求使用的模型",
    async (kind) => {
      const childSelections: ModelSelection[] = [];
      const resolveEffectiveModelSelection = vi.fn(() => ({
        effectiveSelection: kind === "unavailable" || kind === "override" ? null : effective,
      }));
      let mainCalls = 0;
      const executeTurnSpy = vi.spyOn(AgentRuntime.prototype, "executeTurn");
      const runtime = createTestAgentRuntime(
        createSessionId(`effective-child-${kind}`),
        {
          mode: "yolo",
          planEnabled: kind === "inherit-plan",
          workingDirectory: "/workspace/project",
          modelSelection: parent,
          subagents: {
            profiles: [
              {
                name: "researcher",
                description: "Research code",
                source: "user",
                tools: ["Read"],
                systemPrompt: "Return a short result.",
                ...(kind.startsWith("inherit") ? {} : { modelSelection: original }),
              },
            ],
          },
        },
        {
          eventStore: createTestSessionEventStore(),
          resolveEffectiveModelSelection,
          modelFactory: createTestModelFactory({
            async generateText(_request, observation) {
              const metadata = observation.invocationContext?.metadata as
                | { querySource?: string }
                | undefined;
              const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
              if (metadata?.querySource === "subagent") {
                childSelections.push({
                  providerId: observation.model.providerId,
                  modelId: observation.model.modelId,
                  options: { reasoningLevel: observation.model.options.reasoningLevel! },
                });
                return { finishReason: "stop", text: "child done", usage };
              }
              if (++mainCalls === 1)
                return {
                  finishReason: "tool-calls",
                  text: "",
                  usage,
                  toolCalls: [
                    {
                      id: "call_child",
                      name: "spawn_agent",
                      input: {
                        task_name: "call_child",
                        fork_turns: "none",
                        message: "Research code",
                        agent_type: "researcher",
                      },
                    },
                  ],
                };
              return { finishReason: "stop", text: "done", usage };
            },
          }),
        },
      );
      await runtime.executeTurn(
        "Run the researcher.",
        undefined,
        kind === "override"
          ? {
              intent: {
                sourceCommandId: "execution-override",
                kind: "sendText",
                requestedDelivery: "start-now",
                modelSelection: effective,
              },
              modelExecution: {
                selectionScope: "execution",
                subagents: { foregroundModel: "submission", background: "deny" },
              },
            }
          : undefined,
      );
      await vi.waitFor(() =>
        expect(childSelections).toEqual(
          kind === "unavailable" || kind === "override"
            ? []
            : [kind.startsWith("inherit") ? parent : effective],
        ),
      );
      expect(resolveEffectiveModelSelection).toHaveBeenCalledTimes(
        kind === "explicit" || kind === "unavailable" ? 1 : 0,
      );
      expect(original.providerId).toBe("account:bigmodel-individual-coding-plan");
      expect(runtime.getSessionModelSelection()).toEqual(parent);
      // 新 driver 走已预留的标准命令，不调用 executeTurn 二次准入。
      expect(executeTurnSpy).toHaveBeenCalledTimes(1);
      await runtime.closeBrowserSession();
      executeTurnSpy.mockRestore();
    },
  );
});
