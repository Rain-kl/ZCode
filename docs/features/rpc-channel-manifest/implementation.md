# 通道清单驱动的服务可用性 (rpc-channel-manifest) — 实现

设计见 `design.md`。本文记录落地位置、上游接线点与标记清单、验证记录与未验证项。

## 1. 落地位置

### 新增文件（不需要 FORK 标记）

| 文件                                                       | 职责                                                                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `packages/client/src/channelManifest.ts`                   | 纯函数 `isChannelAvailable(manifest, channelName)`：清单未知/为空 → `true`；否则精确匹配。UI 与客户端共用的唯一判定    |
| `packages/services/src/fork/channel-availability.ts`       | `IChannelAvailability`：`isInitialized()` / `channelNames()` / `onDidChange`。UI 读「可用性事实 + 判定时机」的唯一入口 |
| `packages/ui/src/hooks/useChannelAvailabilityReady.ts`     | `useChannelAvailabilityReady(availability)` 给时机，`useChannelServiceUsable(service)` 给「可以发调用」                |
| `packages/rpc/test/rpcChannelManifestHandshake.test.ts`    | Initialize 载荷契约：字段名、时序、旧服务端兼容、清单覆盖                                                              |
| `packages/client/test/channelManifest.test.ts`             | 判定函数的边界（未知/空/精确匹配）                                                                                     |
| `packages/client/test/remoteServiceAccessManifest.test.ts` | 成员过滤、代理不落空、标识稳定、事件可订阅                                                                             |
| `packages/client/test/channelManifestAssembly.test.ts`     | 装配顺序契约（镜像 desktop host 的注册→构造顺序）与 `deferInit/ready()` 语义                                           |

### 上游文件改动（每处带 `FORK(rpc-channel-manifest)` 标记）

| 文件                                                              | 改动                                                                                                                                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/rpc/src/channels.shared.ts`                             | `IRawResponse.Initialize` 增可选 `channels?: readonly string[]`；`IChannelClient` 增可选 `channelNames()` / `isInitialized()` / `onDidInitialize`                                      |
| `packages/rpc/src/channelServer.ts`                               | 新增 `hasSentInitialize`；构造期的 Initialize 改为 `queueMicrotask` 推迟（保证清单完整）；`sendResponse(Initialize)` 带上 `{channels}`；`registerChannel` 在清单已发出且是新通道时补发 |
| `packages/rpc/src/channelClient.ts`                               | 新增 `channelManifest` 状态与 `channelNames()` / `isInitialized()`；`onResponse(Initialize)` 仅在服务端确实带清单时覆盖；新增 `readChannelManifest(payload)`                           |
| `packages/rpc/src/logging-middleware.ts`                          | `LoggingChannelClient.channelNames()` 透传清单，否则包一层日志就让下游退回「未知」                                                                                                     |
| `packages/rpc/src/network-telemetry-middleware.ts`                | 同上（`NetworkTelemetryChannelClient`）                                                                                                                                                |
| `packages/services/src/accessor.ts`                               | `IServiceAccessor` 增可选 `channelAvailability`                                                                                                                                        |
| `packages/services/src/index.ts`                                  | 导出 `IChannelAvailability`                                                                                                                                                            |
| `packages/client/src/remoteServiceAccess.ts`                      | 可选成员改惰性 getter（`defineManifestGatedService` + 按清单引用缓存）；新增 `channelAvailability`；7 个可选成员从必填声明改为可选                                                     |
| `packages/ui/src/fork/identity-preset/useForkIdentityPreset.ts`   | `usable` 门控所有调用；`available` 保留成员语义                                                                                                                                        |
| `packages/ui/src/fork/local-mode/useForkWebdav.ts`                | 同上（含 `refreshStatus`/`refreshBackups`/effect 与全部 action）                                                                                                                       |
| `packages/ui/src/fork/local-mode/FirstRunWebdavScreen.tsx`        | `useForkWebdavFirstRunGate` 也按 `usable` 门控，避免首屏引导触发同一超时                                                                                                               |
| `packages/ui/src/fork/search-providers/useForkSearchProviders.ts` | 同上（同类缺陷，一并收口）                                                                                                                                                             |

## 2. 上游收敛时的摘除范围

上游若自带服务能力协商，按以下顺序摘除本功能：

1. 删除 `packages/client/src/channelManifest.ts`、`packages/services/src/fork/channel-availability.ts`、
   `packages/ui/src/hooks/useChannelAvailabilityReady.ts` 与四个测试文件。
2. `RemoteServiceAccess`：删 `channelAvailability`、`defineManifestGatedService`、`manifestGatedCache`，
   可选成员改回直接赋值（恢复上游形态），并在 UI 侧改用上游的能力接口。
3. `packages/services/src/{accessor.ts,index.ts}`：删 `channelAvailability` 与 `IChannelAvailability` 导出。
4. `packages/rpc/src/*`：按上游实现替换清单字段与发送时机；注意保留「注册完成后才发」这一时序不变量。
5. UI 四处 hook：把 `useChannelServiceUsable(service)` 换成上游的能力判定，或回落 `Boolean(service)`——
   但**必须保留「清单/能力到达前不发调用」**，否则会退回本文所述的超时错误。

## 3. 关键实现取舍（为什么）

- **Initialize 载荷字段名 `channels`**：跨端约定，不在类型签名之外的第二处定义；由
  `rpcChannelManifestHandshake.test.ts` 直接断言序列化后的 body 形态守住。
- **空清单按未知处理**：见 `design.md` §2.1。这是为了防「装配顺序早于注册」导致的全量误判。
- **getter 而非构造期赋值**：`deferInit` 链路下 Initialize 可能晚于 `RemoteServiceAccess` 构造，
  构造期快照会把清单未到时的「未知」永久固化。
- **按清单引用缓存代理**：`ProxyChannel.toService` 每次调用返回新对象；不缓存会让
  `useMemo`/`useEffect` 依赖每次渲染都变，形成重渲染循环。ChannelClient 在收到新 Initialize 前复用同一份数组。
- **不把必填成员也纳入过滤**：`fileService` 等在所有 host 都注册，缺席属于装配错误，
  静默置 `undefined` 会让错误更难定位。

## 4. 上游改动标记清单

命令：

```bash
rg -n "FORK\(rpc-channel-manifest\)|FORK-BEGIN\(rpc-channel-manifest\)|FORK-END\(rpc-channel-manifest\)" \
  --glob '!AGENTS.md' --glob '!FEATURES.md' --glob '!docs/**' --glob '!.superpowers/**'
```

| 上游文件                                                          | 标记行数（= 逻辑改动处，无成对块）                                                                                                     |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/rpc/src/channels.shared.ts`                             | 4（`IRawResponse.Initialize` 字段、`IChannelClient.channelNames`、`isInitialized`、`onDidInitialize`）                                 |
| `packages/rpc/src/channelServer.ts`                               | 4（`hasSentInitialize` 字段、构造期推迟、`registerChannel` 补发、`sendResponse` 载荷）                                                 |
| `packages/rpc/src/channelClient.ts`                               | 5（`channelManifest` 状态、`channelNames()`、`isInitialized()`、`onBuffer` 解析、`readChannelManifest`）                               |
| `packages/rpc/src/logging-middleware.ts`                          | 1                                                                                                                                      |
| `packages/rpc/src/network-telemetry-middleware.ts`                | 1                                                                                                                                      |
| `packages/services/src/accessor.ts`                               | 1                                                                                                                                      |
| `packages/services/src/index.ts`                                  | 1                                                                                                                                      |
| `packages/client/src/remoteServiceAccess.ts`                      | 6（类头注释、`ManifestGatedServiceKey`、可选成员声明、`channelAvailability` 字段、`manifestGatedCache`、`defineManifestGatedService`） |
| `packages/ui/src/fork/identity-preset/useForkIdentityPreset.ts`   | 2（文件头注释、`usable` 门控）                                                                                                         |
| `packages/ui/src/fork/local-mode/useForkWebdav.ts`                | 2                                                                                                                                      |
| `packages/ui/src/fork/local-mode/FirstRunWebdavScreen.tsx`        | 1                                                                                                                                      |
| `packages/ui/src/fork/search-providers/useForkSearchProviders.ts` | 2                                                                                                                                      |
| **合计**                                                          | **12 个上游文件、30 行标记**                                                                                                           |

新增文件（含测试与 `docs/**`）里的 `FORK(rpc-channel-manifest)` 注释只是说明性文字，不计入标记统计。

## 5. 验证记录

### 5.1 静态检查（全绿）

- `pnpm typecheck`：通过（`tsc -b` 覆盖 rpc/shared/services/client/server/zcode-server-cli/ui/web/desktop host）。
- `PATH="…/node_modules/.bin:$PATH" pnpm --dir apps/zcode-cli typecheck`：通过（27/27 tasks）。
- 本功能文件 `oxlint`：0 warnings / 0 errors。
- 本功能文件 `oxfmt --check`：全部符合格式。

### 5.2 单测（全绿）

- `pnpm test:unit`：**7 组、241 用例全部通过**（`packages/rpc/test` 6、`packages/client/test` 15、
  `packages/desktop/test` 74、`packages/services/test` 13、`packages/shared/test` 24、
  `packages/ui/test` 10、`apps/zcode-cli/packages/core/test` 99）。
- 本功能新增两个测试组共 21 例：rpc 载荷契约 6、客户端装配顺序 4、成员过滤 7、判定边界 4。
  其余增量来自同期其他功能的提交，不在本次范围内。

### 5.3 运行时验收（CDP 实测）

**网页端**（`pnpm dev:web`，Vite `:5173` + server `:3030`）：

- 修复后：打开「设置 → 系统指令」显示 `当前环境不支持系统指令配置。`；
  面板文本中 `/timed out after/` 不匹配；「同步」显示 `当前环境不支持 WebDAV 备份（仅桌面版提供）。`；
  「搜索」显示 `当前环境不支持配置渠道（仅桌面版提供）。`
- **反向对照（同一 checkout，仅临时把 `isChannelAvailable` 改成恒 `true` 复现改造前行为，随后还原）**：
  系统指令面板正文变为
  `启用自定义系统指令 … ZCode 默认 | Channel name 'fork-identity-preset' timed out after 1000ms | 提示词配置 新增 还没有配置…`
  ——与任务描述的现象逐字一致；控制台同时出现 `fork-webdav timed out after 1000ms` 与
  `window-controller timed out after 1000ms`。
  该对照证明修复确实来自本改动，而不是环境差异。

**桌面端**（`dev:desktop` 已在运行，CDP `:9229`，Vite `:5174` 提供本 checkout 的 renderer 源码）：

- 「系统指令」：正常读写，读到既有配置 `Pier`（未出现「不支持」文案）。
- 「同步」：`已连接 ryan061@163.com @ https://dav.jianguoyun.com/dav/zcode/`，远端备份列表可见 5+ 份。
- 「搜索」：Tavily 渠道可见（Key 掩码 `tvly••••j3Ft`）。

### 5.4 未验证项（如实说明）

- **桌面端未做「改前 vs 改后」对照**：运行中的 desktop 实例启动于本改动之前
  （主进程/host 的 `tsup` 产物在改动前构建），其 host 端 ChannelServer 是旧逻辑；renderer 经 Vite 热更新
  拿到了新模块。因此桌面端验收的**结论是「新旧混跑仍可用」**（兼容性成立），
  不等于在全新桌面实例上复验过。方法论上这是更保守的方向，但仍建议一次完整 `pnpm dev:desktop` 重启复验。
- **`deferInit === true` 链路未做运行时验证**：见 §6，全仓无生产调用方，仅由契约测试覆盖。
- **`window-controller` 在 web 上的独立收口**：`useGlobalTaskList` 仍会为缺失的 controller 记
  `window Host Controller channel unavailable`（它读的是 `windowControllerService`，已纳入过滤，
  因此不会再产生 1s 超时）。该 hook 的语义（Host/Renderer 版本不一致告警）属于既有设计，本次不改。

## 6. `deferInit` / `ready()` 时序核查结论

任务要求先读清时序再动手。核查结果：

- `deferInit` 的唯一构造点：`packages/desktop/src/host/index.ts:2027`
  `new ChannelServer(protocol, "host", 1000, deferInit)`；
  其唯一调用点 `:2140` 传 `false`（`exposeServicesOnMessagePort(port, services, false, …)`）。
- 全仓穷举 `.ready()`（含 `dist`/`out`/`mjs`/字符串下标访问）未找到生产调用方；
  `packages/desktop/src/host/index.ts:1904` 的类型 `server: IChannelServer & { ready(): void }`
  只描述 handle 形状，该字段无读取点。
- 结论：**当前唯一实际路径是「立即初始化」，其正确性由 `queueMicrotask` 推迟保证**
  （同步注册发生在构造与微任务之间）。
- 「延迟初始化」路径保持原语义（由调用方在注册完成后调用 `ready()`），并以
  `channelManifestAssembly.test.ts` 第二条用例把该顺序固化成断言：
  未调用 `ready()` 时客户端保持「未知清单」（不误判），调用后清单完整。
- **残余风险**：若将来有代码接入 `deferInit === true` 且在注册完成前调用 `ready()`，
  清单会偏小、真实服务被判为不可用。该风险是**静默**的（不报错），只能靠上述契约测试与新增通道时的
  回归覆盖；已在设计文档 §2.2 显式记录。

## 7. 兼容性残余风险

1. **空清单兜底会掩盖「服务端真的零通道」**：当前不存在这种服务端（所有装配点都至少注册 `fileService`），
   若将来出现，它会表现为「全部可用」而不是「全部不可用」。取舍理由见 `design.md` §2.1。
2. **清单是快照，不是订阅**：客户端在两条 Initialize 之间新增通道的窗口内不会重算；
   服务端已在 `registerChannel` 补发清单，正常路径下窗口为零。
3. **`onDidInitialize` 未被装饰器保证透传**：`channelAvailability.onDidChange` 在拿不到事件时退化为
   `Event.None`（只认同步快照）。当前装配点是裸 `ChannelClient`，事件可用；
   若将来在 `ChannelClient` 外包装饰器，需确认它转发 `onDidInitialize`（已在 `IChannelClient` 声明为可选）。
