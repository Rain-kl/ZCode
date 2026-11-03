# Task4：六工具 canonical 客户端投影

## 决策与所有权

先更新 `client-acceptance.md` 和工具链 spec，再执行实际 RED 并实现。Root entry + accepted graph
是协作身份 authority；controller 拥有执行状态；ProductProjection 是唯一 row/work 写入 owner。
UI/TUI/冷查询不调度、不初始化 controller、不解析模型 ACK、不推断 childSessionId。

新增受管模块：bootstrap `codex-collaboration-client` 只读 resolver/严格 metadata；UI
`codex-collaboration-ui` 仅六工具展示。架构策略登记公开入口与层次；新源码均不超过 800 行。
原有 bootstrap 大投影文件仅保留有限 lifecycle 接线与幂等规则，不引入第二 cache/owner。
完整链路和 Mermaid 所有者图见 `docs/features/codex-collaboration/client-implementation.md`。

只有 spawn 生成 child item；accepted tool result 不能完成 child。原 opaque agent/session 与
spawn anchor 跨 followup 保留；低代、缺失代和同代 terminal→running 回退均拒绝。
不同 agent 争用同 anchor 明确报错。canonical 冷种子同时清除无效 child row/background work。
冷 saved running 通过精确同步 public runtime port 判活；没有 owner 时只改 read model，不写假终态。
真实子 session 才可逐层走 accepted parent edge；普通 UI fork 不继承来源树。

删除旧 send-message/respond-to-coordinator/agent renderer、agentPromptSection 与旧展示专属测试；
unscoped dep-refs 证明被删 Agent renderer 只有旧 tests 引用，prompt section 只被该 renderer 引用。
另用 rg 补核路径（dep-refs 不保证捕获动态引用）。agentHelpers 仅剩新 spawn 参数标题。
contracts/shared/UI 的旧消息 display discriminants 与 reader 整链删除，移除守卫阻止回流。
TaskOutput/TaskStop 的 Bash/workflow 展示保留，native Stop 仍走 controller interrupt。
native child usage 合成条目使用 spawn_agent；workflow actor 保留原独立归因。

## 实际 RED → GREEN

临时日志位于 `/tmp/zcode-task4-*.log`：

- identity 初始 10 fail/8 pass；新六工具旧四名 unknown 的期望驱动替换。
- renderer 初始落默认 Stop；cold reader 初始缺模块，随后 strict/cold 边界 2 fail/9 pass。
- display 移除初始 2 fail/18 pass，确保旧 discriminants 不能被继续接受。
- coldseed 1 fail/2 pass：row 清除但 backgroundWork 残留；同 owner 原子清除后通过。
- anchor identity 1 fail/3 pass：旧按 anchor 归并不同 agent；改为冲突诊断后通过。
- fork copied metadata 1 fail/9 pass：part.sessionID 被重写时误当新父身份；按 canonical parent 过滤。
- ordinary fork 自己已有 root 的补充组合 1 fail/11 pass：非本图来源 metadata 被误诊断为本图
  parent 冲突；只对本图 accepted call 的错 parent 报错，其余来源 metadata 不创建 child。
  该实际 RED 位于 `/tmp/zcode-task4-ownedfork-red.log`；最终 query 12/12 通过。
- boundary 3 fail/11 pass：无 generation 的旧终态覆盖 gen2；metadata schema 错误缺 session/call；
  通过已有 generation guard 与带 cause 的严格解析修复。
- 参数 3 fail：wait timeout、list path_prefix、spawn model 未展示；补有意义字段与中英文标签。
- native telemetry 1 fail：仍归为旧 Agent；改为 spawn_agent，保留 workflow attribution。
- removal guard 1 fail：注册表未约束旧 renderer/display；补有限指定文件守卫。

UI 真实 publisher→ConversationProjectionStore 测试复用原 FakeTransport，仅交付 profile 参数化；
实际输入同一 spawn、parent steer、terminal、followup、terminal 序列，覆盖 duplicate frame、
丢帧 gap/resync、旧代终态、单 child/原 anchor/同 seq。初次失败仅为 cleanup 用错 dispose，
业务断言已通过；改用真实 close/unsubscribe 后全部通过。没有伪称该 UT 为手机 GUI 验收。

## 定向验证

- 根 Vitest 显式 11 files：398/398（UI/shared/telemetry/managed UI contract）。
- bootstrap 显式 7 files：448/448（query/projection/hydration/cold hydration/V4 gateway）。
- bootstrap managed reader contract：1/1，使用临时 Vitest include 配置执行源码旁 contract.test。
- TUI node:test：25/25；CLI observation/subagents node:test：12/12；contracts metadata：20/20。
- 移除守卫 node:test：1/1；fork:check-removals 通过；architecture:check --changed 通过 0 violation。
- `pnpm typecheck`：exit 0；`pnpm lint`：102 warnings、0 errors。
- CLI 类型检查原入口遇 `turbo: command not found`，根 `pnpm exec turbo --cwd apps/zcode-cli run typecheck`
  执行同一包图 32/32 通过；根任务最终也对新构建源码执行了 32/32。
- CLI lint 原入口将 native pnpm 当 JS 交给 Node 而报 SyntaxError；临时 JS wrapper 仅转调原 pnpm，
  原样执行 `scripts/run-cli-lint.mjs` 各包命令，结果 5 errors/71 warnings/6 admitted upstream counts。
  5 个 max-lines 是 adapters/fs 1642、core/background-tasks 942，以及本任务触碰的
  cold-event-merge 805、transcript-hydration 1722、product-projection（格式化后 5241）。后三者是现存大模块，
  本任务删旧 hydration 并加有限 lifecycle 接线，没有通过 disable/blanket exemption 掩盖失败。
- oxfmt 对显式 own manifest 源文件执行；CLI 目录被仓库 ignore 默认排除，因此用
  `--ignore-path=/dev/null` 对同一有限文件表补跑，实际格式化 53 文件。

TUI 初次用 Vitest 误跑 node:test 文件，显示 no suite；已纠正为包内真实 node:test 入口并通过。
bootstrap gateway 早期并发回归有一次 5 秒 oversize 用例超时；随后相同原断言/原时限精确回归通过，
没有为绿态提高 timeout。未运行全量 tests，未 push。

最终新 bundle 的 CSC01 曾在父轮 completed 后直接找 child DOM 失败；原工作历史合同会在
父轮有最终正文时折叠并卸载 CollapsibleContent，工具/child 同时暂不可见，后台 badge 仍为 1。
runtime 日志有真实 spawned，无 identity/schema 投影错误。根任务按既有产品交互先通过
真实 history trigger 展开，再保持所有 exact opaque child/tool/anchor 断言；本批没有为测试
改变父完成态或恢复 ACK 身份。最终 Electron 重跑 CSC01 实际 GREEN 1/1（19 秒），artifact
`desktop-e2e-20261102-170402-103`、日志 `/tmp/zcode-collaboration-expanded-desktop.log`。
该 bundle 包含 UI/metadata/generation/telemetry 清理；ordinary fork 自身已有 root 的最后
reader 修复晚于该构建，使用 query 12/12 与 bootstrap 448/448 的 UT 证据，不冒充 GUI 覆盖。

## 验证边界与工作区保护

桌面 CSC01 与正式 running-send-now 由根任务拥有并实际执行，独立协议 HTTP 恢复也由根任务负责。
其每次构建快照和后续 cold boundary 修复分别记录，不能借旧 bundle 证明新代码。
本批 UT 不等于实机 mobile replayable，也不等于 API 网络恢复或 production shutdown 验收。

只提交 own manifest；用户 `.gitignore`、`codex/`、711003e4、发布/WebDAV施工和根任务
FEATURES/implementation/plan/Desktop fixtures 均保留。locales/removal registry 曾同文件并行，
提交前复查 diff，只拥有 codex-collaboration hunks；不卷入 local-mode/WebDAV 部分。
