import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectService } from "../src/project/index.js";

describe("project directory host routing", () => {
  it("maps the local sentinel to the service owner host", async () => {
    const ownerHostId = "remote:server:server-1:/";
    const reads: Array<{ path: string; includeHidden?: boolean }> = [];
    const service = createProjectService({
      repository: async () => ({}) as never,
      workspaceDirectory: "/",
      ownerHostId,
      directories: {
        home: async () => "/home/ubuntu",
        read: async (input) => {
          reads.push(input);
          return [
            {
              name: "projects",
              path: "/home/ubuntu/projects",
              type: "directory",
            },
          ];
        },
      },
    });

    await expect(service.readDirectory({ hostId: "local", path: "/home/ubuntu" })).resolves.toEqual(
      {
        path: "/home/ubuntu",
        entries: [
          {
            name: "projects",
            path: "/home/ubuntu/projects",
            type: "directory",
          },
        ],
      },
    );
    expect(reads).toEqual([{ path: "/home/ubuntu" }]);
  });

  it("persists the owner host when the UI saves a new project with the local sentinel", async () => {
    const directory = await mkdtemp(join(tmpdir(), "project-local-host-"));
    try {
      const ownerHostId = "remote:server:server-1:/";
      let savedHostId: string | undefined;
      const service = createProjectService({
        repository: async () =>
          ({
            saveProject(input: { hostId?: string }) {
              savedHostId = input.hostId;
              return { id: "project-1", hostId: input.hostId, roots: [] };
            },
          }) as never,
        workspaceDirectory: directory,
        ownerHostId,
      });

      await service.saveProject({
        hostId: "local",
        defaultName: "Project",
        roots: [directory],
      });

      expect(savedHostId).toBe(ownerHostId);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
