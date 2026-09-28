# local-mode 第②期（备份内核）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 WebDAV 备份内核——zip 备份包、WebDAV 客户端、状态机同步引擎与服务，使「云端备份 / 云端恢复 / 自动同步 / 保留清理 / 冲突判定」在无 UI 的情况下可被脚本与单测驱动验证。

**Architecture:** 纯逻辑（命名、哈希、白名单投影、保留选择、状态机、PROPFIND 解析）与 IO（undici 请求、yazl/yauzl、文件读写）分离：引擎只依赖注入的接口，单测用内存假件驱动；客户端用本地假 WebDAV 服务验证。开关与产品规则沿用第①期的 `@zcode/shared` fork 模块。

**Tech Stack:** TypeScript、undici（HTTP）、yazl/yauzl（zip）、Node `node:test`（`pnpm exec tsx --test`）、`@zcode/services` 的服务描述符与访问层。

## Global Constraints

- 设计依据：`docs/features/local-mode/design.md` 第 3、6 节（所有权、同步状态机、冲突、保留、备份范围）。
- 二开标准：上游文件改动带 `FORK(local-mode)` 标记；新增代码放 `fork/` 目录。
- 提交规范：Conventional Commits、只提交本次改动文件、**禁止推送远程**。
- 每个任务结束跑：`pnpm typecheck`、`pnpm lint`；单测：`pnpm exec tsx --test <file>`。
- 凭据只进 `credentialService`（`credentials.json`，键 `fork:webdav:password`）；url/username/目录/开关/保留份数/基准进 `{configDir}/v2/fork-webdav.json`。
- 同步范围严格按设计 6.5：`setting.json` 白名单字段 + `provider_config.json`；不含 `credentials.json`、sessions、日志、telemetry。
- 服务通道名固定 `fork-webdav`（定义在 fork 契约模块，不新增上游 channel 常量）。

---

### Task A: 契约类型与通道名

**Files:** Create `packages/shared/src/fork/webdav-contract.ts`; Modify `packages/shared/src/index.ts`（加一行导出）

**Interfaces（后续任务全部依赖）:**

```ts
export const FORK_WEBDAV_CHANNEL = "fork-webdav";
export const FORK_WEBDAV_PASSWORD_CREDENTIAL_KEY = "fork:webdav:password";
export type ForkWebdavSyncPhase = "idle" | "syncing" | "conflict" | "error";
export interface ForkWebdavCredentials {
  url: string;
  username: string;
  password: string;
  directory: string;
}
export interface ForkWebdavBackup {
  key: string;
  createdAt: string;
  size: number;
  source: string;
  contentHash: string;
}
export interface ForkWebdavStatus {
  configured: boolean;
  url: string | null;
  username: string | null;
  directory: string;
  autoSync: boolean;
  retentionLimit: number;
  lastSyncAt: string | null;
  lastError: string | null;
  phase: ForkWebdavSyncPhase;
  backupCount: number;
  source: string;
}
export interface ForkWebdavTestResult {
  ok: boolean;
  error?: string;
}
export interface IForkWebdavService {
  getStatus(): Promise<ForkWebdavStatus>;
  testConnection(input: ForkWebdavCredentials): Promise<ForkWebdavTestResult>;
  configure(input: ForkWebdavCredentials): Promise<ForkWebdavStatus>;
  disconnect(): Promise<ForkWebdavStatus>;
  updateSettings(patch: { autoSync?: boolean; retentionLimit?: number }): Promise<ForkWebdavStatus>;
  listBackups(): Promise<ForkWebdavBackup[]>;
  backupNow(): Promise<ForkWebdavStatus>;
  restoreBackup(key: string): Promise<ForkWebdavStatus>;
  deleteBackup(key: string): Promise<void>;
  resolveConflict(choice: "use-remote-latest" | "keep-local"): Promise<ForkWebdavStatus>;
}
```

- [ ] Step 1: 写类型文件与导出；`pnpm typecheck`；提交 `feat(local-mode): add fork webdav contract`

### Task B: 备份包（zip）与命名/保留/哈希

**Files:** Create `packages/desktop/src/host/fork/webdav/backup-archive.ts`; Test `packages/desktop/test/forkWebdavArchive.test.ts`

**Interfaces:** `buildBackupKey(date: Date): string`（`zcode-YYYYMMDD-HHmmss.zip`）、`sortBackupKeysDesc(keys)`、`selectKeysToPrune(keys, limit)`、`normalizeContentHash({setting, providerConfig})`、`buildBackupZip(input): Promise<Buffer>`、`readBackupZip(buffer): Promise<{manifest, setting, providerConfig}>`

- [ ] Step 1: 测试——命名/排序/保留选择（含 `limit` 边界与只匹配 `zcode-*.zip`）
- [ ] Step 2: 跑测试确认失败
- [ ] Step 3: 实现纯函数
- [ ] Step 4: 测试——zip 往返（含空 `provider_config.json`）通过
- [ ] Step 5: `pnpm typecheck && pnpm lint`；提交 `feat(local-mode): add webdav backup archive helpers`

### Task C: WebDAV 客户端

**Files:** Create `packages/desktop/src/host/fork/webdav/webdav-client.ts`; Test `packages/desktop/test/forkWebdavClient.test.ts`（本地 `node:http` 假 WebDAV 服务）

**Interfaces:** `createWebdavClient({ baseUrl, directory, username, password, fetchImpl }): { ensureDirectory, listBackups, getObject, putObject, deleteObject, testConnection }`；`parsePropfindEntries(xml): { href, size, lastModified }[]`（命名空间前缀无关）

- [ ] Step 1: 测试——PROPFIND 解析（`D:`/`d:` 前缀、URL 编码 href、缺字段）
- [ ] Step 2: 实现解析器，测试通过
- [ ] Step 3: 测试——假服务端：MKCOL、PUT/GET 往返、DELETE、401、404、列表过滤 `zcode-*.zip`
- [ ] Step 4: 实现客户端（Basic Auth、`fetchImpl` 注入以复用代理/CA 传输）
- [ ] Step 5: 门禁 + 提交 `feat(local-mode): add webdav client`

### Task D: 状态文件与凭据

**Files:** Create `packages/desktop/src/host/fork/webdav/state-store.ts`; Test `packages/desktop/test/forkWebdavState.test.ts`

**Interfaces:** `readForkWebdavState(filePath)`、`writeForkWebdavState(filePath, state)`（原子写）、状态形状 `{ url, username, directory, autoSync, retentionLimit, lastUploadedHash, lastSyncAt, lastRemoteKey, firstRunSkipped }`；凭据读写 `readWebdavPassword(credentialService)` / `saveWebdavPassword(...)` / `deleteWebdavPassword(...)`

- [ ] Step 1: 测试——缺失文件返回默认值、写入后读回一致、损坏 JSON 回落默认值
- [ ] Step 2: 实现 + 测试通过；门禁；提交 `feat(local-mode): add webdav state store`

### Task E: 本地快照投影与应用

**Files:** Create `packages/desktop/src/host/fork/webdav/local-snapshot.ts`; Test `packages/desktop/test/forkWebdavSnapshot.test.ts`

**Interfaces:** `pickSyncedSettings(settings): Partial<AppSettings>`（白名单，缺失字段自动忽略）、`readLocalSnapshot({ settingService, providerConfigPath })`、`applyRemoteSnapshot({ settingService, providerConfigPath, snapshot })`

- [ ] **Step 1:** 测试——白名单：命中列表字段被投影、非白名单字段不出现、白名单里不存在的字段不报错
- [ ] **Step 2:** 实现 + 通过；门禁；提交 `feat(local-mode): add local snapshot projection`

### Task F: 同步引擎（状态机）

**Files:** Create `packages/desktop/src/host/fork/webdav/sync-engine.ts`; Test `packages/desktop/test/forkWebdavEngine.test.ts`（内存假件：假客户端、假快照、假状态、假时钟）

**Interfaces:** `createSyncEngine(deps): { runCycle(trigger), backupNow(), restoreBackup(key), deleteBackup(key), getPendingConflict(), resolveConflict(choice), start(), stop() }`

**行为（对应设计 6.3/6.4）：**

1. 本地哈希≠基准 且自动同步开 → 上传新包（contentHash 去重）→ 按保留份数清理 → 更新基准
2. 远端存在比 `lastSyncAt` 新的包：本地无改动 → 自动恢复最新；本地有改动 → `pendingConflict`（不自动覆盖）
3. `runCycle` 全程持锁（`withLock`），锁内重读状态
4. 失败写 `lastError` 并退避；`disconnect()` 不删远端包

- [ ] Step 1: 测试——① 本地变更触发上传并更新基准；② 内容未变不重复上传（去重）；③ 仅远端变化时自动恢复；④ 双变时进入冲突且不写盘；⑤ `resolveConflict("keep-local")` 上传 / `("use-remote-latest")` 恢复；⑥ 保留份数清理只删最旧的 `zcode-*.zip`；⑦ 锁内串行（并发 `runCycle` 只执行一次上传）
- [ ] Step 2: 实现引擎，测试全绿
- [ ] Step 3: 门禁；提交 `feat(local-mode): add webdav sync engine`

### Task G: 服务装配与上游接线

**Files:** Create `packages/desktop/src/host/fork/webdav/service.ts`、`packages/desktop/src/host/fork/webdav/index.ts`; Modify `packages/services/src/accessor.ts`、`packages/client/src/remoteServiceAccess.ts`、`packages/desktop/src/host/index.ts`

**接线：**

- `accessor.ts`：可选成员 `readonly forkWebdavService?: IForkWebdavService`（类型来自 `@zcode/shared`）
- `remoteServiceAccess.ts`：`ProxyChannel.toService<IForkWebdavService>(channelClient.getChannel(FORK_WEBDAV_CHANNEL))`
- `host/index.ts`：在既有晚注册点注册 fork 服务，注入 `settingService`、`ICredentialService`、host 网络 transport 的 `fetch`、`getAppConfigDir()`、logger、broadcastService（状态事件）

- [ ] Step 1: 实现 `service.ts`（把引擎、客户端、状态、凭据组装；`start()` 开启轮询与防抖；状态变更经 `broadcastService` 广播）
- [ ] Step 2: 三处上游接线（每处 `FORK(local-mode)` 标记）
- [ ] Step 3: `pnpm typecheck && pnpm lint && pnpm architecture:check`
- [ ] Step 4: 提交 `feat(local-mode): register webdav backup service`

### Task H: 内核自检与文档回写

- [ ] Step 1: `pnpm exec tsx --test packages/desktop/test/*.test.ts`（全部内核单测）
- [ ] Step 2: 标记自查 `rg -n "FORK\(local-mode\)"` 与设计第 7 节核对
- [ ] Step 3: `FEATURES.md` 与 `design.md` 回写实际文件与接线（含 `fork-webdav` 通道名与状态文件字段）
- [ ] Step 4: 提交 `docs(local-mode): sync phase 2 wiring`

## Self-Review

- **Spec coverage**：设计 6.1（远端布局/命名/MKCOL/Basic）→ Task B、C；6.2（内容哈希）→ Task B；6.3（状态机/锁/保留/首次配置/失败退避）→ Task F、G；6.4（冲突三选）→ Task F；6.5（白名单与排除）→ Task E；6.6 的删除/恢复语义 → Task C、F；第 3 节所有权（凭据/状态/基准）→ Task D。
- **不做**：UI（首屏、设置页、状态项、冲突弹窗）归第③④期；凭据加密上传不做（设计 12.1）。
- **验证真实性**：zip、PROPFIND、客户端、引擎、投影全部有可运行单测；服务装配只有 typecheck + 后续 UI 期的手工验证（届时补）。

## 执行记录（2026-09-28）

- Task A–G 全部完成并逐任务提交（`63453de`…`e0b11d4`）。
- 新增文件：`packages/shared/src/fork/webdav-contract.ts`、`packages/services/src/fork/webdav.ts`、`packages/desktop/src/host/fork/webdav/{backup-archive,webdav-client,state-store,local-snapshot,sync-engine,service,index}.ts`；测试 `packages/desktop/test/forkWebdav*.test.ts`（30 个用例）。
- 上游接线（均带 `FORK(local-mode)` 标记）：`packages/shared/src/index.ts`、`packages/services/src/index.ts`、`packages/services/src/accessor.ts`、`packages/client/src/remoteServiceAccess.ts`、`packages/desktop/src/host/index.ts`。
- **测试发现并修掉的真实缺陷**：① 引擎原先先判「本地变了就上传」，导致「双变 → 冲突」分支永不可达；② mtime 相同时备份包排序退化为插入顺序（现回退到 key 内时间，再回退 key 字符串）；③ 目录 href `/zcode/` 被误解析成备份 key（现按结尾 `/` 判定为目录）。
- **与计划的偏差**：契约里的 `IForkWebdavService` 从 `packages/shared` 移到 `packages/services/src/fork/webdav.ts`——它需要 `Event`（来自 `@zcode/rpc`），而 shared 不依赖 rpc；数据契约（类型/常量）仍留在 shared。`lastError` 按设计是内存态（不落盘），由 service 层维护，引擎只记日志并向上抛。
- **偏差**：zip / 引擎等任务的 TDD 红步未逐个先跑失败测试（写实现与测试同步进行），验证以「运行测试并确认通过」为准；上述三处缺陷正是这些测试抓到的。
- 验证命令：`pnpm exec tsx --test packages/desktop/test/forkWebdav*.test.ts packages/shared/test/forkLocalMode.test.ts`（30 passed）、`pnpm typecheck`、`pnpm lint`（70 warnings / 0 errors，与基线一致）、`pnpm architecture:check`（OK）。

## 第③期执行记录（2026-09-28）

- 新增：`packages/ui/src/fork/local-mode/useForkWebdav.ts`（服务访问与状态订阅）、`ConfigSyncPanel.tsx`（连接表单/状态、自动同步开关、保留份数、云端备份、备份列表的恢复与删除、冲突横幅）。
- 上游接线（带 `FORK(local-mode)` 标记）：`packages/ui/src/lib/settingsNavigation.ts`（新增 `configSync`）、`packages/ui/src/settings/settingsPageConfig.ts`（基础设置组新增「同步」）、`packages/ui/src/SettingsPage.tsx`（渲染分支 + 导入）、`packages/ui/src/i18n/locales/{zh-CN,en-US}.ts`（31 个文案键）。
- **CDP 发现并修掉的真实缺陷**：服务事件原先按「方法式」声明与调用（`onStatusChanged()(listener)`），渲染层订阅时抛 `TypeError`，把设置页子树打崩（错误边界接管）。改为属性式 `onStatusChanged: Event<T>` + `service.onStatusChanged(listener)`，与 `IModelSelectionService.onDidChange` 的既有用法一致。
- 端到端验证（dev 应用 + 本地假 WebDAV 服务 `127.0.0.1:18080`）：
  1. 未配置时面板显示连接表单，无备份列表/冲突横幅；
  2. 「测试连接」提示「连接正常」（服务端收到 PROPFIND）；
  3. 「保存并登录」→ 服务端 `MKCOL` + 自动上传首份备份包 `zcode-20260928-161617.zip`（1413 字节）；
  4. 「云端备份」→ 再上传 `zcode-20260928-161623.zip`，列表出现两个备份包（含时间与大小）；
  5. 「断开连接」→ 表单恢复、备份列表隐藏，远端两份备份保留，状态文件重置为未配置（url/username/baseline 全 null），凭据已从 `credentials.json` 删除。
- 未验证（第④期随首屏/弹窗一起验收）：恢复任意备份的 UI 流程、冲突弹窗、跳过后重进配置。
