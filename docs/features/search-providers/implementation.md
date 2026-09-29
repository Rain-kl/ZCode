# 网络搜索渠道 (search-providers) 实现记录

> 本文档记录 `search-providers` 二开特性的完整落地位置、关键改动、上游接线点与标记清单、Tavily 厂商契约、跨平台路径规范、验证记录与已知边界。
> 设计方案与架构裁决见 [design.md](./design.md)。
> 实施计划与任务账本见 [plan.md](./plan.md) 与 `.superpowers/sdd/plan/progress.md`。

---

## 1. 落地位置与职责划分

本特性遵循二开规范优先级：**共享契约在 `@zcode/shared`，服务接口在 `@zcode/services`，桌面 Host 实现在 `packages/desktop/src/host/fork/`，渲染层在 `packages/ui/src/fork/`，CLI 运行逻辑在 `apps/zcode-cli/packages/core/src/fork/`**。所有新增文件均自成边界；消费者直接按需精准引用具体模块文件（如 `channels.js`、`router.js`），不设多余聚合 index。

### 1.1 模块与文件清单（新增文件，无需上游标记）

| 文件路径 | 所属包 | 核心职责 |
| --- | --- | --- |
| `packages/shared/src/fork/search-providers-contract.ts` | `@zcode/shared` | 渠道配置格式定义（`ForkSearchProviderChannel`, `ForkSearchProvidersFile`）、协议通道常量 `FORK_SEARCH_PROVIDERS_CHANNEL`、版本常量 `FORK_SEARCH_PROVIDERS_FILE_VERSION`（当前为 1）、空文件冻结单例 `EMPTY_FORK_SEARCH_PROVIDERS_FILE`、容错解析函数 `parseForkSearchProvidersFile` 与统一路径生成器 `resolveForkSearchProvidersFilePath`。 |
| `packages/services/src/fork/search-providers.ts` | `@zcode/services` | Host 与 UI 间 RPC 服务抽象接口 `IForkSearchProvidersService`，定义 `list`、`addChannel`、`updateChannel`、`removeChannel`、`reorder` 5 个核心管理方法。 |
| `packages/desktop/src/host/fork/search-providers/file-store.ts` | `@zcode/desktop` | Host 侧渠道文件存储引擎。基于文件锁（`fork-search-providers.lock`）与临时文件重命名（atomic write）实现安全写入；写操作权限收紧为 `0o600`（明文 API Key 防同机非特权读取）；内存队列串行化并发请求，消除读-改-写竞态。 |
| `packages/desktop/src/host/fork/search-providers/service.ts` | `@zcode/desktop` | 实现 `IForkSearchProvidersService`，对外暴露基于 `ForkSearchProvidersFileStore` 的高层渠道管理接口。 |
| `packages/desktop/src/host/fork/search-providers/index.ts` | `@zcode/desktop` | Host 搜索渠道模块公开入口，导出工厂方法 `createForkSearchProvidersService`。 |
| `packages/ui/src/fork/search-providers/useForkSearchProviders.ts` | `@zcode/ui` | 设置页专用 React Hook，通过 `remoteServiceAccess.forkSearchProvidersService` 订阅和操作渠道表，维护 `channels`、`busy`、`error` 状态并封装增删改排操作。 |
| `packages/ui/src/fork/search-providers/SearchProvidersSection.tsx` | `@zcode/ui` | 设置页「搜索」栏目主视图（拆分至 ≤400 行），负责展示只读服务端搜索首行、装配渠道列表与说明文案、调度弹窗。 |
| `packages/ui/src/fork/search-providers/ChannelList.tsx` | `@zcode/ui` | 基于 `@dnd-kit` 的可拖拽排序列表与单渠道卡片（支持拖拽把手、启用开关、Key 掩码、编辑/删除操作触发）。 |
| `packages/ui/src/fork/search-providers/ChannelDialogs.tsx` | `@zcode/ui` | 添加与编辑渠道弹窗表单组件，包含渠道类型选择（当前固定 Tavily）、标签输入、基于 `ApiKeyInput` 的密钥掩码输入及表单验证。 |
| `apps/zcode-cli/packages/core/src/fork/search-providers/channel.ts` | `@zcode/core` | 搜索渠道抽象契约。定义 `SearchChannelRequest`（并集入参）、`SearchChannelFailure`（结构化失败信息）、`SearchChannel` 接口与 `SearchChannelOutcome`（包含命中渠道与此前失败记录）。 |
| `apps/zcode-cli/packages/core/src/fork/search-providers/router.ts` | `@zcode/core` | 渠道路由器 `runSearchChannels`。自上而下按序执行渠道链，首个成功即返回；聚合前置渠道失败详情；全渠道耗尽时抛出 `SearchChannelsExhaustedError`；检测 `signal` 中断立即退出且不降级。 |
| `apps/zcode-cli/packages/core/src/fork/search-providers/tavily.ts` | `@zcode/core` | Tavily 外部搜索渠道适配器 `createTavilyChannel`。封装请求体映射（入参黑白名单转换、`max_results` 映射与钳制）、`Authorization: Bearer <key>` 鉴权头注入、通过 `context.httpClientPort` 出网（继承用户代理且不设 public 限制）、HTTP 状态码分类（400/401/422/429/432/433/500）与多形态 `detail` 解析。 |
| `apps/zcode-cli/packages/core/src/fork/search-providers/channels.ts` | `@zcode/core` | 渠道加载器与链组装器。`loadForkSearchChannels` 负责读取配置文件并基于 `mtime` 内存缓存；`createServerSearchChannel` 包装原生服务端搜索；`buildSearchChannelChain` 按顺序组装「服务端搜索 + 用户 Tavily 渠道」；`countAvailableSearchChannels` 供暴露门高效判定可用渠道总数。 |

### 1.2 单元与契约测试文件

| 测试文件 | 覆盖范围与断言意图 |
| --- | --- |
| `packages/shared/test/forkSearchProvidersContract.test.ts` | 契约测试：解析保留合法字段、`enabled` 缺省为 `true`、未知与非数字版本安全降级并留痕、坏条目剔除好条目保留、敏感 Key 不进入问题日志、空 Key 允许、路径唯一生成规则。 |
| `apps/zcode-cli/packages/core/test/forkSearchProvidersRouter.test.ts` | 路由器单测：按序执行、首个成功终止、全失败聚合抛出 `SearchChannelsExhaustedError`、中断信号优先响应（不走降级、不调后续渠道）。 |
| `apps/zcode-cli/packages/core/test/forkSearchProvidersTavily.test.ts` | 契约与适配单测：请求体 JSON 结构、`Bearer` 鉴权头、域名黑白名单映射、`max_results` 钳制在 20、出网策略无 public 限制、错误分类与 3 种 `detail` 形状解析。 |
| `apps/zcode-cli/packages/core/test/forkSearchProvidersChannels.test.ts` | 渠道装配单测：配置读取与 `mtime` 缓存更新、外部渠道过滤禁用项、服务端渠道置于首位、多渠道链顺序契约。 |
| `apps/zcode-cli/packages/core/test/forkSearchProvidersExposure.test.ts` | 暴露门单测：渠道数为 0 时不暴露 `WebSearch`；服务端或 Tavily 任意存在时暴露；无 model 枚举不过滤；生产形态不传 options 安全降级。 |
| `apps/zcode-cli/packages/core/test/forkSearchProvidersHandler.test.ts` | 工具处理器单测：原生搜索封装、参数过滤（服务端忽略 `max_results`、Tavily 忽略 `maxUses`）、降级控制台留痕（`console.warn`）、输出 schema 包含 `channel` 字段。 |
| `packages/desktop/test/forkSearchProvidersFileStore.test.ts` | 存储引擎单测：配置初始化读写、文件锁互斥、写操作并发串行化、文件权限收紧到 `0o600`、增删改排操作落盘正确性。 |
| `packages/desktop/test/forkSearchProvidersSyncEntry.test.ts` | WebDAV 同步契约：Manifest 包含 `cli-fork/settings.json`、`cliConfigDir` base 变体正确解析为 `homedir + nativeConfigDir`、跨平台路径比对归一化契约断言。 |
| `packages/ui/test/forkSearchProvidersSection.test.ts` | UI 栏目单测：`searchProviders` 在 `basics` 组成功注册且可导航、中英文双语 23 个 i18n 键名完全对齐、无活动模型时安全降级、组件及 hook 规范导出。 |

---

## 2. 关键改动

### 2.1 渠道模型与两段式设计
网络搜索工具对外保持单一的 `WebSearch` 接口与 schema，对内抽象为有序渠道链：
- **第 0 渠道（服务端搜索）**：由当前活动模型的 `model.properties.supportsNativeWebSearch === true` 决定其存在性。此渠道只读，不可在搜索设置页中拖拽或禁用（优先级固定第一）。
- **第 1..N 渠道（用户外部渠道）**：用户在设置页中添加的 Tavily 渠道（未来可扩充其他 Provider）。可按需启用、禁用、拖拽排序、修改 Label 与 API Key。

### 2.2 路由执行、失败降级与中断保障
路由核心 `runSearchChannels` 采用自上而下的瀑布流尝试机制：
- 只要某一渠道执行成功，立即包装 `SearchChannelOutcome` 返回（包含实际命中的渠道名及此前所有失败尝试信息），不再调度后续渠道，避免浪费额度。
- 若某一渠道抛错（包括网络异常、鉴权失败 401、配额耗尽 429/433、校验错误 400/422 等），错误被捕获并记入 `attempts` 数组，触发降级尝试下一渠道。
- 若所有渠道均执行失败，抛出携带逐项渠道名称与失败原因的结构化 `SearchChannelsExhaustedError`，严禁掩盖错误。
- **中断保护**：若 `signal.aborted` 为真，或调用过程中被取消，立即抛出中断异常，绝不将其作为普通渠道失败而继续降级到后续付费渠道。

### 2.3 暴露门判据改造（渠道数判据）
`apps/zcode-cli/packages/core/src/runtime/methods/config.ts` 中的 `shouldExposeWebSearch` 判据彻底重构：
- 原逻辑：仅判定 `model?.properties.supportsNativeWebSearch`。导致在 OpenAI 兼容模型下，`WebSearch` 对模型完全不可见。
- 新逻辑：判定 `countAvailableSearchChannels(...) > 0`。
  - 模型支持原生搜索时，渠道数 ≥ 1（暴露）；
  - 模型不支持原生搜索但用户配置了至少 1 条启用的 Tavily 渠道时，渠道数 ≥ 1（解锁非原生模型的搜索能力）；
  - 模型不支持且未配置任何外部渠道时，渠道数 = 0（工具不暴露，与改动前完全一致，回归保护）；
  - `model` 为空时（注册表枚举供元数据或持久化），保持不过滤。

### 2.4 处理器接线与元数据留痕
`apps/zcode-cli/packages/core/src/tool/handlers/websearch.ts` 改造上游处理器：
- 将原本的上游原生执行代码提取并包装为 `createServerSearchChannel`，不搬离上游文件，保持最小 diff。
- 组装渠道链并调用 `runSearchChannels`。
- 若发生渠道降级，通过 `console.warn` 打印 `[search-providers] ... failed, fell through: ...` 留存审计线索。
- 最终输出结果附加 `channel: { kind, label }` 字段（在 contracts schema 中声明为可选），既便于排查命中渠道，又因模型格式化函数不消费该字段而不改变模型上下文。

### 2.5 Host 文件存储与权限保护
`packages/desktop/src/host/fork/search-providers/file-store.ts` 实现安全的单点写入者：
- 配置落盘至 `<homedir>/.zcode/cli/fork/settings.json`。
- 采用 `.lock` 排他文件锁防并发进程冲突。
- 写入时使用同一目录下的临时文件写入并原子 `renameSync` 替换，防止断电或进程中断产生半损坏文件。
- 文件权限明确指定 `{ mode: 0o600 }`，确保包含 API Key 的敏感明文配置文件仅当前操作系统用户可读写。
- 内部采用 Promise 链式 `enqueue` 串行化，彻底消除多窗口或高频操作下的读-改-写竞态。

### 2.6 WebDAV 清单扩展与路径解析
- 在 `packages/desktop/src/host/fork/webdav-sync/manifest.ts` 的清单中追加：
  ```ts
  {
    archiveName: "cli-fork/settings.json",
    source: { type: "file-json", base: "cliConfigDir", path: "fork/settings.json" },
  }
  ```
- 在 `packages/desktop/src/host/index.ts` 的 `resolveBase` 中增加 `cliConfigDir` 分支，严格使用 `join(homedir(), nativeConfigDir)` 进行解析，确保与 CLI 侧配置文件路径绝对同源。

### 2.7 设置页「搜索」栏目交互
`packages/ui/src/fork/search-providers/` 提供全套 UI 支持：
- 归属于「基础设置（basics）」分组，排在模型提供商附近。
- 顶部呈现只读「服务端搜索（由模型配置决定）」状态行，当前模型支持状态直接从活动模型推导，无活动模型时安全降级。
- 渠道卡片支持使用 `@dnd-kit` 拖拽把手上下调整优先级。
- 提供启用/禁用开关、API Key 掩码及显示/隐藏切换、行内编辑与删除确认弹窗。
- 添加/编辑弹窗对 Label、Key 必填项做即时校验，并在文案中明确提示密钥明文存储及 WebDAV 同步特性。

---

## 3. 上游接线点与标记清单

本项目对上游代码的所有修改均严格遵守成对与单点标记规范。通过以下**可复现检索命令**生成当前清单：

```bash
rg -n "FORK\(search-providers\)|FORK-BEGIN\(search-providers\)|FORK-END\(search-providers\)" \
  --glob '!AGENTS.md' --glob '!FEATURES.md' --glob '!docs/**' --glob '!.superpowers/**'
```

### 3.1 统计口径说明
1. **口径 1：匹配行数（Token 行数）**：
   按上述 `rg` 命令直接输出的匹配行数统计。实测命中 **14 个上游文件，共 36 行标记**。
2. **口径 2：逻辑改动处（修改点数）**：
   单点标记计为 1 处，成对标记块（`FORK-BEGIN` 与 `FORK-END` 成对包围的代码块）计为 1 处。实测共计 **14 个上游文件，共 32 处改动点**（包含 28 处单点标记与 4 对成对块：`websearch.ts` 3 对，`config.ts` 1 对）。

> 注：此前 `packages/desktop/src/host/fork/search-providers/service.ts:27` 与 `packages/ui/src/fork/search-providers/SearchProvidersSection.tsx:1` 中的 2 处 `FORK` 标记位于 fork 专属自有目录下，按 AGENTS.md 规范（新增文件无需标记）已于本轮修复中移除 token，保留中文说明。

### 3.2 逐文件清单与标记位置

| 文件路径 | 改动位置与形式 | 统计 (处 / 行) | 为什么必须改上游 / 标记内容 |
| --- | --- | --- | --- |
| `apps/zcode-cli/packages/contracts/src/tools/websearch.ts` | 行 23 (`FORK`)<br>行 119 (`FORK`) | 2 处 / 2 行 | `WebSearchProviderInputSchema` 新增可选参数 `max_results`；`WebSearchOutputSchema` 新增可选字段 `channel`。 |
| `apps/zcode-cli/packages/core/src/runtime/methods/config.ts` | 行 39 (`FORK`)<br>行 271 (`FORK`)<br>行 277–282 (`FORK-BEGIN/END`) | 3 处 / 4 行 | 导入 `countAvailableSearchChannels`；导出 `shouldExposeWebSearch`；暴露门实现从模型能力硬判改为可用渠道数 `countAvailableSearchChannels(...) > 0`（含 1 对成对块）。 |
| `apps/zcode-cli/packages/core/src/tool/handlers/websearch.ts` | 行 28–36 (`FORK-BEGIN/END`)<br>行 38 (`FORK`)<br>行 59–70 (`FORK-BEGIN/END`)<br>行 72–185 (`FORK-BEGIN/END`) | 4 处 / 7 行 | 引入渠道链与路由依赖（**注：上游行 24 的原有 import 保持绝对零 diff**）；导出 `WEBSEARCH_TOOL_NAME`；导出 `buildWebSearchProviderDescription` 并去除 `US-only`；处理器主体接入渠道链与降级留痕（含 3 对成对块）。 |
| `packages/client/src/remoteServiceAccess.ts` | 行 4 (`FORK`)<br>行 51 (`FORK`)<br>行 107 (`FORK`)<br>行 237 (`FORK`) | 4 处 / 4 行 | 导入服务通道常量 `FORK_SEARCH_PROVIDERS_CHANNEL`；注册服务映射；添加客户端访问器接口属性与代理装配。 |
| `packages/desktop/src/host/index.ts` | 行 52 (`FORK`)<br>行 82 (`FORK`)<br>行 84 (`FORK`)<br>行 2921 (`FORK`)<br>行 2952 (`FORK`) | 5 处 / 5 行 | 导入服务接口、工厂与运行时常量；`resolveBase` 中增加 `cliConfigDir` 分支；桌面 host 初始化中注册 `IForkSearchProvidersService` 实例。 |
| `packages/services/src/accessor.ts` | 行 94 (`FORK`) | 1 处 / 1 行 | `IServiceAccessor` 接口声明可选属性 `forkSearchProvidersService?: IForkSearchProvidersService`。 |
| `packages/services/src/index.ts` | 行 34 (`FORK`) | 1 处 / 1 行 | 公开导出 `fork/search-providers.js` 服务接口类型。 |
| `packages/shared/src/index.ts` | 行 246 (`FORK`) | 1 处 / 1 行 | 公开导出 `fork/search-providers-contract.js` 契约及工具函数。 |
| `packages/ui/src/SettingsPage.tsx` | 行 74 (`FORK`)<br>行 1934 (`FORK`) | 2 处 / 2 行 | 导入 `SearchProvidersSection` 组件；`activeSection === "searchProviders"` 分支渲染该栏目。 |
| `packages/ui/src/i18n/locales/en-US.ts` | 行 2203 (`FORK`) | 1 处 / 1 行 | 注册 `settings.searchProviders.*` 双语翻译（美式英文，23 个键）。 |
| `packages/ui/src/i18n/locales/zh-CN.ts` | 行 2070 (`FORK`) | 1 处 / 1 行 | 注册 `settings.searchProviders.*` 双语翻译（简体中文，23 个键）。 |
| `packages/ui/src/lib/settingsNavigation.ts` | 行 27 (`FORK`)<br>行 67 (`FORK`)<br>行 92 (`FORK`) | 3 处 / 3 行 | `SettingsSectionId` 联合类型追加 `"searchProviders"`；导出 `isSettingsSectionId` 类型守卫；守卫中包含 `searchProviders` 分支。 |
| `packages/ui/src/settings/model-provider-section/ApiKeyInput.tsx` | 行 12 (`FORK`)<br>行 24 (`FORK`) | 2 处 / 2 行 | 支持外部自定义 `placeholder` 传入（参数解构与 Props 接口定义，Task 9 修复轮新增）。 |
| `packages/ui/src/settings/settingsPageConfig.ts` | 行 24 (`FORK`)<br>行 88 (`FORK`) | 2 处 / 2 行 | 导入 `Search` 图标；`BASE_SETTINGS_SECTIONS` 中注册 `searchProviders` 栏目。 |
| **合计** | **14 个上游文件** | **32 处改动点** | **36 行标记（含 28 处单点标记与 4 对成对块）** |

---

## 4. Tavily 厂商契约与线上实测记录

> 数据取数日期：**2026-09-29**。
> 来源：**Tavily 官方 OpenAPI 规范** + **线上实际端点发包实测验证**。

### 4.1 端点与鉴权
- **端点**：`POST https://api.tavily.com/search`
- **鉴权方式**：HTTP Header `Authorization: Bearer <API_KEY>`。**注意：`Bearer` 必须大写，区分大小写**。

### 4.2 请求字段与参数限制
- `query`：必填，字符串，不能为空。
- `max_results`：
  - 官方文档标称默认值 10，标称允许范围 0–20。
  - **重要实测事实**：**Tavily 服务端在实际运行时并未强制 20 的硬性上限**（向线上端点请求 25 条时，服务端正常返回了 25 条）。我们在 ZCode 的入参契约中设定 `.max(20)` 是**产品层面的安全钳制**，意在防止模型失控索取超大结果集导致 context 膨胀和费用浪费，而非替厂商做语法兜底。
- `include_domains`：数组，最大允许 300 个域名。
- `exclude_domains`：数组，最大允许 150 个域名。
- `search_depth`：可选 `"basic"` 或 `"advanced"`（当前适配器固定使用 `"basic"` 满足即时搜索）。

### 4.3 错误码与响应体形态分类
Tavily 错误响应状态码及对应的含义分类如下：
- `400 Bad Request`：请求体格式不合法或必填字段缺失。
- `401 Unauthorized`：API Key 缺失、格式无效或已被吊销。
- `422 Unprocessable Entity`：参数校验失败（如字段类型不符合 FastAPI 规范）。
- `429 Too Many Requests`：超出并发或每分钟请求频率限制。
- `432 Request Header Fields Too Large / Custom Quota`：自定义配额超限。
- `433 Plan Limit Exceeded`：账户当月总调用额度已耗尽。
- `500 Internal Server Error`：Tavily 后端服务器异常。

**响应体 `detail` 的三种形状**：
线上返回的 JSON 体中，错误原因由 `detail` 字段表达，实测存在三种形态，适配器完整支持解析：
1. **字符串形态**：`{ "detail": "Invalid API key" }`
2. **字典对象形态**：`{ "detail": { "error": "Insufficient credits", "code": 433 } }`
3. **校验错误列表形态（FastAPI）**：`{ "detail": [{ "loc": ["body", "query"], "msg": "field required", "type": "value_error.missing" }] }`

### 4.4 请求校验先于鉴权的重要特性
线上实测发现，当使用一个完全无效的 API Key（如 `"invalid-key"`），但请求体缺失 `query` 时，Tavily 服务端**优先执行请求参数校验并返回 400/422，而不是返回 401**。这证实了其网关架构是先做 Schema 验证再做鉴权校验。因此适配器在分类异常时，必须精准提取错误明细，不能盲目假定 Key 错误一定体现为 401。

---

## 5. 跨平台路径契约细节

在 Task 8 实施与评审中，确认并固化了一处关键的路径契约细节：

1. **浏览器/通用端路径拼接**：
   `packages/shared/src/fork/search-providers-contract.ts` 中的 `resolveForkSearchProvidersFilePath(homeDir)` 故意采用：
   ```ts
   [homeDir, ".zcode/cli", "fork/settings.json"].join("/")
   ```
   **原因**：该函数需要在 Renderer 进程及 UI 共享层执行，必须避免引入 Node.js 专属的 `node:path` 模块，以保证轻量与浏览器环境兼容。
2. **Host 侧路径拼接**：
   Host 进程中的 `resolveBase` 处理 `cliConfigDir` 时，使用的是 Node 的 `path.join(homedir(), nativeConfigDir)`，在 Windows 操作系统下会生成带反斜杠 `\` 的路径。
3. **物理同源性与比对约束**：
   在 Windows 上，POSIX 正斜杠 `/` 与 Windows 反斜杠 `\` 在传递给 Node.js `fs` API 时被等价解析，两侧操作的是**同一个文件**。
   **契约要求**：任何跨模块、跨环境对两侧路径进行相等性测试或逻辑比对时，**严禁使用简单的字符串全等（`===`）**，必须先通过 `node:path.resolve`（或做跨平台归一化）消除斜杠差异。此规则已固化在 `forkSearchProvidersSyncEntry.test.ts` 中。

---

## 6. 验收场景执行记录

对照设计文档 §12 的 14 项验收场景逐项复核：

| 场景编号 | 场景描述 | 覆盖方式与验证结论 | 状态 |
| --- | --- | --- | --- |
| 1 | 模型支持服务端搜索、无 Tavily 渠道 → 工具暴露；调用走服务端；行为与今天一致 | 单测覆盖：`forkSearchProvidersExposure.test.ts` 断言暴露，`forkSearchProvidersHandler.test.ts` 模拟执行走服务端搜索。 | PASS |
| 2 | 模型不支持服务端搜索、无 Tavily 渠道 → 工具不暴露（回归保护） | 单测覆盖：`forkSearchProvidersExposure.test.ts` 覆盖 0 渠道模型不可见断言。 | PASS |
| 3 | 模型不支持服务端搜索、配了一条启用中的 Tavily → 工具暴露；调用走 Tavily；结果正常渲染 | 单测覆盖：`forkSearchProvidersExposure.test.ts` 断言暴露，`forkSearchProvidersHandler.test.ts` 驱动 Tavily 渠道成功产出。 | PASS |
| 4 | 模型支持服务端搜索、同时配了 Tavily → 先试服务端；服务端成功则 Tavily 不被调用 | 单测覆盖：`forkSearchProvidersHandler.test.ts` 断言首个渠道成功后，后续 Tavily 执行计数为 0。 | PASS |
| 5 | 服务端失败（含编码层不可用与运行时失败两种）+ Tavily 可用 → 自动降级成功；日志可查 | 单测覆盖：`forkSearchProvidersHandler.test.ts` 模拟服务端失败，Tavily 接替成功，并验证 `console.warn` 留痕输出。 | PASS |
| 6 | 多条 Tavily、第一条 key 无效 → 降级到第二条成功；失败原因保留在日志 | 单测覆盖：`forkSearchProvidersRouter.test.ts` 驱动多渠道瀑布流，断言 attempts 保留首个失败明细并返回第二条结果。 | PASS |
| 7 | 全部渠道失败 → 模型收到结构化失败，逐条列出渠道与原因；没有 WebSearchOutput | 单测覆盖：`forkSearchProvidersRouter.test.ts` 与 `forkSearchProvidersHandler.test.ts` 断言抛出 `SearchChannelsExhaustedError`，无正常输出。 | PASS |
| 8 | 渠道数从 1 变为 0（禁用唯一渠道）→ 下一次工具调用中工具不再暴露 | 单测覆盖：`forkSearchProvidersExposure.test.ts` 验证渠道配置变更后，暴露门求值立即转为 `false`。 | PASS |
| 9 | 渠道文件损坏 → 应用正常启动、日志有 warn、Tavily 渠道按 0 条处理 | 单测覆盖：`forkSearchProvidersContract.test.ts` 与 `forkSearchProvidersChannels.test.ts` 覆盖容错降级与问题汇总。 | PASS |
| 10 | 代理已配置的用户调用 Tavily → 正常出网，不出现 `egress_blocked` | 单测覆盖：`forkSearchProvidersTavily.test.ts` 断言请求对象未附加 `egressPolicy: "public"` 限制。 | PASS |
| 11 | 模型传 `max_results` 给服务端 / 传 `maxUses` 给 Tavily → 不报错，按忽略处理 | 单测覆盖：`forkSearchProvidersTavily.test.ts` 与 `forkSearchProvidersHandler.test.ts` 验证各渠道参数提取与忽略机制。 | PASS |
| 12 | 桌面隔离 home 运行时：设置页写入的路径与 CLI 读取的路径是同一个文件 | 契约单测覆盖：`forkSearchProvidersSyncEntry.test.ts` 断言两侧解析出的路径归一化后一致。 | PASS（单测）/ 待集成实测 |
| 13 | WebDAV 备份 → 远端包含 `cli-fork/settings.json`；恢复到干净环境后渠道表一致 | 契约单测覆盖：`forkSearchProvidersSyncEntry.test.ts` 验证 Manifest 条目声明与路径解析；端到端网络同步待手工验收。 | PASS（契约）/ 待集成实测 |
| 14 | 设置页拖拽排序 → 下一次调用按新顺序尝试 | 单测覆盖：`forkSearchProvidersFileStore.test.ts` 验证重排落盘，`forkSearchProvidersChannels.test.ts` 验证按序加载。 | PASS（单测）/ 待交互实测 |

---

## 7. 未验证项与验证方法

本特性已完成所有单元测试、契约测试、静态检查与架构校验，以下项目涉及真实外部网络、桌面打包分发环境或具体操作系统，列为未验证项及建议的验证方法：

1. **真实打包产物内的真实 Tavily API 调用**：
   - *未验证原因*：本地 CI 与开发阶段单测使用 Mock，不消耗真实 API Token，且不依赖外部公网连通性。
   - *验证方法*：运行 `pnpm dev:desktop` 或打包桌面产物，进入设置页「搜索」栏目添加一条真实的 Tavily API Key 并启用；切换至不支持原生搜索的 OpenAI 兼容模型，发起问题「搜索今天的科技头条」，核对模型是否成功调用 `WebSearch` 并输出真实搜索摘要。
2. **WebDAV 真实备份包往返恢复**：
   - *未验证原因*：需要配置有效 WebDAV 远端服务器凭据。
   - *验证方法*：在桌面端设置页「同步」栏目连接真实 WebDAV 服务器，触发「立即备份」；解压 WebDAV 远端生成的 zip 归档，检查其中是否包含 `cli-fork/settings.json` 且内容格式符合预期；在全新设备或清空本地配置后执行「恢复」，验证搜索渠道表无损还原。
3. **桌面隔离 home（`ZCODE_DESKTOP_HOME_DIR`）环境下的端到端一致性实测**：
   - *未验证原因*：该环境主要用于端到端自动化测试隔离环境。
   - *验证方法*：通过环境变量 `ZCODE_DESKTOP_HOME_DIR=/tmp/test-home` 启动桌面，进入设置页新增一条测试渠道，核查 `/tmp/test-home/.zcode/cli/fork/settings.json` 真实存在，并运行 CLI 进程观察读取路径日志。
4. **真实 Windows 平台文件锁与权限**：
   - *未验证原因*：当前开发机为 macOS (Darwin)。
   - *验证方法*：在 Windows 10/11 环境下拉取分支，执行 `pnpm test:unit`，重点验证 `forkSearchProvidersFileStore.test.ts` 中的文件重命名、并发锁释放及 0o600 mode 兼容性（Windows 下不支持 Unix 权限位，需确认无静默崩溃）。
5. **端到端无 options 的生产形态暴露门调用**：
   - *未验证原因*：单测为了环境隔离均传入了 `{ homeDir }` 参数。
   - *验证方法*：在运行中的 Agent 会话中检查 `runtime.getTools()`，验证生产代码不传 options 时自动回退至用户真实主目录下的配置文件。

---

## 8. 已知边界（Deferred Minors）

以下项目为实现过程中由 SDD 评审与实现者独立识别、经裁决明确延后的非阻塞项（已登记于进度账本 `.superpowers/sdd/plan/progress.md`），不影响本特性的功能正确性与稳定性：

1. **测试替身 `as never` 类型断言（2 处）**：
   - *位置*：`apps/zcode-cli/packages/core/test/forkSearchProvidersChannels.test.ts` 与 `forkSearchProvidersExposure.test.ts`。
   - *情况*：测试辅助函数 `modelWith` 中构造假模型对象时使用了 `as never`。此写法沿用自计划模板，未违背全局规范禁止 `as any` 的字面要求。裁决已明确要求后续不得扩散，统一改用 `as unknown as Model`。
2. **`channels.ts` 的 `statSync` 异常降级粒度**：
   - *位置*：`apps/zcode-cli/packages/core/src/fork/search-providers/channels.ts` 的缓存校验逻辑。
   - *情况*：`statSync` 的 `catch` 块目前将所有异常（包括 `EACCES` 权限拒绝、`EIO` 磁盘 IO 错误等）一并视为文件不存在（降级为空渠道表），未输出详细诊断日志，在排查文件权限配置错误时可能带来轻微困扰。
3. **`createServerSearchChannel` 缺乏独立细粒度单测**：
   - *情况*：该适配函数目前直接通过 `forkSearchProvidersHandler.test.ts` 的完整工具处理器进行集成测试，未单独为其编写独立单元测试。
4. **单测生成的临时目录未主动清理**：
   - *位置*：`forkSearchProvidersExposure.test.ts` 等测试。
   - *情况*：测试用例中使用 `fs.mkdtempSync` 创建的隔离临时目录在测试执行完毕后未通过 `afterEach` 清理，依赖操作系统定期的临时目录回收。
5. **Host 装配处 `join` 未抽取顶层常量**：
   - *位置*：`packages/desktop/src/host/index.ts` 第 2921 行。
   - *情况*：`cliConfigDir` 分支内联编写了 `join(homedir(), ZCODE_AGENT_RUNTIME.nativeConfigDir)`，未在当前文件顶层提取为命名常量 `forkCliConfigDir`，属纯代码风格对称性，不影响逻辑。
