# Task3b quality P2：child 终态不能丢失 wrapper 下的具体原因

质量实际runtime child generateText抛普通Error('quality-provider-failure-specific-429')，既有turnwrapper
以context.errorPayloadRole=wrapper包装，controller errorText只读顶层.message。canonical lastError、
list_agents和STATUS因而只剩Turn execution failed。ModelError直通不受此影响。

先更新runtime合同，再写实际RED：wrapped普通Error的list缺具体正文；非重试ModelError对照通过。
初对照误设retryable:true使既有模型预算重试成功，已修fixture为非重试400，不改变产品重试策略。

有限修仅在bridge原run拒绝边界调用既有selectExecutionErrorMessage。摘要不同才用已有CoreError
携带选出正文，原拒绝仍为cause，保留原type/context/retryable/recoverable；摘要已具体的错误原样throw。
不在纯controller导入runtime、不改普通turnwrapper、不JSON序列化Error、不造新错误格式或第二状态。
runningCommands仍观察原commandIO结算，finally与drain次序不变，原turn日志与持久错误照常。

GREEN：runtime目录+turn-errors8文件56/56，质量原始独立probe1/1；最后增强原context/type/budget标志
对象断言的两项再次2/2。实际断言list、root durable lastError、STATUS及父provider assistant消息包含
specific，原cause对象保留；错误后followup恢复同childSessionId。core noEmit/scopedlint/架构通过。
未重复无生产变化的整批CLI32/rootchecks，根最终Task4阶段统一验证。spec增量与quality仍待复审。

日志/tmp/zcode-task3b-error-detail-{red,green,independent,specific-green,types,lint,architecture}.log。
只提交自有文件；用户.gitignore/codex保留，不推送。
