# Task3a：六工具合同与旧工具移除

用户明确不需要旧 Agent/Task/SendMessage/RespondToCoordinator 兼容，因此删除执行器而不是隐藏或映射。
caller 绑定端口走标准权限/hook/executor；模型 spawn 仅回路径，内部身份留给后续持久生命周期。
空消息成功通过明确 ToolEntry 声明保留空文本，不改变 Bash 的空输出占位。

先更新 tool-chain/tools-contract，再写 RED：旧入口存在、新工具缺失、空输出被改写、子代理仍被后台工具接受、配置丢失。
先后跑实际失败后实现；最终 focused Vitest 75/75，另新增 resident ToolSearch 回归 9/9、node:test 档位 3/3、CLI typecheck 32/32、architecture/removals通过。
完整 CLI lint 仍为既有 fs/index 与 product-projection 两个行数错误，71警告；改动文件 scoped lint 零错误。

配置 owner 沿 ConfigPort 原合并链，defaults explicit/4/1/3。contracts Zod3 与 adapters Zod4 不跨包拼 schema；
adapter 以公开 safeParse 结果转换并保留每个 issue，不用类型断言压过真实不兼容。
TaskOutput 通用格式/等待/产物测试改为 dynamic workflow fixture，独立保留 legacy local_workflow 文件读取。

仍未交付默认 controller runtime、持久 mailbox ACK/身份元信息、真实父子权限等待/续跑、完整 fork 和 UI 下钻；
Task3b/4 继续。原生 UI stop 将走 controller interrupt；模型 TaskStop 不恢复子代理旁路。
本提交只包含自己修改文件，保留用户 .gitignore 与 codex/；不推送。
