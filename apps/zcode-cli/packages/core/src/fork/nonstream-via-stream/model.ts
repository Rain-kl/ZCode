/**
 * 非流式请求改由流式通道承载（stream → non-stream 适配器）。
 *
 * 背景、取舍与边界见 docs/features/nonstream-via-stream/design.md。
 *
 * 为什么放在端口层而不是 AI SDK runner 内部：非流式与流式在 adapter 里是两条独立装配路径
 * （`runner-generate` / `runner-stream`），后者带重试、空闲超时、断流恢复与状态事件。
 * 在 `Model` 端口上做适配可以**原样复用**这条已验证的链路，只把「如何把一串流事件汇总成
 * 一次性结果」这件纯计算的事留在这里，因此可以被单测完整覆盖。
 */
import type {
  Model,
  ModelReasoningContentBlock,
  ModelResult,
  ModelStreamEvent,
  ModelToolCall,
  ModelUsage,
} from "@zcode/contracts";
import { getOrCreateReasoningBlock } from "../../runtime/methods/reasoning-stream.js";
import { normalizeStreamError } from "../../runtime/helpers/model-errors.js";

/**
 * 把一个流式事件序列汇总成非流式结果。
 *
 * 语义与 core 里流式分支的汇总保持一致（同一套 reasoning block 归并、同 id 工具调用去重、
 * finish 决定 finishReason/usage/providerMetadata），这样「非流式结果」与「流式的最终态」
 * 是同一个东西，切换不会引入第二套事实。
 */
export async function aggregateStreamToResult(
  events: AsyncIterable<ModelStreamEvent>,
): Promise<ModelResult> {
  let text = "";
  let finishReason = "unknown";
  let usage: ModelUsage = {};
  let providerMetadata: Record<string, unknown> | undefined;
  const reasoning: ModelReasoningContentBlock[] = [];
  const reasoningById = new Map<string, ModelReasoningContentBlock>();
  const toolCalls: ModelToolCall[] = [];
  const toolCallIds = new Set<string>();

  for await (const event of events) {
    switch (event.type) {
      case "text_delta": {
        text += event.text;
        break;
      }

      case "reasoning_start":
      case "reasoning_delta": {
        // 部分 provider 只发 delta 不发 start，归并逻辑与流式路径共用同一个 helper。
        const block = getOrCreateReasoningBlock({
          id: event.id,
          providerMetadata: event.providerMetadata,
          reasoning,
          reasoningById,
        });
        if (event.type === "reasoning_delta") {
          block.text += event.text;
        }
        if (event.providerMetadata) {
          block.providerOptions = event.providerMetadata;
        }
        break;
      }

      case "reasoning_end": {
        const block = reasoningById.get(event.id);
        if (block && event.providerMetadata) {
          block.providerOptions = event.providerMetadata;
        }
        reasoningById.delete(event.id);
        break;
      }

      case "tool_call": {
        // 与流式路径同语义：同 id 的 final tool_call 可能被重复投递，按 id 去重。
        if (toolCallIds.has(event.toolCall.id)) {
          break;
        }
        toolCallIds.add(event.toolCall.id);
        toolCalls.push(event.toolCall);
        break;
      }

      case "finish": {
        finishReason = event.finishReason;
        usage = event.usage;
        providerMetadata = event.providerMetadata;
        break;
      }

      case "error": {
        // 与流式路径同一套归一化：provider 业务错误里携带的 code 不能在转成 Error 时丢掉。
        throw normalizeStreamError(event.error);
      }

      default: {
        // start / text_start / text_end / tool_input_* / compact_stream_boundary 都不参与
        // 非流式结果：前几个只是流式切分标记，compact boundary 是 compact 专用的重放边界。
        break;
      }
    }
  }

  return {
    text,
    finishReason,
    usage,
    ...(reasoning.length > 0 ? { reasoning } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(providerMetadata === undefined ? {} : { providerMetadata }),
  };
}

/**
 * 让 `generateText` 走流式通道：发起流式请求，在本地汇总成一次性结果。
 *
 * `streamText` 与其余字段原样透传——本适配器只改「非流式怎么拿结果」，不改流式行为。
 */
export function withNonStreamingViaStream(model: Model): Model {
  return {
    providerId: model.providerId,
    modelId: model.modelId,
    displayName: model.displayName,
    properties: model.properties,
    optionSpecs: model.optionSpecs,
    options: model.options,
    bind(options) {
      return withNonStreamingViaStream(model.bind(options));
    },
    generateText(request) {
      return aggregateStreamToResult(model.streamText(request));
    },
    streamText(request) {
      return model.streamText(request);
    },
  };
}
