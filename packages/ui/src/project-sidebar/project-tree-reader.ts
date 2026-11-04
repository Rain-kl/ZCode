import type {
  IProjectService,
  IRemoteProjectService,
  ProjectTree,
} from "@/project-sidebar/contract.js";
import { mergeProjectTrees, resolveEntryProject } from "@/project-sidebar/view.js";
// FORK(cloud-web-access): 比较入口缓存的完整字段，避免慢链路重复写入等价投影。
import { areStabilizedValuesEquivalent } from "@/v4/taskListItemStabilization.js";

/** Host 入口列表是可见集合的权威；网络结果不能恢复已移除的成员实例。 */
export async function readProjectSidebarTree(input: {
  projectService: IProjectService;
  remoteProjectService?: IRemoteProjectService;
}) {
  // FORK-BEGIN(cloud-web-access)
  // 原因：当前 Host 树不依赖入口目录，串行等待会让单 Server 首屏多付一次 RTT。
  const [local, { before, results }] = await Promise.all([
    input.projectService.readTree({
      includeDeleted: true,
      includeDeletedTasks: true,
    }),
    (async () => {
      const before = (await input.remoteProjectService?.readDirectory()) ?? {
        hosts: [],
        entries: [],
      };
      const results = await Promise.allSettled(
        before.hosts.map((host) =>
          input.projectService.readTree({
            hostId: host.id,
            includeDeleted: true,
            includeDeletedTasks: true,
          }),
        ),
      );
      return { before, results };
    })(),
  ]);
  // FORK-END(cloud-web-access)
  const remote = new Map<string, ProjectTree>();
  const errors = new Map<string, string>();
  for (let index = 0; index < results.length; index++) {
    const result = results[index]!;
    const host = before.hosts[index]!;
    if (result.status === "fulfilled") remote.set(host.id, result.value);
    // Bug 原因：读取开始时 Host 未在线，readTree 必然被 route 拒绝（host-offline）；
    // 若读取期间连接完成，这条拒绝会与读取后目录的 online 配对，被展示成“连接失败”。
    // 只记录读取开始时已在线的失败；结束时是否在线由诊断再判断。
    else if (host.connectionStatus === "online") errors.set(host.id, String(result.reason));
  }
  for (const entry of before.entries) {
    const tree = remote.get(entry.hostId);
    const project = tree && resolveEntryProject(entry, tree);
    // FORK-BEGIN(cloud-web-access)
    // 原因：等价缓存每次 refresh 仍推进版本并产生 RPC/目录抖动；内容变化才走原 CAS 写入。
    const unchanged =
      project &&
      entry.projectId === project.id &&
      entry.name === project.name &&
      Boolean(entry.deleted) === project.deleted &&
      areStabilizedValuesEquivalent(entry.roots, project.roots);
    if (project && !unchanged && input.remoteProjectService) {
      await input.remoteProjectService.refreshEntry({
        entryId: entry.id,
        expectedLastSyncedAt: entry.lastSyncedAt,
        project: {
          projectId: project.id,
          name: project.name,
          roots: project.roots,
          deleted: project.deleted,
        },
      });
    }
    // FORK-END(cloud-web-access)
  }
  const directory = (await input.remoteProjectService?.readDirectory()) ?? before;
  for (const [hostId] of remote) {
    const original = before.hosts.find((host) => host.id === hostId);
    if (
      !directory.hosts.some(
        (host) => host.id === hostId && host.membershipId === original?.membershipId,
      )
    )
      remote.delete(hostId);
  }
  return { ...mergeProjectTrees(local, directory, remote), directory, errors };
}
