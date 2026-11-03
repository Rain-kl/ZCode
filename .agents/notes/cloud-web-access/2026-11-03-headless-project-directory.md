# Headless 新建项目目录与可选 channel

日期：2026-11-03

## 现场证据

公网 local bridge 已正常连接 `/home/ubuntu` 工作区。打开“新项目”→“选择文件夹”后，页面显示“无法获取系统信息”，选择按钮不可用。通过 React 运行时检查确认：

- Root 使用的远控 services 能正常返回 `/home/ubuntu` 和 Linux 平台；
- `ProjectEditor` 的目录 services 返回 `project.host-offline`；
- 服务端日志在首屏重复出现 `Unknown channel: window-controller`。

## 根因

项目向导的“此电脑”发送 `hostId=local`。Source Server 的项目服务把内部 owner host identity 作为本机判断，只把空值或该 identity 当作本机，于是把浏览器发来的 `local` 误判为离线远端；Server 没有远端 Host 路由，最终抛出 `project.host-offline`。目录浏览器将该错误映射为“无法获取系统信息”。

Source Server local bridge 不注册桌面专用的 `window-controller`，但 Web remote 在 RPC Initialize 到达前仍按“未知清单兼容旧服务端”的规则构造可选代理，首屏 hooks 因而向不存在的 channel 发请求。服务端等待 1 秒后记录未知 channel。

## 决策与回归

项目服务将 `local` 和内部 owner host identity 都路由到当前服务实例；稳定 identity 仍只用于存储隔离，不要求浏览器知道。Web remote local bridge 显式关闭 `windowControllerService` 代理，remote bridge 保持原能力；该选项由既有 RemoteServiceAccess 可选服务合同承载，不新增业务状态。

先写两个失败回归：`local` 目录读取必须命中 Server 本机目录；local Server bridge 不得请求 `window-controller`。实现后分别覆盖成功目录结果和无 channel 调用。
