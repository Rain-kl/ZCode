/**
 * WebDAV 同步的业务侧（fork）：清单 + 按清单读写快照。
 * WebDAV 引擎本身不认识这里的任何资源。见 manifest.ts 的说明。
 */
export * from "./manifest.js";
export * from "./snapshot.js";
