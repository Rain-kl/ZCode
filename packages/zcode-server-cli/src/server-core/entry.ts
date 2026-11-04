// FORK(local-mode): 独立子进程入口必须先安装上游网络门禁。
import "@zcode/shared/upstream-network-policy/node";
import { runServerCore } from "./core.js";
// FORK-BEGIN(cloud-web-access): Core 与 Supervisor 写入同一 canonical 实例日志。
import { installPersistentServerLogger } from "../fork/cloud-web-access/module.js";
import { resolveCanonicalServerLayout } from "../runtime/paths.js";
// FORK-END(cloud-web-access)

const generation = Number(process.argv[2] ?? 0);
// FORK-BEGIN(cloud-web-access): Core 与 Supervisor 共用 canonical 实例日志，失败退出前先冲刷。
const disposePersistentLogger = await installPersistentServerLogger(
  await resolveCanonicalServerLayout(process.env.ZCODE_SERVER_ROOT),
);
void runServerCore(generation, disposePersistentLogger).catch((error: unknown) => {
  // 与 core.ts 的 shutdown 路径同理——启动失败往往发生在服务已部分初始化
  // 之后（SQLite、interval 等仍持有事件循环 handle），仅设置 exitCode 会让进程
  // 挂着不退出；Supervisor 收不到 exit 事件就不会走崩溃退避，状态永久卡在 starting。
  // fatal 消息发出（或无 IPC 通道）后必须显式退出。
  const exit = (): void => {
    void disposePersistentLogger().finally(() => process.exit(1));
  };
  if (typeof process.send !== "function" || process.connected === false) {
    exit();
    return;
  }
  try {
    process.send(
      { type: "fatal", message: error instanceof Error ? error.message : String(error) },
      exit,
    );
  } catch {
    // 父进程可能在启动失败的同时断开 IPC，不能等待一个永远不会到达的 fatal callback。
    exit();
  }
});
// FORK-END(cloud-web-access)
