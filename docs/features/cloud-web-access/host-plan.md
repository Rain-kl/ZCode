# 远控宿主对齐执行计划

目标：按宿主合同完成项目导航、连接恢复和当前网页部署。

验收规格：[宿主合同](host-contract.md)。

- [x] 补齐真实项目服务的导航回归：项目新建、任务原目录、跨主机拒绝、身份登记、取消。
- [x] 在独立 Server 的 fork 接入层组合现有项目和工作区服务，提供宿主导航能力。
- [x] 远控 Connector 消费完整导航意图，完成 bridge 代际、错误响应、连接终结和能力声明。
- [x] 让 Web 使用宿主实际身份和能力，通过真实 Core 验证项目与任务闭环。
- [x] 让 Worker 提供当前网页与哈希资源，验证入口、HEAD 与资源缺失反馈。
- [x] 执行 Desktop 对照、Server 浏览器闭环与必需检查，记录证据并提交。

验收记录见[实现记录](implementation.md)与[运行证据](../../../.agents/notes/cloud-web-access/2026-11-04-host-alignment.md)。
