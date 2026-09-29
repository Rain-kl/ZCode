/**
 * fork（edit-stale-guard）：Edit / Write 的「文件自读取后被改过」判据，内容哈希版本。
 *
 * 上游用 mtime + size 作代理，两个方向都会出错（都在旧实现上实测复现过，见
 * docs/features/edit-stale-guard/implementation.md 的验证记录）：
 * 1. 误报：判据里唯一那条「内容没变就不算 stale」的豁免只对**严格整读**（offset≤1 且无 limit）
 *    生效。range Read（offset/limit）的 read-state 条目拿不到这条豁免，于是任何只推进了
 *    mtime/size 的外部动作——格式化器空保存、IDE 保存、git 触碰、同一 workspace 的另一个会话
 *    ——都会判 stale，哪怕磁盘字节一个字都没变。
 * 2. 漏报：判「变了」要求 mtime **严格变大**；mtime 不前进且 size 相同时 edit.ts 直接返回
 *    「没变」且**不比对内容**（write.ts 只对严格整读做最终比对，range 视图同样漏），于是
 *    `cp -p`、`tar -x`、`rsync -t` 这类保留时间戳的写入，以及同一毫秒内的等 size 写入会被放行，
 *    覆盖掉别的进程刚写下的内容。
 *
 * 内容哈希对两个盲区都免疫：同一份字节 ⇒ 同一个 hash（无论 mtime/size 怎么变），字节不同 ⇒
 * 不同 hash（无论 mtime/size 是否变）。判据因此是**字节级**的：只改行尾（CRLF↔LF）或 BOM 的
 * 重写也算 changed——它确实换了磁盘字节，且写路径会按读取时的编码重新编码回写。
 * 任一侧缺 hash（例如 resume 之后从历史 tool part metadata 恢复的 read-state 没有 hash，本
 * fork 不扩该 schema）时返回 unknown，调用方原样回落到上游判据，行为不变。
 *
 * 上游若自己改成内容哈希判据（或让 range 读取带上 hash），删除本文件、两处
 * `FORK-BEGIN(edit-stale-guard)` 接线块与 FEATURES.md 的 edit-stale-guard 条目，改用上游实现。
 * 见 docs/features/edit-stale-guard/design.md 与 implementation.md。
 */
export type StalenessVerdict = "stale" | "fresh" | "unknown";

export function resolveStalenessByContentHash(input: {
  recordedHash?: string;
  currentHash?: string;
}): StalenessVerdict {
  const { recordedHash, currentHash } = input;
  if (!recordedHash || !currentHash) return "unknown";
  return recordedHash === currentHash ? "fresh" : "stale";
}
