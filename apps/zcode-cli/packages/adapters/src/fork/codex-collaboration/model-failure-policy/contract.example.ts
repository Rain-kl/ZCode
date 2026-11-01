import { ModelErrorCode, ModelFailureReason } from "@zcode/contracts";
import { resolveWorkflowModelFailurePolicy } from "./contract.js";
export function exampleExhaustedWorkflowPolicy() {
  return resolveWorkflowModelFailurePolicy(
    {
      code: ModelErrorCode.ModelRequestFailed,
      reason: ModelFailureReason.NetworkError,
      retryable: true,
    },
    undefined,
  );
}
