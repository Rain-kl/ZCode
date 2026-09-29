# edit-stale-guard 实现记录

> 设计见 `docs/features/edit-stale-guard/design.md`。**上游收敛前提**：上游若自己实现内容哈希判据（或让 range 读取自带 hash），删除本功能并采用上游实现——摘除范围就是下面第 2 节的标记清单 + 两个 fork 目录 + 本目录 + `FEATURES.md` 条目。

## 1. 落地位置

### 1.1 新增（无需上游标记）

| 文件                                                                         | 内容                                                                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `apps/zcode-cli/packages/adapters/src/fork/edit-stale-guard/content-hash.ts` | `hashBuffer(buffer)` 与 `createContentHash()`（增量版，供流式读取）；`sha256:<hex>` 的唯一出处 |
| `apps/zcode-cli/packages/core/src/fork/edit-stale-guard/hash-staleness.ts`   | `StalenessVerdict` 与 `resolveStalenessByContentHash`（纯函数）                                |
| `apps/zcode-cli/packages/core/test/forkEditStaleGuard.test.ts`               | 8 个用例：纯函数三态 + 真实 handler 驱动的决定性场景                                           |

### 1.2 上游接线（逐处标记）

| 上游文件                                         | 改动                                                                                                                                                                    | 为什么必须改上游                                                                                                                                                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adapters/src/fs/index.ts`                       | 私有 `hashBuffer` 删除，改从 fork 模块 import（`fs/index.ts:50-51`、`:792-795`）；`node:crypto` 的 `createHash` 随之去掉（`:5`）                                        | 哈希算法必须与 range 读取共用一份，否则两条读路径会各写一份 `sha256:` 前缀并漂移。**没有**把 `hashBuffer` 直接 export 给 `text-range-reader.ts` 用：`fs/index.ts` 已经 import 了 `text-range-reader.ts`，反向 import 会形成循环 |
| `adapters/src/fs/text-range-reader.ts`           | 快速路径 revision 补 `hash: hashBuffer(buffer)`（`:84-88`）；流式路径建 `createContentHash()` 并逐 chunk `update`，revision 取 `digest()`（`:103`、`:124`、`:169-170`） | range 读取是 read-state 的主要来源，不给它整文件哈希，Edit/Write 就只能继续用 mtime/size                                                                                                                                        |
| `core/src/tool/types.ts`                         | `ReadFileStateEntry` 增可选 `contentHash`（`:217-218`）                                                                                                                 | 记录「模型看过的那份内容」的哈希，判据才有比对基准                                                                                                                                                                              |
| `core/src/tool/handlers/read.ts`                 | `updateReadFileState` 落 `contentHash: revision?.hash`（`:379-380`）                                                                                                    | Read 是 read-state 的第一写入方；`revision` 优先取 range 读的 revision（`read.ts:365`），整文件哈希由本次接线提供                                                                                                               |
| `core/src/tool/handlers/bash-read-file-state.ts` | Bash 回填条目落 `contentHash: read.revision?.hash`（`:156-157`）                                                                                                        | 回填走 `readTextFile`（truncated 已提前返回），本就是整文件读，hash 可直接用                                                                                                                                                    |
| `core/src/tool/handlers/edit.ts`                 | ① 判据接线 `:435-446`；② `updateReadFileStateAfterEdit` 落 `contentHash`（`:605-606`）；③ import fork 模块（`:45-46`）                                                  | ① 是判据本身；② 让一次成功的 Edit 成为下一次 Edit/Write 的比对基准                                                                                                                                                              |
| `core/src/tool/handlers/write.ts`                | ① 判据接线 `:296-313`；② `updateReadFileStateAfterWrite` 落 `contentHash`（`:378-379`）；③ import fork 模块（`:28-29`）                                                 | 同 Edit（Write 的判据独立实现，必须分别接线）                                                                                                                                                                                   |

## 2. 上游改动标记清单（自查用）

`rg -n "FORK\(edit-stale-guard\)|FORK-BEGIN\(edit-stale-guard\)|FORK-END\(edit-stale-guard\)" --glob '!*.md' --glob '!**/dist/**'`

共 **7 个上游文件、20 处标记**（另有 1 处出现在 fork 模块的文件头注释里，用于说明摘除范围）：

| 文件                                             | 处数 | 行                                                                               |
| ------------------------------------------------ | ---- | -------------------------------------------------------------------------------- |
| `adapters/src/fs/index.ts`                       | 4    | 5（import 收窄）、50（import fork）、792/795（删除 `hashBuffer` 的成对标记）     |
| `adapters/src/fs/text-range-reader.ts`           | 5    | 18（import fork）、84/88（快路径成对）、103（流式 hasher）、169（流式 revision） |
| `core/src/tool/handlers/edit.ts`                 | 4    | 45（import fork）、435/446（判据成对）、605（写回落 hash）                       |
| `core/src/tool/handlers/write.ts`                | 4    | 28（import fork）、296/313（判据成对）、378（写回落 hash）                       |
| `core/src/tool/types.ts`                         | 1    | 217                                                                              |
| `core/src/tool/handlers/read.ts`                 | 1    | 379                                                                              |
| `core/src/tool/handlers/bash-read-file-state.ts` | 1    | 156                                                                              |

同步上游时的摘除顺序：先删两个 fork 目录（`content-hash.ts` 会让 `fs/index.ts` 与 `text-range-reader.ts` 编译失败，正好指向 `:50-51`、`:18-19` 两处 import），再删两个判据块与四处 `contentHash` 落点，最后删 `types.ts` 字段。

## 3. 关键设计点

1. **哈希对象是磁盘原始字节**，不是解码后的文本：`revision.hash` 由 adapter 对 `Buffer` 求 sha256，写路径哈希的是它写下的字节（`fs/index.ts:324`），整文件读路径既有的也是 buffer（`fs/index.ts:199`，上游实现）。range 读取跟随同一口径，`utf16le` / `latin1` / GBK 才能与写路径对齐。**若改成「解码后按 utf8 编码再哈希」，非 utf8 文件上读路径与写路径的哈希永不相等，未改动的文件会被永久判 stale。**
2. **流式路径增量哈希**：>10MB 的文件走 `readRangeStreaming`，拿不到整文件 buffer；`createContentHash()` 逐 chunk `update`，digest 出来的字符串与快速路径、`hashBuffer` 完全一致（实测见 4.5）。哈希是单调累加的，因此不需要额外缓冲整文件。
3. **判据不阻断 partial view**：`FILE_NOT_READ` 分支在哈希比较之前（`edit.ts:430-433`、`write.ts:285-294`），未改一行。
4. **未知即回落**：`contentHash` 是可选字段，`undefined` 时判据返回 `unknown`，调用方原样执行上游逻辑——包括上游的漏报行为。测试专门钉住这一点（`Edit 缺 hash：回落 mtime/size` 与 `Edit 缺 hash + mtime 未前进 + size 相同` 两个用例）。
5. **不扩持久化 schema**：`read-file-state-metadata.ts` 未改，resume 恢复的 read-state 没有哈希，回落旧判据。

## 4. 验证记录

### 4.1 类型检查

```
$ pnpm typecheck
> tsc -b packages/rpc … packages/desktop/tsconfig.host.json
（无错误输出，退出码 0）

$ PATH="/Users/ryan/Code/Node/ZCode/node_modules/.bin:$PATH" pnpm --dir apps/zcode-cli typecheck
 Tasks:    27 successful, 27 total
Cached:    17 cached, 27 total
```

### 4.2 单测

```
$ pnpm exec tsx --test apps/zcode-cli/packages/core/test/forkEditStaleGuard.test.ts
✔ 内容哈希判据：一致为 fresh，不一致为 stale，缺任一侧为 unknown
✔ Edit 误报：range Read + mtime 前进 + 字节未变 → 放行
✔ Edit 漏报：mtime 与 size 都不变但字节变了 → 报 stale
✔ Edit 缺 hash：回落 mtime/size，行为与改动前一致
✔ Edit 缺 hash + mtime 未前进 + size 相同 → 回落旧判据放行
✔ Edit 不完整视图仍先拒：partial view 即使 hash 相同也报 FILE_NOT_READ
✔ Write 误报：range Read + mtime 前进 + 字节未变 → 放行
✔ Write 漏报：range Read + mtime 与 size 都不变但字节变了 → 报 write_file_stale
ℹ tests 8   ℹ pass 8   ℹ fail 0
```

既有套件（同批跑过，均未受影响）：

| 命令                                                                                                                                 | 结果                        |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| `pnpm exec tsx --test apps/zcode-cli/packages/core/test/forkIdentityPreset.test.ts …/forkIdentityPresetContext.test.ts`              | tests 23 / pass 23 / fail 0 |
| `pnpm exec tsx --test packages/desktop/test/forkWebdav{Archive,Client,Engine,ErrorMessage,Presets,Snapshot}.test.ts`                 | tests 40 / pass 40 / fail 0 |
| `pnpm exec tsx --test packages/desktop/test/forkIdentityPresetStore.test.ts packages/shared/test/forkIdentityPresetContract.test.ts` | tests 18 / pass 18 / fail 0 |

### 4.3 修复前后的差异（决定性用例真的钉住了行为）

把 `resolveStalenessByContentHash` 临时改成恒返回 `unknown`（等价于「fork 判据缺席」）后复跑同一个测试文件：

```
ℹ tests 8   ℹ pass 3   ℹ fail 5
✖ 内容哈希判据：一致为 fresh，不一致为 stale，缺任一侧为 unknown
✖ Edit 误报：range Read + mtime 前进 + 字节未变 → 放行
✖ Edit 漏报：mtime 与 size 都不变但字节变了 → 报 stale
✔ Edit 缺 hash：回落 mtime/size，行为与改动前一致
✔ Edit 缺 hash + mtime 未前进 + size 相同 → 回落旧判据放行
✔ Edit 不完整视图仍先拒：partial view 即使 hash 相同也报 FILE_NOT_READ
✖ Write 误报：range Read + mtime 前进 + 字节未变 → 放行
✖ Write 漏报：range Read + mtime 与 size 都不变但字节变了 → 报 write_file_stale
```

恢复实现后 `tests 8 / pass 8 / fail 0`。四个决定性用例（Edit/Write 各一误报一漏报）在旧行为下全红，回落与 partial view 三个用例在两种实现下都必须绿——这正是设计要求的不对称。

### 4.4 Lint / 格式

```
$ cd apps/zcode-cli/packages/core && oxlint src/fork src/tool/handlers/{edit,write,read,bash-read-file-state}.ts src/tool/types.ts --no-ignore
Found 0 warnings and 1 error.        # read.ts: 468 行 > 400（HEAD 已是 526 行，既有问题；
                                     #  apps/zcode-cli 本就在根 .oxlintrc.json 的 ignorePatterns 内）

$ cd apps/zcode-cli/packages/adapters && oxlint src/fork src/fs/{index,text-range-reader}.ts --no-ignore
Found 0 warnings and 1 error.        # fs/index.ts 1880+ 行 > 400，同上既有
```

我新增的文件与新增行均无 lint 报错。注意 `node_modules/.bin/oxlint --no-ignore <路径>`（根目录调用）会报 `No files found to lint`：`--no-ignore` 只关掉 `.eslintignore`/`--ignore-pattern`，关不掉配置里的 `ignorePatterns`；必须进包目录调用。

格式：根 `oxfmt` 通过 `.prettierignore` 显式排除 `apps/zcode-cli/`（该目录自带更高的 oxfmt 0.47.0 与 `.oxfmtrc.json`），所以按目录自带的格式化器检查：

```
$ cd apps/zcode-cli && for f in <我改的 10 个文件>; do oxfmt --check "$f"; done
content-hash.ts / hash-staleness.ts / types.ts / read.ts / edit.ts / write.ts /
bash-read-file-state.ts / forkEditStaleGuard.test.ts      → All matched files use the correct format.
fs/index.ts、text-range-reader.ts                          → Format issues found（既有）
```

两个 adapter 文件在 **HEAD（未改动）** 上就是 `Format issues found`（长 import、`flatMap` 折行等历史风格差异）。逐行核对格式化器要动的都是上游原有行，**我新增的行一处都不在里面**；为不放大同步冲突面，未顺手重排这些上游行。

### 4.5 哈希一致性与旧判据实测（真实适配器，非模型化）

用 `createNodeFileSystemAdapter()` 对临时文件逐一比对（脚本一次性跑完即删）：

```
OK   lf hash full/range/sliced/disk      :: 四条路径同值
OK   crlf hash full/range/sliced/disk    :: 四条路径同值
OK   bom-crlf hash full/range/sliced/disk
OK   bare-cr hash full/range/sliced/disk
OK   cr-crlf-mixed hash full/range/sliced/disk
OK   utf16le hash full/range/sliced/disk
OK   latin1 hash full/range/sliced/disk
OK   write→read utf8-LF / utf8-CRLF / utf16le / latin1 :: 写路径与随后的整文件读、range 读同值
OK   streaming(>10MB) :: 整文件读 / range 读（流式）/ 磁盘字节同值
OK   streaming bare-CR :: 同上
cp -p: 旧判据 changed=false（false 即放行） contentChanged=true hashChanged=true mtime 1790653654410.2954→1790653654410.2954
```

最后一行是漏报的实测复现：字节从 `abcd` 改成 `abce`、`utimes` 把 mtime 还原到与记录完全相同的值，旧判据的 `mtimeAdvanced || sizeChanged` 为假 ⇒ 放行。

同一批实测还纠正了任务描述中的一个前提：**纯 CRLF / BOM+CRLF / 裸 `\r` / 混合行尾文件上，`readTextFile` 与 range 读的 `content` 逐字节相同**（`content full===range: true`），所以「CRLF 让内容豁免恒为假」并不成立；误报的真实机制是「range 读拿不到豁免」（见 `design.md` 2.1 的说明）。

## 5. 与设计的偏差、残留

1. **哈希对象**：任务描述要求「哈希解码后按 utf8 重编码的文本（`Buffer.from(rawContent, "utf8")`）」，实现改为**哈希磁盘原始字节**。理由是任务自带的硬约束「同一份磁盘字节在每条读路径与写路径上必须得到同一个字符串」：`utf16le` / `latin1` / GBK 上解码再按 utf8 编码与写路径写下的字节不同，会从「误报」升级为「永久误报」。原始字节同时与上游既有的 `readTextFile`（`fs/index.ts:199`）口径一致。4.5 已验证一致性。
2. **哈希实现的位置**：没有 export `fs/index.ts` 的私有 `hashBuffer`，而是移入 `adapters/src/fork/edit-stale-guard/content-hash.ts` 由三处共用。理由是 `fs/index.ts` 已 import `text-range-reader.ts`，反向 export 会给 `text-range-reader.ts` 制造循环 import；顺带把「算法只出现一次」变成了结构性保证。代价是删除了上游 3 行私有函数，同步时的 modify/delete 冲突是**想要的信号**（上游改哈希算法 ⇒ 本判据必须跟着看）。
3. **误报机制的表述**：任务描述归因于 CRLF 行尾不一致，实测不复现（4.5）。文档按实测机制书写，功能行为不变（误报照样消除）。
4. **未扩持久化 schema**：`contentHash` 不进 `read-file-state-metadata.ts`，resume 后的 read-state 仍是 `unknown` ⇒ 旧判据。要改成跨 resume 生效需要 schema 版本升级 + 旧版本兼容策略，本功能不做。
5. **未导出判据函数做集成测试**：两个判据函数保持上游的模块私有，测试改为驱动真实 handler（`editToolEntry.handler` / `writeToolEntry.handler` + 假 `FileSystemPort`），因此没有为了测试扩大上游 diff。
6. **残留（不在本次范围）**：`read.ts:335` 的 `isCachedReadFresh` 仍按 mtime+size 决定是否回 `file_unchanged`；这是读缓存短路，不是写保护，本次不动。它理论上会在「保留时间戳 + size 不变」的写入后回一次 `file_unchanged`，属于同族但不同路径的已知残留。
7. **`workflow-draft-read-state.ts` 未填 `contentHash`**：该路径的 revision 来自 `stat`，没有内容哈希可用；留 `undefined` ⇒ `unknown` ⇒ 旧判据（与改动前一致）。
