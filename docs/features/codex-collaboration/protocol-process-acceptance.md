# 独立协议进程的 API 恢复验收

本验收补充 `client-acceptance.md` 的真实进程证据，不改变生产重试策略或新增测试专用产品接口。
测试以独立 Node 进程运行真实 NDJSON connection、protocol server、application、SQLite session store
和 HTTP model adapter；通过既有应用工厂注入本地测试 provider。它不覆盖生产启动包装器中的账号、
遥测、MCP 初始化，也不代替六工具生命周期或桌面与手机 GUI 验收。

父进程拥有本地 HTTP 故障服务器和物理请求计数；子进程拥有真实会话、runtime、模型恢复预算和
协议消息序列。测试不读取用户配置或会话库。所有数据保存在临时工作区，子进程以
`--unhandled-rejections=throw` 启动。正常结束通过 stdin EOF 触发协议关闭，强制终止只用于失败清理。

验收场景：

1. 首 token 前 HTTP 500，下一次请求成功：恰好两次物理请求；恢复期间没有提前终态；随后新输入成功。
2. 已有可见文本后销毁 HTTP stream：父进程先观察真实 conversation 文本事件，再打开断流门闩；
   下一次请求成功，恰好两次请求；随后新输入成功。不得用固定 sleep 假定输出已经送达客户端。
3. 连续 HTTP 500：恰好 21 次请求后失败，不出现第 22 次；随后将 provider 切换为健康，新的输入
   发出总计第 22 次请求并成功。错误必须保留失败上下文，不能将耗尽误报为成功。

测试可以通过已有 adapter retry 选项缩短退避等待，但预算仍为 21 次物理请求。
每个场景检查实际协议终态、进程存活和后续输入，不以日志中的“重试”字样代替 HTTP 请求证据。
初始 command accepted ACK 不作为任务完成的信号。

## 2026-11-02 执行记录

先构建 bootstrap 依赖闭包，再运行
`packages/bootstrap/tests/fork-codex-protocol-recovery/process.test.ts`：3/3 通过。
三个场景实际请求数为 2→3、2→3、21→22；箭头后为随后新输入完成后的累计请求数。
独立规格审查复跑 3/3 通过。根 typecheck、lint、测试文件定向 lint 与架构检查通过。
质量审查的失败清理问题已修复：强制终止后有界等待 child close，保留并汇总原始错误；
修正后独立复跑 3/3 通过并批准。
这是 Task3b 接线前的恢复证据；新运行时完成后需要重新构建并复验。

```sh
PATH="$PWD/node_modules/.bin:$PATH" pnpm --dir apps/zcode-cli exec turbo run build --filter=@zcode/bootstrap...
node apps/zcode-cli/node_modules/vitest/vitest.mjs run --root apps/zcode-cli packages/bootstrap/tests/fork-codex-protocol-recovery/process.test.ts
```
