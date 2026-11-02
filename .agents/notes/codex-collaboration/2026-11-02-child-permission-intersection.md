# Task3b review P1：profile不能扩大父工具权限

独立实际runtime证明父toolAllowlist仅spawn_agent/Read，显式writer profile仍能让child获得Write。
根因是prepared policy仅在继承(*)分支取父工具，显式tools分支直接返回profile请求。

先补runtime-integration权限合同，再补四项实际RED：fork all/none均不得扩出Write；profile的mcp与
mcp__safe__* selector只能得到父allowlist获准的read，且profile deny Read优先。随后统一为父能力目录
与profile请求交集，再应用父/profile deny。MCPselector只输出具体获准名称，不原样带入child重扩展。

父普通工具来源getTools()是registry完整可授权目录，不是本轮provider曝光subset；MCP来源父启动快照
及父allowlist，因此不用等ToolSearch发现。MCP回归启用local ToolSearch，但从未运行父搜索就能让child
获得获准read，未获准write始终缺席。child自己没有搜索控制时仍可执行自己的合法工具。

保留profile刷新/memory测试原来的断言，只把Grep标记换成父实际存在的Bash。默认embedded分支父无Grep，
旧fixture靠显式profile绕过父工具面，新安全合同不能为保持该标记而恢复越权。Memory Write/Edit、deny、
父轮次冻结及相同child session的断言不删。

实际GREEN：真实runtime及profile刷新/ToolSearch7文件62/62，core noEmit通过；定向lint/架构随提交。
不变更模型、角色prompt、旧工具兼容或无关产品。
