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

    await expect(service.readDirectory({ hostId: "local", path: "/home/ubuntu" })).resolves.toEqual({
      path: "/home/ubuntu",
      entries: [
        {
          name: "projects",
          path: "/home/ubuntu/projects",
          type: "directory",
        },
      ],
    });
    expect(reads).toEqual([{ path: "/home/ubuntu" }]);
  });
});
