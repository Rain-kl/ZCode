import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  IProjectService,
  IRemoteProjectService,
  ProjectTree,
  RemoteProjectDirectory,
} from "@zcode/services";
import { readProjectSidebarTree } from "../src/project-sidebar/project-tree-reader.js";

test("current Host tree starts while the directory RPC is still in flight", async () => {
  let release!: (directory: RemoteProjectDirectory) => void;
  const directory = new Promise<RemoteProjectDirectory>((resolve) => {
    release = resolve;
  });
  let localReads = 0;
  const flight = readProjectSidebarTree({
    projectService: {
      async readTree() {
        localReads++;
        return { projects: [], tasks: [] };
      },
    } as unknown as IProjectService,
    remoteProjectService: {
      readDirectory: () => directory,
    } as unknown as IRemoteProjectService,
  });
  try {
    assert.equal(localReads, 1, "independent reads must not add another network round trip");
  } finally {
    release({ hosts: [], entries: [] });
    await flight;
  }
});

test("unchanged remote project cache needs no refresh RPC; changed metadata keeps the CAS version", async () => {
  const project = {
    id: "project",
    hostId: "host",
    name: "Project",
    roots: [{ rootPath: "/workspace", position: 0, isPrimary: true }],
    deleted: false,
  };
  const entry = {
    id: "entry",
    hostId: "host",
    projectId: project.id,
    name: project.name,
    roots: project.roots,
    lastSyncedAt: 7,
    legacyWorkspace: null,
  };
  const directory = {
    hosts: [{ id: "host", membershipId: "member", connectionStatus: "online" }],
    entries: [entry],
  } as RemoteProjectDirectory;
  const refreshes: Parameters<IRemoteProjectService["refreshEntry"]>[0][] = [];
  const input = {
    projectService: {
      async readTree(params?: { hostId?: string }) {
        return {
          projects: params?.hostId ? [project] : [],
          tasks: [],
        } as ProjectTree;
      },
    } as unknown as IProjectService,
    remoteProjectService: {
      async readDirectory() {
        return directory;
      },
      async refreshEntry(input: Parameters<IRemoteProjectService["refreshEntry"]>[0]) {
        refreshes.push(input);
      },
    } as unknown as IRemoteProjectService,
  };
  await readProjectSidebarTree(input);
  assert.equal(refreshes.length, 0);
  project.name = "Renamed";
  await readProjectSidebarTree(input);
  assert.equal(refreshes.length, 1);
  assert.equal(refreshes[0]!.expectedLastSyncedAt, 7);
  assert.equal(refreshes[0]!.project.name, "Renamed");
});
