import { ModelRequestSessionType, ModelRetryBudget, type SessionTaskType } from "@zcode/contracts";

/**
 * 模型请求按宿主 session 做粗分类；workflow child 不是 subagent，服务端统计统一归 other。
 */
export function resolveModelRequestSessionTypeFromTaskType(
  taskType: SessionTaskType | undefined,
): ModelRequestSessionType {
  if (taskType === "subagent_child") return ModelRequestSessionType.Subagent;
  if (taskType === "selection_side_chat") return ModelRequestSessionType.SideChat;
  if (taskType === "workflow_child" || taskType === "nested_workflow_child") {
    return ModelRequestSessionType.Other;
  }
  return ModelRequestSessionType.Main;
}

// FORK-BEGIN(codex-collaboration)
/** 所有宿主均受同一有界 API 恢复政策约束；旧 unbounded 枚举仅保留兼容读取。 */
export function resolveModelRetryBudgetFromTaskType(
  // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
  _taskType: SessionTaskType | undefined,
  // FORK(codex-collaboration): 现有模型调用边界必须执行统一有界恢复策略，见 FEATURES.md。
): ModelRetryBudget {
  return ModelRetryBudget.Default;
}
// FORK-END(codex-collaboration)
