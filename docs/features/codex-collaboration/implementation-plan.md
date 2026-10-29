# Codex Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. 用户已批准连续实施和验证，任务之间不暂停请求确认。

**Goal:** 实现最多 20 次、最长 30 秒间隔的 API 恢复，并移植 Codex V2 协作语义。

**Architecture:** 模型失败链共享唯一预算；adapter 负责请求，core 负责已输出流的安全恢复。
根 runtime 的协作控制器统一管理身份、邮箱、执行句柄和名额；工具与客户端只发命令和投影事件。
现有子 session 存储、工具结算、权限和网络门禁继续作为边界使用。

**Tech Stack:** TypeScript、Node 24、AI SDK 6、Zod、Vitest、ZCode Protocol V4。

## 文件与职责

- contracts/src/model、core/src/runtime/methods、adapters/src/model：调用上下文、重试预算和流交接。
- core/src/fork/codex-collaboration：受控的调度、邮箱、角色提示和工具装配模块。
- contracts/src/interfaces/subagent.port.ts、core/src/subagent：旧执行端口适配，保留已有会话恢复。
- core/src/tool、core/src/runtime：模型工具曝光和 root/child 装配。
- bootstrap/src/zcode-protocol-v4、tui、packages/ui：既有事件的协作身份与状态投影。
- architecture-policy.yaml：新增模块 managed 边界，不以例外绕过新文件治理。
- docs/features/codex-collaboration、FEATURES.md、.agents/notes/codex-collaboration：合同、接线和证据。

CLI 路径默认相对于 apps/zcode-cli/packages；fork 标记统一 codex-collaboration。

## Task 1: 请求与断流恢复

- [ ] 在 adapters/tests 和 core/tests 写失败回归，实际断言请求数、取消与恢复状态。

```ts
expect(resolveAiSdkModelRetryOptions(undefined, {}).maxAttempts).toBe(21);
expect(calculateRetryDelay(retry, 20, 300_000)).toBeLessThanOrEqual(30_000);
expect(classifyModelFailure(new Error("provider response failed")).retryable).toBe(true);
```

必须另测用户 signal 未取消时 SDK AbortError、正文后的断流、未知错误块和缺失终态。
使用本地 HTTP 服务器或注入 runner runtime，确认后续请求存在；失败测试先红再实现。

- [ ] 引入调用级恢复预算，让 adapter 和 core 对同一连续失败链计数。

```ts
interface ModelRecoveryBudget {
  readonly attempts: number;
  readonly maxAttempts: number;
  claimAttempt(): number | undefined;
}
```

预算由 runtime 当前模型步骤创建并贯穿 invocation context；不能存储进 provider 历史。
最多 21 次物理请求，所有重试路径读同一个预算；无预算的独立 adapter 请求自行创建。
成功模型响应才结束恢复链。保持本地取消、权限和网络禁止的类型化排除。

- [ ] 修正错误准入、Retry-After 硬上限、断流安全锚点和 promise 清理。
  无完整响应的 EOF 抛结构化流失败；已输出时移交 runtime，不重播已结算工具。
- [ ] 跑新回归及现有 retry/stream/recovery/model-budget 相关套件，记录先红后绿证据。

```sh
node apps/zcode-cli/node_modules/vitest/vitest.mjs run --root apps/zcode-cli packages/adapters/tests/runner-retry.test.ts
```

- [ ] 同批更新规格和笔记，独立提交 fix(model)。规范审查通过后再做质量审查。

## Task 2: 协作控制器

- [ ] 以假执行 driver 写调度合同回归，先检查不存在实现时失败。

```ts
const child = await coordinator.spawn(root, { task_name: "worker", message: "work" });
await coordinator.interrupt(root, child.agent_id);
await coordinator.followup(root, child.agent_id, "continue");
expect(driver.sessionIds).toEqual([child.session_id, child.session_id]);
```

实际接口以本任务的 contract.ts 为准，后续调用方使用同一公开入口。
必测 mailbox queue-only 与 trigger-turn、先订阅后检查、steer 唤醒不取消 driver、
spawn 接受边界、路径隔离、并发名额、generation 和冷恢复身份。

- [ ] 建立 managed 模块 contract.ts/module.ts/contract.example.ts/contract.test.ts/CONTRACT.md。
  driver 是执行与持久化的有限端口；控制器不直接使用 fetch/fs/process。
- [ ] 实现身份树、顺序 admission、邮箱与 wait、运行名额和显式 interrupt。
  旧 runtimeTaskRegistry 对子代理是单一控制器的投影，不能新增另一份可写状态真相。
  completion/error/interrupted 释放运行名额，但保留身份、历史和未读消息。
- [ ] 跑控制器合同和生命周期回归，同批更新合同/笔记，提交 feat(agent)。
  规范审查通过后做质量审查，修复后再进入下一任务。

## Task 3: 工具、角色与实际 runtime 装配

- [ ] 写真实父子 runtime 回归：spawn 返回后 wait 时 steer，child 的模型和工具继续。
  失败后的 followup 使用原 childSessionId 和 transcript；cold resume 同样成立。
- [ ] 在 contracts 和 managed 模块声明六工具严格 schema 与 ToolEntry。

```text
spawn_agent(task_name, message, fork_turns?, agent_type?, model?, reasoning_effort?)
send_message(target, message)
followup_task(target, message)
interrupt_agent(target)
list_agents(path_prefix?)
wait_agent(timeout_ms?)
```

默认工具面只宣传新工具；旧 Agent/Task/SendMessage 只做兼容入口，保留历史识别。
ToolSearch、权限、结果限额和 hook 必须走现有链。新名字同步 fork/tool-modes。

- [ ] 根 runtime 创建唯一控制器，子 runtime 共享按身份绑定的端口。
  spawn 接受后 signal 独立；wait 只取消订阅；interrupt 创建新轮次时更换 controller。
  父正常完成不释放 child 运行句柄；宿主关闭显式清理树。
- [ ] 移植固定 Codex 提交的主/子角色、消息信封、fork all/none 和模型继承规则。
  补 Apache-2.0 归属；保留 profile/skills/memory/AGENTS.md 权限边界。
- [ ] 保留旧会话恢复和工具结果配对；验证 child 与主线程可双向消息、续跑和嵌套限制。
- [ ] 跑 core/subagent、bootstrap/subagent、模型可见工具与权限回归，提交 feat(agent)。
  独立规范/质量审查均通过。

## Task 4: 客户端投影与端到端回归

- [ ] 写 V4/TUI 与实际协议进程回归：steer、child 终态、续跑和子会话下钻。
  本地 HTTP 故障场景覆盖首 token 前和输出中途断开，检查进程存活和实际后续请求。
- [ ] 六工具事件映射到既有 subagent/background work；不把 UI 作为调度所有者。
  desktop continuous 和 mobile replayable 从同一序列恢复，不重复完成、不倒退状态。
- [ ] 运行受影响包测试和完整 CLI typecheck/lint；明确标注环境阻塞，不伪称实机验证。
- [ ] 更新 FEATURES.md、implementation.md 和笔记中的接线、限制、实际验证记录，提交 fix(agent)。

## Task 5: 收尾

- [ ] 全功能规范审查，再做最终代码质量审查，所有严重问题先修复。
- [ ] 执行根 typecheck/lint、architecture:check 和 fork:check-removals；CLI 独立检查不可省略。
- [ ] 检查 git diff、FORK 标记、许可证和干净状态。每个功能提交只包含本任务文件。
- [ ] 本地合回当前 main（无冲突时 fast-forward），不推送、不发版；汇报 commit 与验证结果。

## 状态与证据

本计划按用户批准连续执行；具体先红后绿和命令结果写 implementation.md，
不能用设计断言代替实际运行证据。
