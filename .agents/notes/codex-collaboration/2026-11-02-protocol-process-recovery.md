# 真实协议进程的模型恢复证据

仅运行 adapter 或假的 ping 子进程不能证明出错后真实 runtime 仍能接收下一次输入。
本次新增独立 Node fixture，运行真实 NDJSON transport、protocol server、application、SQLite store
与 HTTP adapter，通过已有 application factory 配置本地 provider，不增加产品 DI 或环境开关。

父进程记录 HTTP 请求数，并在收到含唯一 assistant 文本标记的 conversation frame 后才断开流。
这能区分“尚未输出便失败”和“客户端已经看到输出后断流”，避免固定延时误判。
子进程使用 `--unhandled-rejections=throw` 及现有 CLI 致命错误边界；正常清理通过 stdin EOF，
验证退出码 0。各层仍由原 owner 管理状态：父进程只控制 provider，恢复预算和会话属于子 runtime。

2026-11-02：三场景实际通过，请求数分别为 2→3、2→3、21→22（箭头后为后续新输入累计数）。
持续失败在第 21 次请求终止且保留 provider 错误上下文，随后进程接受健康新输入。
独立规格复查同样运行 3/3 通过。根 typecheck、lint 和定向测试文件 lint 通过；架构检查 0 violation。
质量审查发现失败清理中仅发送 SIGKILL 未等待 close；已增加有界 close 等待并汇总原始超时、
关闭与诊断错误，所有清理继续执行。修正后独立质量复跑 3/3 通过并批准。

fixture 使用构建后的包依赖，运行前需要构建 bootstrap 的依赖闭包。它不证明生产启动包装器的
账号/遥测/MCP 初始化，也不证明新六工具 runtime 或 GUI。新 runtime 接线后仍需重新构建和执行。
测试构造过程中的缺失 fixture 失败不是产品 bug 的 RED 证据，本次不据此宣称修复了新产品缺陷。

后续断言要求每次输入的 running→terminal，以及在所有实际关闭完成后写出的标记，避免上一轮迟到
终态或 lifecycle 兜底退出码 0 导致假成功。新增断言曾捕获施工中 bootstrap SRC 调用新方法、Core
dist 尚未重建的不一致；重新构建 contracts/Core 后 3/3，通过双审。清理错误聚合正文保留各原因，
EOF 与强杀后 close 各 5 秒预算，置于 15 秒 hook 内。最终 runtime 完成后仍统一重建并复验。
