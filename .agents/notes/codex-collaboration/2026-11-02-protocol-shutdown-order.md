# 协议关闭的排空证据

有界等待结束只能证明等待者不再等，不能证明被等待者已停止使用数据库、MCP 或模型端口。
本次以现有 app owner 跟踪 accepted creation，排空包含 factory settlement 与 late app 关闭；
保持原进程绝对 deadline，不另起队列或 detached cleanup。

wrapper 只有确认 drain 成功才关闭共享依赖；失败/超时保留它们供进程退出回收。独立投影和
诊断仍清理。begin/stop/close 全部尝试并聚合原始错误，避免 finally 隐藏前序失败。

实现先通过 5 个 RED 约束顺序，再 GREEN12/12；增加错误覆盖 RED 后 GREEN13/13。
单入口导出合同 1/1，Bootstrap tsc 与定向 lint 通过。新代码收拢在 managed fork 模块，
旧协议文件只做带 FORK 标记的导出，不保留第二个资源 owner。

规格复核的 P1：普通 close 失败也会 finally 移除 app，误报成功排空。新增 RED 后改为仅成功移除，
14/14 通过并完成双审。独立质量探针 2/2 通过；根 typecheck/lint 和 Bootstrap tsc 通过。

同时开发的 runtime 接线、旧测试迁移及用户发布/CDN 修改不属于本提交。architecture-policy
仅提交本模块独立块，不能把并行 Task3b 的边界改动一并带入。
