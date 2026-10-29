# Codex 协作迁移：调查与设计

2026-10-29，基线 main adbc5993；origin/main 同步检查没有新增提交。

用户指定采用 openai/codex 的子代理调度、提示词、工具和生命周期，并规定模型 API
指数退避最多 20 次、间隔最多 30 秒。Codex 源码固定到
6b3b3349f3f559d65b101998a65cad44e5b2ee7b，采用 MultiAgent V2 六工具合同；
不能误用旧版 send_input/resume_agent/close_agent/wait 的 V1 工具面。

确认 ZCode 前台 run 将父工具 signal 绑定 child AbortController；后台启动已有独立 controller。
这是 steer 取消可能向下传播的证据，尚未复现用户的完整客户端场景。
现有 SendMessage 对 terminal registry task 已有 resumeFromStore 路径，因此方案应迁移与
修复现有能力，不能宣称恢复从未存在。

重试有 adapter 默认 10、最长 60 秒、Retry-After 可超上限、core stream recovery 10、
workflow unbounded 多个边界。单改常量无法保证用户给定的硬上限。
设计统一失败链预算，并保留工具结算锚点；已接受 spawn 必须脱离调用者取消信号。

推荐 TypeScript 移植 Codex 协作合同，继续使用 ZCode runtime 的模型和工具边界。
不嵌入第二个 app-server；不恢复已被用户切断的上游账号/营销/遥测连接。

根 AGENTS.md 要求该类大功能使用 Superpowers；brainstorming/SKILL.md 的 HARD-GATE
要求具体设计经过用户批准才可改实现。因此当前仅保存设计、证据和工具链入口，未改产品代码。
后续批准后再进行 writing-plans 与实现；不把本文当作已完成修复或已通过回归。
