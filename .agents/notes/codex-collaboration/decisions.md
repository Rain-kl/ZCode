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


## 2026-10-30：Task 1 实施决策与回归

用户已批准方案与实现/验证。预算唯一 owner 为纯合同对象；Core 持有失败链引用，Adapter 每次
物理 SDK 调用前 claim，constrainMaxAttempts 只收紧共享上限。SingleAttempt 不收紧 provider fallback
全链。所有 workflow actor 默认 bounded，耗尽事实必须阻止外层 driver redrive。

真实 HTTP 证明仅检查 SDK finish 不够：AI SDK 会在缺少 provider terminal 的 EOF 合成 finish(other)。
正文半句会被错误当成答案，tool-only 时还会让待提交写工具执行；现在无 provider stop reason 的
合成 finish 一律是 incomplete-stream 失败。语义 ContextExceeded 必须先 handoff Core compact，不能
在 Adapter 重放21次；compact 的 stream/nonstream 与后续请求仍共享原 budget。

独立 compact 也需要一个新 owner 跨 transport fallback：只修 ambient reactive context 会让独立 compact
合计22请求。耗尽时不调用空预算 fallback，保留最后真实 API cause。

取消 signal 在 SDK setup 同步发生时，仍必须给已创建 promise 安装 rejection observer。
修复前独立子进程 unhandled=true；修复后 false；没有修改全局 process 错误处理。

父代理隔离基线证实 test-runtime-model.streamText 漏投影返回的 tool_call，造成大量测试根本未执行工具；
仅补 ModelEvent 投影即可让原工具断言变绿。WebFetch 已 direct-return，既有测试还期待二次模型处理，
按既有产品合同修正测试，保留 HTTP 与工具结果验证。

watchdog 本任务豁免声明式 model retryDelayMs 和活动 SSE attempt 的 idle timeout（加本地 setup grace）；permission/message 明确等待需要 Task 2/3 的
新 driver 状态合同继续处理，不能宣称所有等待生命周期均已迁移。

两个新增模块已 managed 登记。CLI 原 runner-stream 体量超限，统一错误路径后缩短文件，仍保留
带理由的局部 max-lines suppression。未触碰的 fs/index 和 product-projection 既有 lint 错误单独报告。

2026-11-01 续查：非空 context-exceeded finish 发生在 SDK 返回后，必须在语义验收之后才释放
budget；normal/compact/normal 真实合同计数断言为 [1,2,3]。SDK local typed validation 与本地
EACCES/EPERM/网络门禁按 cause 链结构分类，归一化 localControl 并由 workflow inspector 停止，
避免 retryable=false 被外层 driver 重新解释成无限 redrive；保留原始 cause 与请求详细上下文。

续查的 SDK 依赖陷阱：UnsupportedModelVersionError 没有专属 isInstance，继承通用
AISDKError 判断，直接放入 typed local 数组会把所有 APICallError 当成本地校验。
改为该类 instanceof，真实 API 400/503 与模型版本校验分别锁定依赖契约。
compact 原生 raw stop_reason 是终态事实，后续 null 不得撤销；SDK 合成 other 仅在
完全缺少终态证据时视为 incomplete-stream。Runtime header 准备失败同样带 localControl
并阻止 workflow 外层重驱。backoffFactor<=1 的配置/env覆盖无效，回退默认2。

2026-11-01 最终回归：typed ContextExceeded（含嵌套 cause）必须先于通用 reconnect，
避免错误绕过 reactive compact；外层 retryable=true 不能覆盖内层取消、localControl、
超窗或预算耗尽。新六例先红后绿，既有 thrown-context normal/compact/normal 回归保留。
MFJS/迁移 wire fixture 显式 maxAttempts1 保留一次载荷断言；PAT换证使用预算2并增加预算1
不越界断言；runtime admission fixture恢复实际主工具调用后保留全部端口继承验证。
最终21文件633测试通过，CLI类型32/32；架构0新增。CLIlint两个既有max-lines错误如实保留，
大范围153失败的基线归因与局限记录在implementation.md及任务报告；未宣称完整CLI全绿。
