/**
 * fork（edit-stale-guard）：内容哈希的唯一定义处。
 *
 * Edit / Write 的「文件自读取后被改过」判据由 mtime+size 代理换成内容哈希后，同一份磁盘字节
 * 必须从**每条读路径和写路径**得到同一个字符串。两边不一致的症状不是「少报一次 stale」，而是
 * 未改动的文件被判 stale 后**永久拒绝写入**——所以算法与 `sha256:` 前缀只在这里出现一次。
 *
 * 读取侧一律哈希「磁盘上的原始字节」，不是解码后再按 utf8 编码的文本：utf16le / latin1 /
 * GBK 这些编码解码再编码会得到与磁盘不同的字节序列，而写路径（encodeTextContent）哈希的是它
 * 写下的字节——那样读到的 hash 与写下的 hash 永远不相等，未改动的文件会被判 stale。原始字节对
 * 任意编码都与写路径一致，也与 fs/index.ts 既有的 readTextFile 口径一致（实测见
 * docs/features/edit-stale-guard/implementation.md 的验证记录）。
 *
 * 上游若自己实现内容哈希判据（或让 range 读取自带 hash），删除本目录与 FEATURES.md 的
 * edit-stale-guard 条目，改用上游实现。见 docs/features/edit-stale-guard/implementation.md。
 */
import { createHash } from "node:crypto";

export interface ContentHash {
  update(chunk: Buffer): void;
  digest(): string;
}

export function createContentHash(): ContentHash {
  const hash = createHash("sha256");
  return {
    update(chunk: Buffer): void {
      hash.update(chunk);
    },
    digest(): string {
      return `sha256:${hash.digest("hex")}`;
    },
  };
}

export function hashBuffer(buffer: Buffer): string {
  const hash = createContentHash();
  hash.update(buffer);
  return hash.digest();
}
