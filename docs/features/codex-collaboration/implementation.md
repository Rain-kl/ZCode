# 实施与证据记录

## 当前状态

2026-10-29：代码同步和源码调查完成，设计待评审，产品实现未开始。
设计见 [design.md](design.md)。此文件不代表新能力已经可用。

## 已完成的准备

- 当前 main 与 origin/main 均为 `adbc5993122039d292cb42120f287f86d6183601`。
  fetch 后 fast-forward 检查为 Already up to date，工作区起始干净。
- 读取固定 Codex 提交 `6b3b3349f3f559d65b101998a65cad44e5b2ee7b` 的
  MultiAgent V2 tools、AgentControl、mailbox、spawn 接受边界、interrupt、
  execution guard、completion 以及角色提示词。
- 读取 ZCode 的 subagent runner、child runtime 装配、消息恢复、工具 handler、
  adapter 重试和 core streaming recovery，发现预算分散与父子取消信号耦合。
- 尚无现场 UI 复现记录；“具体哪种 steer 入口导致停止”仍须实施时通过真实场景确认。
- 没有把“存在 SendMessage 终态恢复”误记成“所有代理都能正常恢复”；
  registry、持久历史和失败时点仍决定现有恢复是否可用。

## 准备阶段检查

| 检查 | 结果 |
| --- | --- |
| node scripts/check-workspace-freshness.mjs | main 相对 origin/main ahead 0 / behind 0 |
| pnpm architecture:check --changed | 系统 pnpm 11 与仓库要求 pnpm 10 不符，尝试创建只读 HOME 下的存储目录失败 |
| node scripts/architecture/architecture-check.mjs check --changed | 同一架构入口直接执行通过，violations 0 |
| 产品代码修改、产品测试、typecheck、lint | 未执行；本阶段仅设计文档 |

实现阶段需要使用 packageManager 指定的 pnpm 10.33.2 和可写缓存路径。
不能把架构静态检查通过视为子代理时序已验证。

## 实施约束

新增源文件先登记 managed 模块；公开端口、schema 和单一状态所有者先于实现。
所有上游产品接线使用 `FORK(codex-collaboration)` 成块标记，实施时登记 FEATURES.md。
保留原错误及 cause，中文注释记录非显然根因，兼容入口不能形成第二套调度器。
复用原 traceId、childSessionId、工具结算和网络门禁。

本次用户尚未要求推送或发版；准备阶段不推送远端、不创建版本标签。
