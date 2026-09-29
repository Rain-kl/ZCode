# Edit/Write stale 判据改为内容哈希（edit-stale-guard）

> 二开功能条目 id：`edit-stale-guard`。代码中所有上游接线标注 `FORK(edit-stale-guard)`，检索见 `AGENTS.md` 的「二开标准（Fork）」。
> **上游收敛前提**：这是对上游判据的替代实现。上游若自己改成内容哈希判据、或让 range 读取自带 hash，**删除本功能**（两处 `FORK-BEGIN/END` 接线块 + `core/src/fork/edit-stale-guard/` + `adapters/src/fork/edit-stale-guard/` + 本目录 + `FEATURES.md` 条目），直接采用上游实现。标记刻意集中在两个判据函数与两个 revision 落点上，可机械整块摘除。

## 1. 背景与目标

`Read` 会在 read-state 里记下「模型看过哪个文件的哪份内容」，`Edit` / `Write` 在写入前用这份记录判定「文件自读取后是否被改过」：改过就拒绝（`STALE_FILE` / `write_file_stale`），让模型重新读一遍再改。判据放在两处上游代码：

- `apps/zcode-cli/packages/core/src/tool/handlers/edit.ts` 的 `getEditableReadStateFailure`（`edit.ts:423`，改动前 `419-441`）
- `apps/zcode-cli/packages/core/src/tool/handlers/write.ts` 的 `assertWritableExistingFileIsFresh`（`write.ts:280`）

两处用的都是 mtime + size 代理：

```
变了 = floor(当前 mtime) > floor(记录 mtime) || 记录 sizeBytes ≠ 当前 sizeBytes
豁免 = 上次是「严格整读」且 lastRead.content === currentRead.content
报错 = 变了 && !豁免
```

上游把 `FileSystemRevision.hash` 留成了可选字段（`apps/zcode-cli/packages/contracts/src/interfaces/file-system.port.ts:55`），**写路径**已经填它（`adapters/src/fs/index.ts:324` 的 `hashBuffer(content)`，形如 `sha256:<hex>`），但**读路径只有整文件读填了**（`fs/index.ts:199`，上游既有），range 读取（`adapters/src/fs/text-range-reader.ts`）没填，core 的 read-state 也没保存。

目标：把「文件是否被改过」的判据换成**内容哈希**，mtime/size 只作为拿不到哈希时的回落。

## 2. 两个缺陷（均已在本机实测复现）

### 2.1 误报：只推进 mtime/size 的外部动作也判 stale

唯一的豁免是「严格整读（`offset<=1` 且 `limit===undefined`）且当前整文件文本与记录文本相同」：

- `edit.ts:452`：`if (isStrictFullRead(lastRead) && lastRead.content === currentRead.content) return undefined;`
- `write.ts:314`：同型

`isStrictFullRead` 对 **range Read（offset/limit）** 返回 false（`edit.ts:454`、`write.ts:355`），所以只要模型是「先读第 100–200 行再改」，豁免直接不可用：格式化器空保存、IDE 保存、`git` 触碰、同一 workspace 的另一个会话，只要把 mtime 推前一格，就被判 stale，即使磁盘字节一个字都没变。这是「range 读 + 时间戳噪声」这一类的高频误报。

> **与本次任务描述的偏差（实测纠正）**：任务描述给出的机制是「`text-range-reader` 去掉 `\r` ⇒ CRLF 文件上 `lastRead.content === currentRead.content` 恒为假」。本机实测**不成立**：端口契约规定 `FileSystemReadTextResult.content` 已归一成 LF（`file-system.port.ts:95-99`、`fs/index.ts` 的 `normalizeLineEndings`），range 读取的快路径也只做同样的归一（`text-range-reader.ts:70` `selectedLines.join("\n")`，快路径没有逐行去 `\r`）。用真实适配器实测纯 CRLF、BOM+CRLF、裸 `\r`、`\r`+CRLF 混合文件，整文件读与 range 读的 `content` 全部逐字节相同（证据见 `implementation.md` 第 4 节）。因此**误报的真实机制是「range 读拿不到豁免」，不是行尾不一致**；判据改成内容哈希后这一类误报同样被消除，但文档不保留未复现的说法。逐行去 `\r` 只存在于流式路径（>10MB，`text-range-reader.ts:126`），影响面是「>10MB 且含 `\r\r\n`」这类极端输入，本功能顺带消除（hash 取原始字节，与 content 是否被加工无关）。

### 2.2 漏报：保留时间戳的写入被静默放行

`edit.ts:466-475` 要求 mtime **严格变大**，再与 size 比较：

```
mtimeAdvanced = floor(当前) > floor(记录)
return mtimeAdvanced || lastRead.sizeBytes !== currentRead.sizeBytes;
```

mtime 不前进且 size 不变时返回 `false`，调用方（`edit.ts:449`）据此 `return undefined` —— **不比对内容就放行**。`write.ts:327` 的版本多一道最终内容比对，但它只覆盖严格整读（`write.ts:346` 的 `isStrictFullRead(lastRead) && …`），range 视图同样漏。

后果是 `cp -p`、`tar -x`、`rsync -t`、`git checkout` 保留 mtime 的写入，以及同一毫秒内的等 size 写入，会被判「没变」而直接覆盖，丢掉别的进程刚写下的字节。

实测（真实适配器 + `utimes` 还原 mtime）：字节 `abcd` → `abce`，mtime 还原到与记录完全相同的值、size 相同 ⇒ 旧判据 `changed=false`（放行），内容与哈希都已变。

## 3. 新判据

新增 fork 模块 `apps/zcode-cli/packages/core/src/fork/edit-stale-guard/hash-staleness.ts`：

```ts
export type StalenessVerdict = "stale" | "fresh" | "unknown";

export function resolveStalenessByContentHash(input: {
  recordedHash?: string;
  currentHash?: string;
}): StalenessVerdict;
```

- 两侧都有且相同 → `fresh`：**不判 stale，无视 mtime/size**（消除 2.1 的误报）
- 两侧都有且不同 → `stale`：**直接判 stale，无视 mtime/size**（消除 2.2 的漏报）
- 任一缺失 → `unknown`：原样走上游 mtime/size 判据，行为与改动前一致

两个判据函数在 mtime/size 逻辑**之前**消费它（`edit.ts:435-446`、`write.ts:296-313`，`FORK-BEGIN/END(edit-stale-guard)` 成对包住）。`FILE_NOT_READ`（未读 / partial view）的拒绝位置完全不动：不完整视图仍先被拒，不做任何哈希比较。

参与比较的两个值都来自 adapter 的整文件内容哈希：

| 来源                   | 位置                                               | 哈希的对象   |
| ---------------------- | -------------------------------------------------- | ------------ |
| Read（range 或整文件） | `read.ts:380` ← `text-range-reader.ts:87` / `:170` | 磁盘原始字节 |
| Bash 回填              | `bash-read-file-state.ts:157` ← `fs/index.ts:199`  | 磁盘原始字节 |
| Edit 写回              | `edit.ts:606` ← `fs/index.ts:324`                  | 刚写下的字节 |
| Write 写回             | `write.ts:379` ← `fs/index.ts:324`                 | 刚写下的字节 |

**一致性规则**：同一份磁盘字节在每条读路径与写路径上必须得到同一个字符串。为此哈希对象一律是「磁盘原始字节」，而不是解码后再按 utf8 编码的文本——`utf16le` / `latin1` / GBK 等编码下解码再编码会得到与磁盘不同的字节序列，而写路径哈希的是它写下的字节，两者永不相等，未改动的文件会被永久判 stale。算法与 `sha256:` 前缀只出现在 `adapters/src/fork/edit-stale-guard/content-hash.ts`。

## 4. 边界与非目标

- **判据是字节级的**：只改行尾（CRLF↔LF）、只加/去 BOM、只换编码的重写都算 `stale`，模型需重新 Read。这是有意的：磁盘字节确实变了，且写路径会按读取时记录的编码把整文件重新编码回写；旧实现的「文本相同就豁免」在这里是另一类静默覆盖。
- **resume 之后回落旧判据**：`ReadFileStateEntry.contentHash` 不进入持久化 schema（`read-file-state-metadata.ts` 不动），从历史 tool part metadata 恢复的 read-state 没有哈希 ⇒ `unknown` ⇒ 旧的 mtime/size 判据。这是本地版本兼容的选择：扩 schema 会让旧版本读不懂新会话，收益（跨 resume 的精确判据）不足以抵消。
- **不改 `Read` 的「file_unchanged」短路**：`read.ts:335` 的 `isCachedReadFresh` 仍按 mtime+size 判断是否回 `file_unchanged`。它是缓存优化，不是写保护；本次不动，属于已知残留（见 `implementation.md` 第 5 节）。
- **不改 partial view 语义**：token 截断的 Read 仍让 Edit/Write 报 `FILE_NOT_READ`。
- **不填补 `workflow-draft-read-state.ts`**：那条路径的 revision 来自 `stat`，本来就没有内容哈希，留 `undefined` 即回落旧判据。
- **不新增依赖、不新增 workspace 包**。

## 5. 状态所有者

| 状态                         | 唯一所有者                                           | 说明                                                              |
| ---------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| `sha256:` 算法与前缀         | `adapters/src/fork/edit-stale-guard/content-hash.ts` | 读、写、流式三条路径共用同一个实现                                |
| 每条 text read 的整文件哈希  | adapter 的 `revision.hash`                           | `fs/index.ts`（整文件读、写）、`text-range-reader.ts`（range 读） |
| 「模型看过的那份内容」的哈希 | `ReadFileStateEntry.contentHash`                     | 由 4 个写入方落库；过期即被下一次读/写覆盖                        |
| stale 判定                   | `resolveStalenessByContentHash`                      | 纯函数，无状态                                                    |

## 6. 验收场景

1. **误报消除（决定性是 range 读）**：磁盘字节未变，range Read（offset/limit）后 mtime 前进 ⇒ `fresh` ⇒ Edit/Write 放行。（旧实现：`STALE_FILE` / `write_file_stale`）
2. **漏报消除（决定性是保留时间戳）**：`cp -p` 式写入改了字节，mtime 与 size 都不变 ⇒ `stale` ⇒ Edit/Write 拒绝且不写盘。（旧实现：放行并覆盖）
3. **回落**：read-state 无 `contentHash`（resume 恢复）⇒ `unknown` ⇒ 行为与改动前逐条一致（mtime 前进判 stale；未前进且 size 相同则按旧逻辑）。
4. **不完整视图**：`isPartialView` 的条目即使哈希相同也先报 `FILE_NOT_READ`。
5. **哈希一致性**：`lf` / `crlf` / `bom+crlf` / 裸 `\r` / 混合 / `utf16le` / `latin1` / `>10MB` 流式文件上，整文件读、range 读（含切片）、写路径、磁盘原始字节四者哈希同值。
6. **回归**：既有 `apps/zcode-cli/packages/core/test/*.test.ts` 全绿；`pnpm typecheck`、`apps/zcode-cli` typecheck 全绿。
