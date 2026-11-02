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

另以真实 HTTP 工具往返验证 `send_message`：provider 首次返回指向 `/root` 的消息工具调用，
第二次请求必须携带同一 call ID 的空字符串 tool result，以及 assistant MESSAGE 信封。
不能回填 `{}` 或把协作正文序列化为 user 授权。该场景使用真实工具执行器、controller 邮箱和
adapter 序列化，补足仅检查 `ToolExecutionResult.modelContent` 无法证明最终 wire 内容的边界。

## 2026-11-02 执行记录

先构建 bootstrap 依赖闭包，再运行
`packages/bootstrap/tests/fork-codex-protocol-recovery/process.test.ts`：3/3 通过。
三个场景实际请求数为 2→3、2→3、21→22；箭头后为随后新输入完成后的累计请求数。
独立规格审查复跑 3/3 通过。根 typecheck、lint、测试文件定向 lint 与架构检查通过。
质量审查的失败清理问题已修复：强制终止后有界等待 child close，保留并汇总原始错误；
修正后独立复跑 3/3 通过并批准。
这是 Task3b 接线前的恢复证据；新运行时完成后需要重新构建并复验。

后续强化断言：每次输入必须先观察到新的 running 再接受终态；退出后还必须存在实际完成 server、
projection、store 和 model 清理的标记，不能仅凭 deadline 导致的退出码 0 推断清理成功。
此断言曾抓出施工中 bootstrap 源码与旧 Core dist 混用的缺失方法；重建 contracts/Core 后
3/3 通过，独立质量复跑同样 3/3 通过并批准。Task3b 最终提交仍须统一重建复验。

补充 OpenAI Chat Completions 的 `send_message` HTTP 往返后，4/4 通过，独立质量复跑
同样 4/4 通过并批准。实际第二次请求的 tool result 为空字符串，消息正文只在 assistant
信封；未据此宣称 Anthropic native wire 或全部六工具生命周期已经验证。

Task3b 生产源码冻结后，再次实际构建 bootstrap 依赖链（9/9 成功）并复跑 **4/4 通过**，
耗时 13.73 秒。复跑使用本轮构建的 runtime；日志
`/tmp/zcode-collaboration-final-protocol-wire.log`。生产包装器的关闭顺序另由 shutdown 合同测试验证。

```sh
PATH="$PWD/node_modules/.bin:$PATH" pnpm --dir apps/zcode-cli exec turbo run build --filter=@zcode/bootstrap...
node apps/zcode-cli/node_modules/vitest/vitest.mjs run --root apps/zcode-cli packages/bootstrap/tests/fork-codex-protocol-recovery/process.test.ts
```
