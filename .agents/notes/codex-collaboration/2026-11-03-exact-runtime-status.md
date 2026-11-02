# Task4 必要只读端口：按精确 child 核对实时状态

客户端bootstrap contexts.sessions只持有rootapp.runtime；私有child handle不可访问。冷文件保存running
可能是进程关闭前残留，聚合background查询又会混入Bash/兄弟。因此在既有runtime owner提供同步窄入口：
getCollaborationAgentStatus(agentId): CollaborationAgentRuntimeStatus | undefined。

类型直接复用controller AgentStatus并从@zcode/core公开导出。binding getAgentStatus只读已初始化
controller共享快照的精确child；未init/未知/root均undefined。不调用ready、读文件、采样、启动模型、
恢复树或创建第二状态。interrupted和真实IO是否drain分开，资源驻留查询保持原合同。

先合同后actualRED（公开方法不存在），再实现宿主薄委托+binding只读查询。实际status两项证明：
lazy与保存running的cold runtime均undefined且0store读写/0额外模型IO；live running、interrupt即时
interrupted但IO尚pending、followup同身份completed；errored目标不被仍运行兄弟的聚合驻留冒充。

GREEN：status/runtime/recovery3文件25/25；core noEmit/build0，scopedlint0warning0error。架构当时
1项来自并行client施工bootstrap/src/app/subagent-observation.ts未登记，未擅改其模块/policy；runtime
自有代码无架构违规，工作区无关文件均排除提交。后续由client登记模块后统一检查。
日志/tmp/zcode-task4-runtime-status-{red,green,types,build,lint,architecture}.log。

有限port交spec/quality独立增量审查，不重开已批准Task3b，不宣称完成客户端验收，不推送。
