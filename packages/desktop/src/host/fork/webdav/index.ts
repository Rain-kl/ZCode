/**
 * fork WebDAV 备份恢复服务的公开入口（host 装配用）。
 * 见 FEATURES.md 的 local-mode 条目与 docs/features/local-mode/design.md。
 */
export {
  createForkWebdavService,
  type CreateForkWebdavServiceOptions,
  type ForkWebdavCredentialStore,
  type ForkWebdavServiceHandle,
} from "./service.js";
