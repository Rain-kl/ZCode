# 配对 spawn 卡片保留 child 原始失败原因

规范审查实际 React DOM 探针发现：spawn 工具成功后 child 另行失败，ProductProjection 已保留
canonical summaryText，但配对卡片隐藏裸 child 行且只覆盖 status，因而详情仅见 Failed，丢失原因。

先在 client-acceptance 明确只读展示合同，再将探针纳入 codexCollaborationTools.test.ts。
实际 RED 1 fail/10 pass，期望原始 `SPEC_PROVIDER_ERROR_503 original upstream failure`，
只得到 `Spawn agent...Failed...`，日志 `/tmp/zcode-final-child-error-red.log`。

修复在既有 ConversationAgentToolCallRow 的只读 toolCall 投影中同时派生 failed summary 为 error，
保留原成功 spawn row/output，不新增状态或写入路径；useMemo 同时跟随 summaryText，下一运行代
不保留旧错误。原 ToolCallBlock 的错误展示链继续负责呈现正文。

定向三文件 56/56 GREEN，最终日志 `/tmp/zcode-final-child-error-final.log`。原测试使用真实
output.text ACK，断言原成功结果不变、同 failed 状态 summary 更新，以及 rerender running 后
最新与早先错误均消失；没有修改控制器、provider wire 或错误持久化。
原独立 probe 与完整增量审查结论由收尾文档登记。未 push。
