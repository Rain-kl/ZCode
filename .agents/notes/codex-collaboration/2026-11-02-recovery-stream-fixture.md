# 保留恢复测试的完整模型流事实

最终定向恢复回归实际 105/108，通过失败证据定位 `core/tests/test-runtime-model.ts`：
测试模型的 `generateText` 已提供 reasoning 与 raw finish reason，但 streamText 桩只发送 text、tools
与 usage。生产 runtime 统一经过 nonstream-via-stream，这使测试丢失实际要求验证的部分结果。

测试桩应按已有 ModelStreamEvent 合同投影 reasoning start/delta/end（含 providerMetadata）与
finish.providerMetadata，不能通过删除 partial-output 断言或改变生产恢复逻辑解决。
已有 runtime-context-finish-recovery 的三条失败就是 RED，不另写重复实现的测试。

此改动只修正测试输入，生产恢复语义保持原合同。随后重跑六个恢复 suite：
runner-retry、retry-budget、runner-empty-delta-retry、runtime-context-finish-recovery、
model-retry-budget、runtime-stream-recovery，实际 **108/108 通过**。独立规范审查另复跑
runtime-context-finish-recovery **14/14 通过**。
