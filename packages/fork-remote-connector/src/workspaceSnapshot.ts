import { basename } from "node:path";
import { buildServerRemoteWorkspaceIdentity } from "@zcode/shared";
import type { ForkRemoteWorkspaceSnapshot } from "./contract.js";

interface HeadlessProjectRoot {
  rootPath: string;
  isPrimary: boolean;
}

interface HeadlessProject {
  id: string;
  name: string;
  deleted: boolean;
  primaryRootStatus?: "available" | "missing" | "unavailable";
  roots: readonly HeadlessProjectRoot[];
}

export function buildHeadlessWorkspaceSnapshot(input: {
  sourceServerId: string;
  fallbackWorkspacePath: string;
  projects: readonly HeadlessProject[];
}): ForkRemoteWorkspaceSnapshot {
  const workspaces: ForkRemoteWorkspaceSnapshot["workspaces"] = input.projects.flatMap(
    (project) => {
      if (project.deleted || project.primaryRootStatus !== "available") return [];
      const workspacePath = project.roots.find((root) => root.isPrimary)?.rootPath;
      if (!workspacePath) return [];
      return [
        {
          workspacePath,
          workspaceIdentity: buildServerRemoteWorkspaceIdentity({
            serverId: input.sourceServerId,
            workspacePath,
          }),
          label: project.name,
          workspacePurpose: "project" as const,
          kind: "local" as const,
        },
      ];
    },
  );
  if (workspaces.length === 0) {
    const workspacePath = input.fallbackWorkspacePath;
    workspaces.push({
      workspacePath,
      workspaceIdentity: buildServerRemoteWorkspaceIdentity({
        serverId: input.sourceServerId,
        workspacePath,
      }),
      label: basename(workspacePath) || workspacePath,
      workspacePurpose: "conversation",
      kind: "local",
    });
  }
  return {
    workspaces,
    activeWorkspaceKey: workspaces[0]?.workspaceIdentity ?? workspaces[0]?.workspacePath,
  };
}
