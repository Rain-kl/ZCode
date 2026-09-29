/**
 * WebDAV 同步引擎对外的唯一抽象：**同步引擎不认识任何具体资源**。
 *
 * 引擎只处理「zip 条目名 → 文本」的扁平映射与一个内容哈希；哪些资源要进这个映射、
 * 怎么读写它们，全部由 `webdav-sync/manifest.ts` 的清单声明。
 * 这样新增一个要同步的配置只需要动清单，契约、打包、解包、哈希、引擎都不用改。
 *
 * 见 FEATURES.md 的 local-mode 条目与 docs/features/local-mode/design.md 第 6 节。
 */

export interface SyncSnapshot {
  /** zip 条目名 → 文本。 */
  files: Record<string, string>;
  contentHash: string;
}

export interface SyncSnapshotPort {
  read(): Promise<SyncSnapshot>;
}

export interface SyncSnapshotApplierPort {
  /**
   * 应用远端快照。快照里缺席的资源保持本地不动（旧备份包场景），
   * 这条语义由清单层统一处理，引擎不参与判断。
   */
  apply(snapshot: SyncSnapshot): Promise<void>;
}
