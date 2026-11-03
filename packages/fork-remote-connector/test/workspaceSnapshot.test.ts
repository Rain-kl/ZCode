import assert from "node:assert/strict";
import { test } from "node:test";
import { buildServerRemoteWorkspaceIdentity } from "@zcode/shared";
import { buildHeadlessWorkspaceSnapshot } from "../src/workspaceSnapshot.js";

test("projects project available primary roots into stable Server identities", () => {
  const result = buildHeadlessWorkspaceSnapshot({
    sourceServerId: "server-a",
    fallbackWorkspacePath: "/fallback",
    projects: [
      {
        id: "p1",
        name: "Alpha",
        deleted: false,
        primaryRootStatus: "available",
        roots: [
          { rootPath: "/srv/other", position: 1, isPrimary: false },
          { rootPath: "/srv/alpha", position: 0, isPrimary: true },
        ],
      },
      {
        id: "p2",
        name: "Missing",
        deleted: false,
        primaryRootStatus: "missing",
        roots: [{ rootPath: "/srv/missing", position: 0, isPrimary: true }],
      },
      {
        id: "p3",
        name: "Deleted",
        deleted: true,
        primaryRootStatus: "available",
        roots: [{ rootPath: "/srv/deleted", position: 0, isPrimary: true }],
      },
    ],
  });
  const identity = buildServerRemoteWorkspaceIdentity({
    serverId: "server-a",
    workspacePath: "/srv/alpha",
  });
  assert.deepEqual(result, {
    workspaces: [
      {
        workspacePath: "/srv/alpha",
        workspaceIdentity: identity,
        label: "Alpha",
        workspacePurpose: "project",
        kind: "local",
      },
    ],
    activeWorkspaceKey: identity,
  });
});

test("uses an explicit fallback only when no project root is available", () => {
  const result = buildHeadlessWorkspaceSnapshot({
    sourceServerId: "server-a",
    fallbackWorkspacePath: "/fallback",
    projects: [],
  });
  const identity = buildServerRemoteWorkspaceIdentity({
    serverId: "server-a",
    workspacePath: "/fallback",
  });
  assert.deepEqual(result, {
    workspaces: [
      {
        workspacePath: "/fallback",
        workspaceIdentity: identity,
        label: "fallback",
        workspacePurpose: "conversation",
        kind: "local",
      },
    ],
    activeWorkspaceKey: identity,
  });
});
