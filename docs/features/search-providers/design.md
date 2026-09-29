# 网络搜索渠道（search-providers）

## 1. 背景与目标

`WebSearch` 今天只有一条实现路径：provider-native 服务端搜索。

- 工具处理器硬门：`apps/zcode-cli/packages/core/src/tool/handlers/websearch.ts:71` 要求 `model.properties.supportsNativeWebSearch` 为真，否则抛 `ConfigurationError`。
- 编码层只支持 anthropic：`apps/zcode-cli/packages/adapters/src/model/tool-transform.ts:245-278` 的 `toAiSdkProviderNativeTool` 只对 `providerKind === "anthropic"` 生成 `web_search`，其它协议类型抛 `InvalidModelRequest`。
- 暴露门：`apps/zcode-cli/packages/core/src/runtime/methods/config.ts:141` 用 `shouldExposeWebSearch`（同文件 `:268`）把不支持服务端搜索的模型的 `WebSearch` 整个过滤掉。

后果：在 openai-compatible 通道上（`supportsNativeWebSearch` 永远为假），`WebSearch` 对模型**根本不存在**，模型没有可用的搜索工具，只能猜 URL 交给 `WebFetch`。

目标：把「搜索后端」变成一条**可替换的渠道链**。服务端搜索降级为链条里的第一条渠道（其存在性由模型能力决定），用户可以在设置里追加多条自带 key 的 Tavily 渠道；模型侧仍然只看见一个 `WebSearch` 工具，由工具内部按顺序尝试。

## 2. 非目标

- 不做渠道健康探测与自动摘除。第一版没有「测试连接」按钮，渠道可用性不依赖任何预检（见 §7）。
- 不实现 Tavily 之外的第三方渠道。渠道「类型」这个维度保留，但只落一个实现。
- 不给独立 CLI 提供配置入口。独立 CLI 只读渠道文件（见 §6）。
- 不改 `AppSettings` / `setting.json`。渠道数据是 fork 自有文件，不进 host 设置文件。
- 不追溯变更。降级链一旦开始，中途改动渠道表不影响本次调用（见 §5.4）。
- 不改 `WebSearch` 的对外名字与能力声明，模型侧不需要知道渠道的存在。

## 3. 状态所有者

| 状态 | 唯一所有者 | 读者 |
| --- | --- | --- |
| Tavily 渠道表（类型/备注/key/启用/顺序） | 桌面 host 的设置页服务 `IForkSearchProvidersService` | CLI 侧渠道加载器；WebDAV 同步 |
| 渠道文件路径 | 共享常量 `ZCODE_AGENT_RUNTIME.nativeConfigDir`（`packages/shared/src/zcode-agent-runtime.ts:32`）+ `homedir()` | host 服务、CLI 加载器 |
| 「服务端搜索」渠道的存在性 | 模型配置 `supportsNativeWebSearch`（`packages/shared/src/model-config.ts:76`） | 工具暴露门、路由 |
| 工具暴露与否 | `shouldExposeWebSearch`（`config.ts:268`），输入是「渠道数」 | 模型请求构造 |
| 一次调用的实际命中渠道 | 路由（§5.3），只写输出元数据与日志 | 日志与诊断 |

规则：**渠道文件只有一个写入者**（桌面设置页）。CLI 是纯读者；WebDAV 恢复是第二个写入点，但它写的是同一份文件的整体快照，与设置页共用同一把文件锁（§6.4）。

## 4. 总体结构

```
桌面设置页「搜索」
  └─ IForkSearchProvidersService（host，packages/desktop/src/host/fork/search-providers/）
        ├─ 读/写 <homedir>/.zcode/cli/fork/settings.json（原子写 + 文件锁）
        └─ WebDAV 同步清单新增一条 file-json 条目（§6.3）

CLI 进程（core）
  WebSearch 工具
    ├─ 渠道加载器（src/fork/search-providers/channels.ts）：读同一文件，mtime 缓存
    ├─ 路由（src/fork/search-providers/router.ts）：按序尝试、聚合失败
    └─ 渠道实现
         ├─ 服务端渠道：现有 provider-native 路径（保留在 websearch.ts，由路由调用）
         └─ Tavily 渠道：src/fork/search-providers/tavily.ts（经 context.httpClientPort 出网）
```

服务端渠道的实现**留在上游文件里**，路由通过注入的回调调用它。这样上游 `websearch.ts` 的改动不是「把 native 逻辑搬走」，而是「把 native 逻辑包成一个可被调用的单元」——搬迁会让同步面变大（见 §9）。

## 5. 渠道模型与路由

### 5.1 渠道表

渠道表是一个有序数组，逻辑上由两段拼成：

| 序号 | 渠道 | 存在条件 | 可编辑性 |
| --- | --- | --- | --- |
| 0 | 服务端搜索 | `model.properties.supportsNativeWebSearch === true` | 只读（在模型配置里改） |
| 1..n | Tavily #i | 用户在渠道文件里添加且未禁用 | 拖拽排序 / 启用开关 / 删除 / 改备注与 key |

```
渠道数 = (服务端渠道存在 ? 1 : 0) + 已启用 Tavily 渠道数
```

### 5.2 暴露规则

`shouldExposeWebSearch` 从「模型是否支持服务端搜索」改为「**渠道数 > 0**」：

- 渠道数 = 0 → 不暴露 `WebSearch`。这是「模型不支持服务端搜索且用户没配 Tavily」的情形，与今天的行为一致。
- 渠道数 ≥ 1 → 暴露。包含「模型不支持服务端搜索但配了 Tavily」——这正是本次要解锁的场景。

无 `model` 的调用（注册表枚举，供持久化与 UI 元数据用）保持今天的行为：不过滤。

### 5.3 路由

自上而下尝试，第一个**成功**的渠道产出结果，其后不再尝试：

```
for channel in [server?, tavily#1..n]:
    try: return await channel.search(request)
    catch error: failures.push({ channel, error }); continue
throw SearchChannelsExhausted(failures)
```

- 「失败」不区分静态与运行时：服务端渠道在编码层不可用（非 anthropic 但有 flag）、HTTP 错误、超时、鉴权失败、响应不合规，一律记为一次失败并进入下一渠道。这是需求方明确选择的语义。
- 渠道数 ≥ 1 但全部失败：抛结构化错误，见 §5.5。
- 出网：Tavily 渠道经 `context.httpClientPort`（`contracts/src/interfaces/http-client.port.ts`），因此自动继承用户的代理配置。**不设 `egressPolicy: "public"`**——`adapters/src/http/index.ts:272-281` 的 `assertPublicEgressProxyBoundary` 会因代理而抛 `egress_blocked`，而 Tavily 的目标域名是固定的，公共 DNS 校验没有意义。

### 5.4 生效时机

渠道加载器读一次文件 + 按 mtime 缓存。用户改完设置，**下一次工具调用**即生效，不需要新建会话，也不需要重启。

不追溯：一次工具调用开始后，渠道表在本轮调用内固定；改动影响下一次调用。

### 5.5 失败语义与留痕

- 全部失败：抛出携带**逐条尝试记录**的错误（渠道类型 + 渠道标签 + 该次失败的原因），不产出 `WebSearchOutput`。禁止把不同渠道的不同失败压成一条同一提示（AGENTS.md 代码规范 7）。
- 成功降级：`WebSearchOutput` 新增一个**可选** `channel` 字段记录实际命中的渠道，日志记录完整的尝试轨迹。该字段不进入模型可见文本——`formatWebSearchModelContent` 只消费 `query` / `summary` / `sources`，所以模型看到的措辞不受渠道影响。UI 渠道徽标不在本期范围（`renderers/search.tsx` 目前只渲染输入，不消费输出）。
- 日志与错误文本中**不得出现 key**；备注字段也不写进日志，只记渠道序号与类型。

## 6. 存储、路径与同步

### 6.1 路径

```
<homedir()>/.zcode/cli/fork/settings.json
```

### 6.2 为什么根是 CLI 配置目录，而不是 storage root

这是本设计里最容易埋雷的一处，理由必须写清：

- CLI 侧解析配置目录 = `join(homedir(), ".zcode/cli")`（`apps/zcode-cli/packages/adapters/src/config/file-config.adapter.ts:62` 的 `DEFAULT_BASE_DIR`，经同文件 `:67-72` 的 `resolvePath` 展开 `~`）。它**不读** `ZCODE_STORAGE_DIR`，不读 `ZCODE_DATA_BASE_DIR`，也不读 `ZCODE_DESKTOP_HOME_DIR`。
- host 侧如果走 `getZCodeDataRootDir()`（`packages/services/src/paths.ts:43`），根是 `getDataBaseDir()/.zcode`，而 `getDataBaseDir()` **读** `ZCODE_DATA_BASE_DIR`；`resolveZCodeStorageRoot()`（`packages/services/src/subagents/subagentStorage.ts:31-46`）又会去读 CLI config 的 `storage.dir`。
- 两侧在默认情况下都落在 `~/.zcode`，但在桌面用隔离 home 运行（`ZCODE_DESKTOP_HOME_DIR`，dev/e2e 就是这么跑的）、或 host 给 agent 下发 `ZCODE_DATA_BASE_DIR` 时就会分叉：**桌面写 A 文件、CLI 读 B 文件，两边都"成功"，功能静默不生效。**

CLI 配置目录是唯一一个两侧都无条件解析到同一处的根。`packages/desktop/src/host/index.ts:2932-2933` 已经为 identity-preset 记过同一条规则（「根目录必须是 storage root……两侧漂移的症状是『UI 看得见、agent 读不到』」）；这里取 CLI 配置目录而非 storage root，是因为 storage root 本身在两侧就不一致。

**约束**：host 侧解析该路径时用 `homedir()` + 共享常量 `ZCODE_AGENT_RUNTIME.nativeConfigDir`，**不得**经过 `getDataBaseDir()` / `getZCodeDataRootDir()` / `resolveUserHomeDir()`。

附带收益：`cli/fork/` 让 fork 数据完全避开上游对 `config.json` 的改键冲突，与仓库二开纪律同向。

### 6.3 文件格式

```jsonc
{
  "version": 1,
  "channels": [
    {
      "id": "<opaque>",          // 生成时写入，用于拖拽/删除的稳定标识
      "kind": "tavily",
      "label": "工作用",          // 备注，仅 UI 标签
      "enabled": true,
      "apiKey": "<secret>"
    }
  ]
}
```

- 文件缺失 → 等价于 0 条 Tavily 渠道（这是独立 CLI 从未配置过的正常状态）。
- 文件损坏 / 结构不合规 → **不**让宿主启动失败：按 0 条渠道处理并写一条含路径与解析原因的 warn 日志。理由：一个可选渠道的配置不该让整个应用起不来；但也不能悄悄吞掉，所以必须留日志。
- `version` 不认识的更高值 → 同上（按 0 条处理 + warn），为将来迁移留出安全默认。

### 6.4 写入

- 桌面 host 服务持有唯一的写入口：读整份 → 改 → 原子写 + 文件锁（与 `fork-webdav.lock` 同款做法）。
- WebDAV 恢复是第二个写入点，共用同一把锁；它是整体替换语义，不做字段级合并。
- key 以明文落在该文件里，并随备份包上传到用户的 WebDAV。这是需求方明确选择的方案（让渠道配置跟着配置同步走），设计上不再加第二套加密或凭据存储。

### 6.5 WebDAV 同步

`packages/desktop/src/host/fork/webdav-sync/manifest.ts` 是同步范围的唯一声明处，新增一条：

```ts
{
  archiveName: "cli-fork/settings.json",
  source: { type: "file-json", base: "cliConfigDir", path: "fork/settings.json" },
}
```

`ForkSyncBase` 需要新增 `cliConfigDir` 变体，并在 `packages/desktop/src/host/index.ts` 的 `resolveBase`（`:2912`）里按 §6.2 的规则解析。清单是 fork 自有文件，加变体不产生上游冲突；`resolveBase` 那一处在已有 `FORK(local-mode)` 标记块内。

## 7. 设置页「搜索」栏目

新增 `搜索` 节（id `searchProviders`），落在「基础设置」分组，排在「模型设置」附近。

**只读首行**：`服务端搜索（由模型配置决定）· 当前：已启用／未启用`。不可删除、不可拖动、不可禁用——它是链条的第一环，也是唯一一个用户要在别处（模型设置）才能改的环节，把它显出来等于把「优先级为什么是这样」直接写在界面上。该状态由 **UI 从当前活动模型的能力推导**，不经 host 服务转述（避免 UI 与服务端事实分叉）；UI 拿不到活动模型时退化为只显示渠道列表。

**渠道列表**：每行显示类型图标、备注、key 掩码、启用开关；支持拖拽排序、单条禁用、删除、行内改备注与 key。

**添加**：点击「添加」→ 弹窗：类型下拉（当前只有 `Tavily`）+ 备注 + API Key → 保存。类型下拉保留维度，不预先实现其它厂商。

**不做**「测试连接」按钮。渠道可用性不依赖任何预检；配置错误在下一次真实调用时以 §5.5 的结构化失败暴露。

**key 显示**：输入框用 `ApiKeyInput`（`packages/ui/src/settings/model-provider-section/ApiKeyInput.tsx`）同款的密码型 + 眼睛切换。

**国际化**：`packages/ui/src/i18n/locales/{zh-CN,en-US}.ts` 双份文案。

**平台差异**：该节只在 host 提供了 `IForkSearchProvidersService` 时可用，否则显示「当前环境不支持配置渠道」（与 `useForkWebdav` 的 `available` 处理同构）。

## 8. 模型可见契约

- **描述**：去掉 `US-only`（`websearch.ts:49-58` 的 `buildWebSearchProviderDescription`）。它描述的是服务端搜索的属性，接入 Tavily 后对多数调用不再成立。
- **入参**：在现有 `query` / `allowed_domains` / `blocked_domains` / `maxUses` 基础上新增 `max_results`（返回条数）。
- **各渠道只取自己需要的参数，不支持的入参不理会**：
  - 服务端渠道：`query` + 域名黑白名单 + `maxUses`；忽略 `max_results`。
  - Tavily 渠道：`query`，域名黑白名单映射为 include/exclude，`max_results`；忽略 `maxUses`（它只发一次请求）。
- **输出**：保持 `WebSearchOutput` 的既有字段与语义，另加一个**可选** `channel` 字段（§5.5）。注意该 schema 是 `.strict()`，新字段必须显式声明，否则序列化即失败。既有 UI 渲染与模型可见文本都不消费该字段，因此对两者零影响。
- 模型侧签名对模型保持单一形状——渠道差异封在适配器里，不外泄成按渠道不同的工具声明。

## 9. 上游接线点与标记清单

产品类改动，逐处最小化并打标：

| 文件 | 改动 | 标记 |
| --- | --- | --- |
| `apps/zcode-cli/packages/core/src/tool/handlers/websearch.ts` | 处理器主体改为调用路由；保留并导出 provider-native 执行单元；描述去掉 US-only | `FORK(search-providers)` + 一对 `FORK-BEGIN/END` |
| `apps/zcode-cli/packages/core/src/runtime/methods/config.ts` | `shouldExposeWebSearch` 判据改为渠道数 > 0 | 单点 `FORK(search-providers)` |
| `apps/zcode-cli/packages/contracts/src/tools/websearch.ts` | 入参 schema 新增 `max_results`；输出 schema 新增可选 `channel` | 单点 `FORK(search-providers)` ×2 |
| `packages/desktop/src/host/fork/webdav-sync/manifest.ts` | 新增 `cliConfigDir` base 与一条同步条目 | fork 自有文件，无需标记 |
| `packages/desktop/src/host/index.ts` | `resolveBase` 增加 `cliConfigDir` 分支（带自己的 `FORK(search-providers)` 单点标记，不带标记会看不出来源）；注册新服务 | 该块已有 `FORK(local-mode)`，新增分支单独标记 |
| `packages/client/src/remoteServiceAccess.ts` | 暴露 `forkSearchProvidersService` | `FORK(search-providers)` |
| 设置页四件套：`settingsPageConfig.ts`、`lib/settingsNavigation.ts`、`SettingsPage.tsx`、i18n 双份 | 新增栏目 | 逐处单点标记 |

**无需改动**（按名字匹配，设计上确认过）：`subagent/explore-tools.ts`、`subagent/profile.ts`、`compact/microcompact.ts`、`tool/scheduler.ts`、`permission/service.ts`、`tool/tool-visibility.ts`。

新增文件（不产生逐行冲突，无需标记）：`docs/features/search-providers/**`、`packages/shared/src/fork/search-providers-contract.ts`、`packages/services/src/fork/search-providers.ts`、`packages/desktop/src/host/fork/search-providers/**`、`packages/ui/src/fork/search-providers/**`、`apps/zcode-cli/packages/core/src/fork/search-providers/**`、各包 `test/` 下的新增测试。

## 10. 接口

### 10.1 CLI 侧渠道抽象（core 内部）

```ts
/** 一次搜索请求；字段是「渠道按需取值」的并集，不是每个渠道都支持全部字段。 */
export interface SearchChannelRequest {
  query: string;
  allowedDomains?: string[];
  blockedDomains?: string[];
  maxUses?: number;      // 服务端渠道
  maxResults?: number;   // Tavily 渠道
  signal?: AbortSignal;
}

/** 渠道失败：必须带上是哪个渠道、哪一类失败、原始原因。 */
export interface SearchChannelFailure {
  channelKind: "server" | "tavily";
  channelLabel: string;
  reason: string;
}

export interface SearchChannel {
  kind: "server" | "tavily";
  label: string;
  /** 成功返回该渠道的结果；失败必须抛出（不允许返回半成品）。 */
  search(request: SearchChannelRequest): Promise<SearchChannelOutcome>;
}

/** 路由结果：结果本体 + 实际命中的渠道（供元数据/日志）。 */
export interface SearchChannelOutcome {
  result: ModelTextResult;          // 交给 buildWebSearchOutput
  channelKind: "server" | "tavily";
  channelLabel: string;
  attempts: readonly SearchChannelFailure[];   // 本次调用中先失败的渠道（成功降级时非空）
}
```

路由对外只暴露一个函数：

```ts
export async function runSearchChannels(input: {
  channels: readonly SearchChannel[];
  request: SearchChannelRequest;
}): Promise<SearchChannelOutcome>;
```

### 10.2 渠道文件契约（`@zcode/shared`）

放在 shared 是因为三处都要读同一份格式定义（host 服务、UI、CLI 加载器）：

```ts
export const FORK_SEARCH_PROVIDERS_CHANNEL = "fork-search-providers";
export const FORK_SEARCH_PROVIDERS_FILE_VERSION = 1;
export interface ForkSearchProviderChannel { /* §6.3 的字段 */ }
export interface ForkSearchProvidersFile { version: number; channels: ForkSearchProviderChannel[]; }
/** 宽松解析：未知字段忽略、坏条目丢弃并回报原因，绝不抛给调用方使其启动失败。 */
export function parseForkSearchProvidersFile(raw: unknown): {
  channels: ForkSearchProviderChannel[];
  problems: string[];
};
```

### 10.3 host 服务面（`@zcode/services`）

```ts
export interface IForkSearchProvidersService {
  list(): Promise<ForkSearchProvidersFile>;
  addChannel(input: { kind: "tavily"; label: string; apiKey: string }): Promise<ForkSearchProvidersFile>;
  updateChannel(id: string, patch: { label?: string; apiKey?: string; enabled?: boolean }): Promise<ForkSearchProvidersFile>;
  removeChannel(id: string): Promise<ForkSearchProvidersFile>;
  reorder(ids: string[]): Promise<ForkSearchProvidersFile>;
}
```

服务面只描述**渠道文件**，不描述服务端渠道——后者的存在性是模型能力的函数，由 UI 从活动模型推导（§7），host 不转述。

## 11. 实施分期

1. **契约与测试先行**：渠道文件格式契约（shared）+ 解析容错测试；Tavily 适配器契约测试（字段名、错误分类、超时）；路由单测（顺序、失败聚合、成功降级留痕）。
2. **core 侧**：渠道抽象 + 路由 + Tavily 适配器 + 渠道加载器（mtime 缓存）；`websearch.ts` 接线；暴露门改造。
3. **host 侧**：`IForkSearchProvidersService` 实现（原子写 + 锁）+ 注册 + 服务暴露；WebDAV 清单条目与 `cliConfigDir` base。
4. **UI**：「搜索」栏目 + i18n + 拖拽。
5. **收尾**：FEATURES.md 登记、`implementation.md`、typecheck / lint / test:unit / architecture:check。

## 12. 验收场景

1. 模型支持服务端搜索、无 Tavily 渠道 → 工具暴露；调用走服务端；行为与今天一致。
2. 模型不支持服务端搜索、无 Tavily 渠道 → **工具不暴露**（与今天一致，回归保护）。
3. 模型不支持服务端搜索、配了一条启用中的 Tavily → 工具暴露；调用走 Tavily；结果正常渲染，UI 不因渠道变化而变形。
4. 模型支持服务端搜索、同时配了 Tavily → 先试服务端；服务端成功则 Tavily 不被调用（用量不增加）。
5. 服务端失败（含编码层不可用与运行时失败两种）+ Tavily 可用 → 自动降级成功；元数据与日志能看出「先试了服务端且失败了」。
6. 多条 Tavily、第一条 key 无效 → 降级到第二条成功；失败原因保留在日志。
7. 全部渠道失败 → 模型收到结构化失败，逐条列出渠道与原因；没有 `WebSearchOutput`。
8. 渠道数从 1 变为 0（禁用唯一渠道）→ 下一次工具调用中工具不再暴露。
9. 渠道文件损坏 → 应用正常启动、日志有 warn、Tavily 渠道按 0 条处理。
10. 代理已配置的用户调用 Tavily → 正常出网，不出现 `egress_blocked`。
11. 模型传 `max_results` 给服务端渠道 / 传 `maxUses` 给 Tavily 渠道 → 不报错，按「忽略不支持参数」处理。
12. 桌面用隔离 home 运行时：设置页写入的路径与 CLI 读取的路径是同一个文件（用两侧日志打印的绝对路径比对）。
13. WebDAV 备份 → 远端包含 `cli-fork/settings.json`；恢复到干净环境后渠道表一致。
14. 设置页拖拽排序 → 下一次调用按新顺序尝试。

## 13. 测试与验证策略

现状：`WebSearch` 与工具暴露逻辑**一条测试都没有**（仓库内 grep 无命中），属净增覆盖。

- **契约测试**（`*Contract.test.ts`，先写）：
  - 渠道文件：形状、版本、坏条目容错、缺失文件语义。
  - Tavily：请求字段名与类型、鉴权头位置、我们依赖的响应字段、错误分类（无效 key / 配额 / 限流 / 请求不合法 / 服务端错误 / 超时）分别映射到哪一类失败。断言必须能在上游或 API 变更时变红。
- **单测**（core）：路由顺序、首成功即停、失败聚合顺序、成功降级留痕、`maxUses`/`max_results` 的按渠道取值与忽略规则、渠道加载器 mtime 缓存行为。
- **暴露门单测**：渠道数 0/1/n 三态 × 模型能力两态。
- **E2E**（交互改动）：设置页新增/禁用/删除/拖拽后，行为符合场景 8、14。
- **验证命令**：`pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、`pnpm architecture:check --changed`、`pnpm fork:check-removals`。
- 打包产物行为（真实 Tavily 调用、WebDAV 同步往返）在 `implementation.md` 标注「未验证」与验证方法，不用间接断言冒充覆盖。

## 14. 风险与边界

- **降级掩盖真实故障**：服务端搜索的运行时失败会被 Tavily 接住，用户可能长期不知道自己付费的服务端搜索一直是坏的。缓解：结构化失败与成功降级都留痕（§5.5），元数据可见。
- **静默不生效**（最高优先级风险）：路径解析分叉会让「UI 配了、模型用不到」。缓解：§6.2 的唯一真源约束 + 验收场景 12 显式比对两侧绝对路径。
- **key 明文同步**：渠道文件随备份包上传到用户 WebDAV。这是明确选择；不做二次加密，但要在 UI 上有一句说明文案，避免用户误以为 key 会被加密存储。
- **渠道数变化与暴露的时序**：暴露门在 `getTools` 每次调用时求值，而渠道文件按 mtime 缓存，两者可能在一次会话内先后变化。约束：本设计保证「下一次工具调用」看到新值，不承诺同一轮内的原子一致。
- **服务端渠道不可单独禁用**：只要模型能力为真，它永远排第一。想强制用 Tavily 只能去模型配置关掉该能力——这是需求方选定语义。
- **Tavily 配额**：由降级链驱动，服务端搜索失败时会消耗 Tavily 额度。免费额度有限，需在 UI 上提示这一点。
- **同步冲突**：两台机器同时改渠道表时，WebDAV 恢复是整体替换，不做字段合并；冲突解决沿用现有 `ForkWebdavConflictDialog` 的取舍流程。

## 15. 上游同步记录

暂无。
