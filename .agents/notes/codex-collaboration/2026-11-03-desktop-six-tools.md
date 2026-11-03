# 六工具真实桌面验收

## 取舍

用户要求全面废弃旧四工具；本次只通过六工具 provider 响应驱动真实 Agent，不恢复旧 BG/XML fixture，
不把 ACK、工具返回成功或自造 child ID 当作后台子会话运行的证据。测试先补 spec、catalog 和 matrix，
再实现 pending case。独立规范审查指出四个证据盲区，补齐后批准。

## 实际验证

- 首轮 fresh Electron/Agent build 后失败：manual-review 默认模型窗口 240/80 引入自动 compact，
  后续无匹配 fixture 的 HTTP 500 触发重试。日志 `/tmp/zcode-csc-desktop-run.log`。
- 用现有环境合同 `ZCODE_E2E_UPSTREAM_CONTEXT_WINDOW=128000` 和
  `ZCODE_E2E_UPSTREAM_MAX_OUTPUT_TOKENS=8192` 保留普通窗口；第二次失败是测试错误地期待
  spawn 行 completed。产品约定该行跟随 child lifecycle，故 child 仍运行时应为 in_progress。
  日志 `/tmp/zcode-csc-desktop-window-run.log`。没有修改产品来迎合错误断言。
- 修正测试后复用刚构建的 bundle，CSC01 1/1 通过，23.1 秒。
  artifact `packages/desktop/.e2e-artifacts/desktop-e2e-20261102-163711-401`；
  日志 `/tmp/zcode-csc-desktop-contract-run.log`。
- 再次 fresh Desktop/Agent build 复验 1/1、24 秒：artifact
  `desktop-e2e-20261102-163823-235`，日志 `/tmp/zcode-csc-desktop-final-run.log`。
  包含严格 metadata 修复，但不包含随后 cold-seed backgroundWork 清除；本 GUI 不覆盖该路径。
- E2E TypeScript 与 case-local fixture checker 通过；checker 四个警告来自只作最终正文断言的响应
  marker，不是请求 matcher。用例继续留在 manual-review/pending，不自动提升准入。
- 质量审查指出清理 provider 失败会跳过后续 Stop/mock/data。先补合同和实际 RED（helper 缺失），
  再提取顺序 attempt-all helper，失败探针 GREEN：gate-1 失败仍尝试 gate-2、Stop、mock 和 data，
  两层 AggregateError 保留 provider/Stop 原错误。日志 `/tmp/zcode-csc-cleanup-{red,green}.log`。
- cleanup 修复后复用最新 bundle 再验 CSC01 1/1、50.6 秒，artifact
  `desktop-e2e-20261102-164341-233`，日志 `/tmp/zcode-csc-desktop-cleanup-run.log`。
  规范增量和质量均批准；没有将分批通过相加冒充更多 case。
- 最后客户端新构建：正式 steer 5/5、48.2 秒（`desktop-e2e-20261102-165743-477`）；
  同轮 CSC01 发现测试没有展开父 completed 的工作历史，摘要不挂 DOM。源码确认既有折叠合同后，
  先补 spec，再复用真实点击展开的 `waitForToolCallBlockByToolCallId`；不改产品、不放松身份断言。
  同 bundle CSC01 再验 1/1、19 秒（`desktop-e2e-20261102-170402-103`，
  `/tmp/zcode-collaboration-expanded-desktop.log`）。该构建含冷 seed work 修复，最后 ordinary fork
  自身 root 的隔离组合由单测验证；没有因 GUI 未覆盖该组合而宣称其已实机验证。

## 证据边界

完整链路覆盖六工具真实 HTTP 请求、双方 assistant MESSAGE 信封、child 原始响应尾部和成功 TodoRead
结果、父空闲时不隐式启动请求、真实 child session 下钻和终态、原 session/原 spawn anchor 续跑、
原生 Stop 与随后状态查询，以及 list/wait 无 Stop 操作。没有逐字验证 FINAL_ANSWER 信封，
没有执行手机 GUI、Windows/Linux 或所有 provider 协议；代际/冷恢复由独立合同测试验证。
