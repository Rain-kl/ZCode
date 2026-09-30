# 功能组（tool-modes）实现记录

## 1. 落地位置

| 文件                                                                                  | 职责                                                                         |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/shared/src/fork/tool-modes-contract.ts`                                     | 模式类型、状态 schema（缺省「标准 + 注入」）、解析、`mcpEnabled`             |
| `apps/zcode-cli/packages/core/src/fork/tool-modes/mode-tools.ts`                      | 三档**分类**（不复制工具全集）与档位解析                                     |
| `apps/zcode-cli/packages/core/src/fork/tool-modes/index.ts`                           | core 公开入口                                                                |
| `apps/zcode-cli/packages/bootstrap/src/fork/tool-modes.ts`                            | 读状态文件 → 档位解析 → 写 `runtimeConfig.toolAllowlist`（与宿主名单取交集） |
| `packages/services/src/fork/toolModes.ts`                                             | 服务面 + 描述符（通道 `fork-tool-modes`）                                    |
| `packages/desktop/src/host/fork/tool-modes/{store,service,index}.ts`                  | `tool-groups.json` 原子读写、`setMode` / `setInjectTools`、状态事件          |
| `packages/ui/src/fork/tool-modes/{useForkToolMode.ts,ToolGroupsSection.tsx,index.ts}` | 设置栏目                                                                     |

## 2. 关键改动

- **档位 → 白名单 → 单点生效**：`runtimeConfig.toolAllowlist` 的消费点是 `runtime-tools.ts` 的 `resolveBuiltInToolAllowlist`，它同时喂给 MCP 注册（`runtime/methods/mcp.ts`）。所以不需要动 `mcpServers`，MCP 工具自然随档位收敛。
- **标准档 = 不下发**（`undefined`）→ 不加任何约束 = 改动前行为；**关闭注入 = 空数组** → 一条工具都不注册（仓库既有语义，`tools: "none"` 即此）。
- **与宿主下发的既有名单取交集**：档位只让工具面更小，永不变大（CUA 等会话会带自己的白名单）。
- **分类完整性由测试盯住**：`core/test/forkToolModeTools.test.ts` 断言每个注册表工具恰好归类一次——上游新增（未归类）或改名/下架（残留名）都会变红，逼一次显式归类。取代了原先「@zcode/shared 存一份名单 + 一致性对齐」的镜像做法。

## 3. 上游接线点

| 文件                                                                                                           | 改动                                                          |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `apps/zcode-cli/packages/core/src/index.ts`                                                                    | 导出 `./fork/tool-modes/index.js`                             |
| `apps/zcode-cli/packages/bootstrap/src/app/create-app.ts`                                                      | runtimeConfig 装配后调用 `resolveForkToolMode` 并记 info 日志 |
| `packages/services/src/{index,accessor}.ts`                                                                    | 服务面导出与访问器字段                                        |
| `packages/client/src/remoteServiceAccess.ts`                                                                   | manifest-gated 服务 + key 登记                                |
| `packages/desktop/src/host/index.ts`                                                                           | 注册服务（状态文件与身份配置同级）                            |
| `packages/desktop/src/host/fork/webdav-sync/manifest.ts`                                                       | 同步清单加一行 `tool-groups.json`                             |
| `packages/ui/src/lib/settingsNavigation.ts`、`settings/settingsPageConfig.ts`、`SettingsPage.tsx`、两个 locale | 栏目接线与文案                                                |
| `packages/shared/src/test-ids.ts`                                                                              | 2 个 test-id                                                  |

## 4. 验证记录

- 契约 3 条、分类完整性 2 条、bootstrap 解析 5 条、WebDAV 40 条 → 合计 **49 通过**。
- `pnpm --filter @zcode/core build`、根 `pnpm typecheck`、CLI 侧 typecheck 27/27 通过。
- 未验证：界面在运行中的应用里未肉眼确认（调试端口已关闭）；打包产物未验证。

## 5. 与设计的偏差

1. **工具名清单落在 core 而不是 `@zcode/shared`**：架构复查结论——工具名的权威来源是注册表，抄一份到 shared 是跨包镜像；改为 core 侧分类 + 完整性断言测试。
2. **界面不展示逐工具清单**：渲染层 import 不到 core，这是上一条的代价；改为「档位 + 后果说明」。
3. **denylist → allowlist**：评审指出 denylist 下 MCP 会漏出控制（既漏进极简/基础，也逃过「注入工具」总开关），且极简/基础的工具集本就已知固定。

## 6. 已知边界

- **子代理不继承档位**：已确认 `runtime/methods/subagent.ts` 给子运行时算的是它自己的 `childToolAllowlist`，不取父配置名单。极简档下 `Agent` 工具本身就不在名单里，因此无子代理；基础档下拉起的子代理仍持有其档案定义的工具面。要穿透需在子运行时配置里与父名单求交集（未做）。
- 只对新会话生效（工具面在创建期冻结）。
