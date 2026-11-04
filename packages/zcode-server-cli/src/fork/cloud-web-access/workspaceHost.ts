import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { ForkRemoteWorkspaceSnapshot } from "@zcode/fork-remote-connector";
import type { ProjectTree } from "@zcode/services";
import {
  bindRemoteProjectIdentities,
  createRemoteIdentityRegistrationCache,
} from "@zcode/services/node";
import {
  buildServerRemoteWorkspaceIdentity,
  remoteHostIdFromWorkspaceIdentity,
} from "@zcode/shared";
import type {
  HeadlessRemoteWorkspaceHost,
  HeadlessRemoteWorkspaceHostOptions,
} from "./contract.js";

export function createHeadlessRemoteWorkspaceHost(
  options: HeadlessRemoteWorkspaceHostOptions,
): HeadlessRemoteWorkspaceHost {
  const remoteSessionId = randomUUID();
  const identityFor = (workspacePath: string) =>
    buildServerRemoteWorkspaceIdentity({ serverId: options.sourceServerId, workspacePath });
  const ownerHostId = remoteHostIdFromWorkspaceIdentity(identityFor("/"))!;
  const assertOwner = (hostId?: string) => {
    if (hostId && hostId !== "local" && hostId !== ownerHostId)
      throw new Error(`project.host-mismatch: requested ${hostId}; owner ${ownerHostId}`);
  };
  const readTree = () =>
    options.projectService.readTree({ hostId: ownerHostId, includeDeleted: true });
  const targetFor = (workspacePath: string) => ({
    workspacePath,
    workspaceIdentity: identityFor(workspacePath),
    remoteSessionId,
  });
  const snapshotFor = (tree: ProjectTree): ForkRemoteWorkspaceSnapshot => {
    const workspaces: ForkRemoteWorkspaceSnapshot["workspaces"] = tree.projects.flatMap(
      (project) => {
        if (
          project.hostId !== ownerHostId ||
          project.deleted ||
          project.primaryRootStatus !== "available"
        )
          return [];
        const workspacePath = project.roots.find((root) => root.isPrimary)?.rootPath;
        if (!workspacePath) return [];
        return [
          {
            ...targetFor(workspacePath),
            projectId: project.id,
            label: project.name,
            workspacePurpose: "project" as const,
            kind: "remote" as const,
            connectionState: "connected" as const,
          },
        ];
      },
    );
    if (!workspaces.length) {
      const workspacePath = options.fallbackWorkspacePath;
      workspaces.push({
        ...targetFor(workspacePath),
        label: basename(workspacePath) || workspacePath,
        workspacePurpose: "conversation",
        kind: "remote",
        connectionState: "connected",
      });
    }
    return { workspaces, activeWorkspaceKey: workspaces[0]?.workspaceIdentity };
  };
  const registerIdentity = createRemoteIdentityRegistrationCache();
  const resolveIdentity = (workspacePath: string) =>
    registerIdentity(options.workspaceService, workspacePath, async () => {
      // 浏览器持有 stable 身份；必须先让既有服务登记 canonical 映射，再创建 attachment。
      await options.workspaceService.resolveWorkspace({
        workspacePath,
        legacyRouteHint: identityFor(workspacePath),
      });
      return identityFor(workspacePath);
    });
  const projectServiceForAttachment = bindRemoteProjectIdentities(
    options.projectService,
    resolveIdentity,
  );
  const resolveWorkspace = async (workspacePath: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    await resolveIdentity(workspacePath);
    signal?.throwIfAborted();
    const target = targetFor(workspacePath);
    return { ...target, workspaceKey: target.workspaceIdentity };
  };

  return {
    projectServiceForAttachment,
    async listWorkspaces() {
      // 共享既有装饰器，首次和后续项目树 RPC 都在发布目录之前完成登记。
      const tree = await projectServiceForAttachment.readTree({
        hostId: ownerHostId,
        includeDeleted: true,
      });
      const snapshot = snapshotFor(tree);
      await Promise.all(
        snapshot.workspaces.map((workspace) => resolveWorkspace(workspace.workspacePath)),
      );
      return snapshot;
    },
    async prepareWorkspace(request, signal) {
      signal.throwIfAborted();
      try {
        assertOwner(request.project?.hostId);
        assertOwner(request.taskHostId);
        const taskId = request.fileTreeTaskId ?? request.taskId;
        if (
          (request.project && taskId) ||
          (request.taskId && request.fileTreeTaskId && request.taskId !== request.fileTreeTaskId)
        )
          throw new Error("project.ambiguous-navigation");
        if (request.project) {
          const directories = await options.projectService.prepareSession({
            hostId: ownerHostId,
            ...(request.project.projectId ? { projectId: request.project.projectId } : {}),
            ...(request.project.draftId ? { draftId: request.project.draftId } : {}),
            ...(request.project.reuseDraft !== undefined
              ? { reuseDraft: request.project.reuseDraft }
              : {}),
          });
          signal.throwIfAborted();
          return await resolveWorkspace(directories.workspacePath, signal);
        }
        const tree = await readTree();
        signal.throwIfAborted();
        if (taskId) {
          // 任务导航必须同时绑定 owner、任务和 workspace，不能按任务 ID 或路径猜项目。
          const task = tree.tasks.find(
            (item) =>
              item.hostId === ownerHostId &&
              item.taskId === taskId &&
              identityFor(item.workspacePath) === request.workspaceKey,
          );
          if (!task) throw new Error("project.task-not-found");
          const directories = await options.projectService.resolveSessionDirectories(
            task,
            ownerHostId,
          );
          signal.throwIfAborted();
          if (directories.workspacePath !== task.workspacePath)
            throw new Error("project.task-directory-mismatch");
          return {
            ...(await resolveWorkspace(directories.workspacePath, signal)),
            ...(request.taskId ? { initialTaskId: request.taskId } : {}),
          };
        }
        const target = snapshotFor(tree).workspaces.find(
          (workspace) => workspace.workspaceIdentity === request.workspaceKey,
        );
        if (!target) throw new Error("project.workspace-not-found");
        // 初始 workspace 只用于进入宿主 UI；目录准备和会话分配仍须显式项目意图。
        return await resolveWorkspace(target.workspacePath, signal);
      } catch (error) {
        signal.throwIfAborted();
        throw new Error(
          `Server workspace navigation failed (workspace ${request.workspaceKey}, project ${request.project?.projectId ?? "none"}, task ${request.fileTreeTaskId ?? request.taskId ?? "none"}, host ${ownerHostId}): ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    },
  };
}
