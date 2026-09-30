# 功能组（tool-modes）实现记录

## 1. 落地位置

| 文件                                                                  | 职责                                                                         |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/shared/src/fork/tool-modes-contract.ts`                     | 模式类型、状态 schema（缺省「标准 + 注入」）、解析、`mcpEnabled`             |
| `apps/zcode-cli/packages/core/src/fork/tool-modes/mode-tools.ts`      | 三档**分类**（不复制工具全集）与档位解析                                     |
| `apps/zcode-cli/packages/core/src/fork/tool-modes/index.ts`           | core 公开入口                                                                |
| `apps/zcode-cli/packages/core/src/fork/tool-modes/file-port.ts`       | 读状态文件 → 档位解析 → **终值白名单**（与宿主名单取交集；标准档 = 宿主名单本身）。创建期与 `/reload` 共用（原 `bootstrap/src/fork/tool-modes.ts` 已由本端口取代，见 reload-command） |
| `packages/services/src/fork/toolModes.ts`                             | 服务面 + 描述符（通道 `fork-tool-modes`）                                    |
| `packages/desktop/src/host/fork/tool-modes/{store,service,index}.ts`  | `tool-groups.json` 原子读写、`setMode` / `setInjectTools`、状态事件          |
| `packages/ui/src/fork/tool-modes/{useForkToolMode.ts,index.ts}`       | 设置栏目数据入口与公开出口                                                   |
| `packages/ui/src/fork/tool-modes/{modeCopy.ts,ToolGroupsSection.tsx}` | 卡片文案键（纯数据，可测）+ 三张档位卡片                                     |

## 2. 关键改动

- **档位 → 白名单 → 单点生效**：`runtimeConfig.toolAllowlist` 的消费点是 `runtime-tools.ts` 的 `resolveBuiltInToolAllowlist`，它同时喂给 MCP 注册（`runtime/methods/mcp.ts`）。所以不需要动 `mcpServers`，MCP 工具自然随档位收敛。
- **标准档 = 不下发**（`undefined`）→ 不加任何约束 = 改动前行为；**关闭注入 = 空数组** → 一条工具都不注册（仓库既有语义，`tools: "none"` 即此）。
- **与宿主下发的既有名单取交集**：档位只让工具面更小，永不变大（CUA 等会话会带自己的白名单）。
- **分类完整性由测试盯住**：`core/test/forkToolModeTools.test.ts` 断言每个注册表工具恰好归类一次——上游新增（未归类）或改名/下架（残留名）都会变红，逼一次显式归类。取代了原先「@zcode/shared 存一份名单 + 一致性对齐」的镜像做法。
- **档位全集来自 `FORK_TOOL_MODES`**（`@zcode/shared` 的运行时数组）：契约的 `isForkToolMode`、UI 的卡片顺序都读它，卡片顺序 = 数组顺序（能力递增）。增删档位只需要动这一处类型与数组，UI 的卡片列表不需要跟着改。
- **档位选择器是三张卡片**（不是下拉框）：三档是包含关系，并列的卡片才能同屏比较工具面；卡片点击即生效，当前档位带选中标记，关闭「注入工具」时整体禁用。选中态复用仓库既有的可选中卡片语言（`border-foreground/60` + `bg-card-selected` + 小圆点对勾）。
- **卡片不套 `SettingsGroupCard`**：组卡是「设置行」的容器（行间靠 `border-t` 分隔），卡片是并列可选项；两层卡面叠起来后选中态底色与组卡底色分不清层级（见 DESIGN.md 的 Cards and Panels）。
- **卡片文案是分组名，不是工具名**：卡片只写「文件读写、代码搜索、命令执行、联网访问」这类分组概述，逐工具清单仍在 core（渲染层 import 不到）。分组名与 `mode-tools.ts` 的分类同源，改名时两边一起看。文案齐备性由 `ui/test/forkToolGroupsSection.test.ts` 按 `FORK_TOOL_MODES` 逐个断言。

## 3. 上游接线点

| 文件                                                                                                           | 改动                                                          |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `apps/zcode-cli/packages/core/src/index.ts`                                                                    | 导出 `./fork/tool-modes/index.js`                             |
| `apps/zcode-cli/packages/bootstrap/src/app/create-app.ts`                                                      | runtimeConfig 装配后经 core 的档位端口解析并记 info 日志；端口注入 runtime deps 供 `/reload` 复用 |
| `packages/services/src/{index,accessor}.ts`                                                                    | 服务面导出与访问器字段                                        |
| `packages/client/src/remoteServiceAccess.ts`                                                                   | manifest-gated 服务 + key 登记                                |
| `packages/desktop/src/host/index.ts`                                                                           | 注册服务（状态文件与身份配置同级）                            |
| `packages/desktop/src/host/fork/webdav-sync/manifest.ts`                                                       | 同步清单加一行 `tool-groups.json`                             |
| `packages/ui/src/lib/settingsNavigation.ts`、`settings/settingsPageConfig.ts`、`SettingsPage.tsx`、两个 locale | 栏目接线与文案                                                |
| `packages/shared/src/test-ids.ts`                                                                              | 开关 test-id + 档位卡片 test-id 基名（按下标生成）            |

## 4. 验证记录

- 契约 4 条（含「档位全集与判定函数同源」）、分类完整性 2 条、bootstrap 解析 5 条、UI 文案契约 3 条、WebDAV 40 条 → 合计 **54 通过**；`pnpm test:unit` 全量 8 组 261 条全绿。
- `pnpm --filter @zcode/core build`、根 `pnpm typecheck`、CLI 侧 typecheck 27/27、oxlint 通过。
- **界面已在运行中的 dev 实例里确认**（Vite HMR + CDP，端口 9229）：三张卡片按「极简 → 基础 → 标准」排列，标准档带选中标记；点「极简」后选中标记移动且 `tool-groups.json` 的 `mode` 落盘为 `minimal`；关「注入工具」后三张卡片 `disabled`（opacity 0.6 / cursor not-allowed）且脚注切到「已关闭工具注入，档位不生效」。验证后已把 `tool-groups.json` 还原为验证前的字节。
- 未验证：暗色主题下的观感（要改用户当前主题，未动）；打包产物未验证。

**选中信号**：`bg-card-selected` 在浅色主题下与 `bg-card` 同为白色（实测两者 `rgb(255,255,255)`），选中态主要由深色描边（`border-foreground/60`）与实心对勾承载。改配色时别把这两样一起去掉。

## 5. 与设计的偏差

1. **工具名清单落在 core 而不是 `@zcode/shared`**：架构复查结论——工具名的权威来源是注册表，抄一份到 shared 是跨包镜像；改为 core 侧分类 + 完整性断言测试。
2. **界面不展示逐工具清单**：渲染层 import 不到 core，这是上一条的代价；改为「档位卡片 + 分组名概述」。卡片给出的分组名与 `mode-tools.ts` 的分类同源，但两者不是同一份数据（前者是文案，后者是工具名），改分类时文案要人看一眼。
3. **denylist → allowlist**：评审指出 denylist 下 MCP 会漏出控制（既漏进极简/基础，也逃过「注入工具」总开关），且极简/基础的工具集本就已知固定。

## 6. 已知边界

- **子代理不继承档位**：已确认 `runtime/methods/subagent.ts` 给子运行时算的是它自己的 `childToolAllowlist`，不取父配置名单。极简档下 `Agent` 工具本身就不在名单里，因此无子代理；基础档下拉起的子代理仍持有其档案定义的工具面。要穿透需在子运行时配置里与父名单求交集（未做）。
- 只对新会话生效（工具面在创建期冻结）。
