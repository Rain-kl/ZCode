import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import {
  buildRemoteWorkspaceIdentity,
  buildServerRemoteWorkspaceIdentity,
  remoteHostIdFromWorkspaceIdentity,
  ZCODE_AGENT_PROVIDER,
  type WebRemoteControlWorkspaceBridgeOpenPayload,
} from "@zcode/shared";
import { createProjectService } from "../../services/src/project/index.js";
import { projectStorage } from "../../services/src/project-storage/index.js";
import { runTasksDatabaseMigrations } from "../../services/src/session/tasksDatabase/migrations.js";
import { SourceServerWorkspaceAliasRepo } from "../../services/src/session/sourceServerWorkspaceAliasRepo.js";
import { createSourceServerWorkspaceService } from "../../services/src/source-server-workspace/sourceServerWorkspaceService.js";
import { SourceServerWorkspaceIdentityMapper } from "../../services/src/source-server-workspace/sourceServerWorkspaceIdentityChannelServer.js";
import { createHeadlessRemoteWorkspaceHost } from "../src/fork/cloud-web-access/module.js";

const sourceServerId = "owned-core";
const stableIdentity = (workspacePath: string) =>
  buildServerRemoteWorkspaceIdentity({ serverId: sourceServerId, workspacePath });
const ownerHostId = remoteHostIdFromWorkspaceIdentity(stableIdentity("/"))!;
const request = (
  workspaceKey: string,
  intent: Partial<WebRemoteControlWorkspaceBridgeOpenPayload> = {},
): WebRemoteControlWorkspaceBridgeOpenPayload => ({
  zcode_type: "workspace-bridge-open",
  requestId: randomUUID(),
  bridgeSessionId: randomUUID(),
  workspaceKey,
  ...intent,
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "zcode-headless-host-"));
  const dbPath = join(directory, "tasks-index.sqlite");
  const db = new DatabaseSync(dbPath);
  t.after(async () => {
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  await runTasksDatabaseMigrations(db);
  await runTasksDatabaseMigrations(db, "source-server");
  await projectStorage.migrate(db, { hostId: ownerHostId, backupDirectories: [directory] });
  const repository = projectStorage.repository(db, ownerHostId);
  const projectService = createProjectService({
    repository: async () => repository,
    workspaceDirectory: join(directory, "drafts"),
    ownerHostId,
  });
  const mapper = new SourceServerWorkspaceIdentityMapper();
  const workspaceService = createSourceServerWorkspaceService(
    new SourceServerWorkspaceAliasRepo({
      taskDbPath: dbPath,
      sessionDbPath: join(directory, "absent-cli.sqlite"),
      backupRoot: join(directory, "backups"),
    }),
    {
      defaultWorkspaceIdentity: stableIdentity,
      onResolved({ workspacePath, canonicalWorkspaceKey }) {
        mapper.register({
          stableIdentity: stableIdentity(workspacePath),
          canonicalIdentity: canonicalWorkspaceKey,
        });
      },
    },
  );
  const options = {
    sourceServerId,
    projectService,
    workspaceService,
    fallbackWorkspacePath: directory,
  };
  const host = createHeadlessRemoteWorkspaceHost(options);
  const createProject = async (name: string) => {
    const path = join(directory, name);
    await mkdir(path);
    return projectService.saveProject({ hostId: "local", name, roots: [path] });
  };
  const createTask = (projectId: string, path: string, taskId: string) => {
    const workspaceIdentity = buildRemoteWorkspaceIdentity(path, {
      kind: "ssh",
      host: "fixture.test",
      username: "test",
    });
    const task = { workspacePath: path, workspaceIdentity, taskId };
    repository.reserveCreatedTask({ task, projectId });
    db.prepare(
      "UPDATE tasks SET provider=?,cli_created_at=1,cli_updated_at=2,cli_title='Fixture task' WHERE workspace_key=? AND task_id=?",
    ).run(ZCODE_AGENT_PROVIDER, workspaceIdentity, taskId);
    return task;
  };
  return { directory, db, mapper, host, options, createProject, createTask, projectService };
}

test("empty Server opens a remote host workspace without allocating a task", async (t) => {
  const f = await fixture(t);
  const snapshot = await f.host.listWorkspaces();
  assert.equal(snapshot.activeWorkspaceKey, stableIdentity(f.directory));
  assert.equal(snapshot.workspaces.length, 1);
  const target = snapshot.workspaces[0]!;
  assert.equal(target.kind, "remote");
  assert.equal(target.connectionState, "connected");
  assert.equal(target.workspaceIdentity, stableIdentity(f.directory));
  assert.match(target.remoteSessionId!, /^[a-f0-9-]{36}$/);
  const prepared = await f.host.prepareWorkspace(
    request(target.workspaceIdentity!),
    new AbortController().signal,
  );
  assert.equal(prepared.workspacePath, f.directory);
  assert.equal(prepared.workspaceKey, target.workspaceIdentity);
  assert.equal(prepared.remoteSessionId, target.remoteSessionId);
  assert.equal(prepared.initialTaskId, undefined);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM tasks").get()!.count, 0);
});

test("project navigation prepares the real project and registers stable-to-canonical identities", async (t) => {
  const f = await fixture(t);
  const initial = await f.host.listWorkspaces();
  const project = await f.createProject("project");
  const path = project.roots[0]!.rootPath;
  const task = f.createTask(project.id, path, "session-history");
  const prepared = await f.host.prepareWorkspace(
    request(initial.activeWorkspaceKey!, { project: { projectId: project.id, hostId: "local" } }),
    new AbortController().signal,
  );
  assert.equal(prepared.workspacePath, path);
  assert.equal(prepared.workspaceIdentity, stableIdentity(path));
  assert.equal(prepared.remoteSessionId, initial.workspaces[0]!.remoteSessionId);
  assert.equal(f.mapper.mapIncoming(prepared.workspaceIdentity), task.workspaceIdentity);
  assert.equal(f.mapper.mapOutgoing(task.workspaceIdentity), prepared.workspaceIdentity);
  const snapshot = await f.host.listWorkspaces();
  assert.equal(snapshot.workspaces[0]!.workspaceIdentity, prepared.workspaceIdentity);
  assert.equal(snapshot.workspaces[0]!.kind, "remote");
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM tasks").get()!.count, 1);
  const anotherCore = createHeadlessRemoteWorkspaceHost(f.options);
  assert.notEqual(
    (await anotherCore.listWorkspaces()).workspaces[0]!.remoteSessionId,
    prepared.remoteSessionId,
  );
});

test("listing registers historical task cwd before the first project-tree RPC", async (t) => {
  const f = await fixture(t);
  const removed = await f.createProject("removed-project");
  const oldPath = removed.roots[0]!.rootPath;
  const task = f.createTask(removed.id, oldPath, "session-old");
  await f.projectService.deleteProject(removed.id, ownerHostId);
  const active = await f.createProject("active-project");
  const snapshot = await f.host.listWorkspaces();
  assert.deepEqual(
    snapshot.workspaces.map((item) => item.workspacePath),
    [active.roots[0]!.rootPath],
  );
  const publicTree = f.mapper.mapOutgoing(
    await f.projectService.readTree({ includeDeleted: true }),
  );
  assert.equal(publicTree.tasks[0]!.workspaceIdentity, stableIdentity(oldPath));
  assert.equal(f.mapper.mapIncoming(stableIdentity(oldPath)), task.workspaceIdentity);
  const prepared = await f.host.prepareWorkspace(
    request(stableIdentity(oldPath), { taskId: task.taskId, taskHostId: ownerHostId }),
    new AbortController().signal,
  );
  assert.equal(prepared.workspacePath, oldPath);
  assert.equal(prepared.initialTaskId, task.taskId);
});

test("ordinary attachment project-tree RPC registers projects created after bootstrap", async (t) => {
  const f = await fixture(t);
  const registrations: string[] = [];
  const host = createHeadlessRemoteWorkspaceHost({
    ...f.options,
    workspaceService: {
      ...f.options.workspaceService,
      async resolveWorkspace(input) {
        registrations.push(input.workspacePath);
        return f.options.workspaceService.resolveWorkspace(input);
      },
    },
  });
  await host.listWorkspaces();
  const attachmentProjects = host.projectServiceForAttachment;
  const path = join(f.directory, "created-after-bootstrap");
  await mkdir(path);
  const project = await attachmentProjects.saveProject({
    hostId: "local",
    roots: [path],
    name: "New project",
  });
  const rawTask = f.createTask(project.id, path, "session-after-bootstrap");
  assert.equal(f.mapper.mapIncoming(stableIdentity(path)), stableIdentity(path));

  const tree = await attachmentProjects.readTree({ hostId: "local" });
  const task = tree.tasks.find((item) => item.taskId === rawTask.taskId)!;
  assert.equal(task.workspaceIdentity, stableIdentity(path));
  assert.equal(f.mapper.mapIncoming(task.workspaceIdentity), rawTask.workspaceIdentity);
  const rawTree = await f.projectService.readTree();
  assert.equal(rawTree.tasks[0]!.workspaceIdentity, rawTask.workspaceIdentity);

  // Core 的入站 seam 先把 stable ref 映射回 canonical，装饰器不能改变持库服务的输入语义。
  const directories = await attachmentProjects.resolveSessionDirectories(
    f.mapper.mapIncoming(task),
    "local",
  );
  assert.equal(directories.workspacePath, path);
  assert.equal(directories.workspaceIdentity, stableIdentity(path));
  await attachmentProjects.readTree({ hostId: "local" });
  const prepared = await host.prepareWorkspace(
    request(stableIdentity(path), { taskId: rawTask.taskId, taskHostId: "local" }),
    new AbortController().signal,
  );
  assert.equal(prepared.workspacePath, path);
  assert.deepEqual(registrations, [f.directory, path]);
});

test("existing tasks match exact workspace and host; file-tree navigation does not select a task", async (t) => {
  const f = await fixture(t);
  const first = await f.createProject("first");
  const second = await f.createProject("second");
  f.createTask(first.id, first.roots[0]!.rootPath, "first-session");
  const task = f.createTask(second.id, second.roots[0]!.rootPath, "second-session");
  const prepared = await f.host.prepareWorkspace(
    request(stableIdentity(task.workspacePath), {
      fileTreeTaskId: task.taskId,
      taskHostId: "local",
    }),
    new AbortController().signal,
  );
  assert.equal(prepared.workspacePath, task.workspacePath);
  assert.equal(prepared.initialTaskId, undefined);
  await assert.rejects(
    f.host.prepareWorkspace(
      request(stableIdentity(task.workspacePath), { taskId: "first-session", taskHostId: "local" }),
      new AbortController().signal,
    ),
    /project.task-not-found/,
  );
});

test("foreign hosts and unverified bare workspace keys fail before directory registration", async (t) => {
  const f = await fixture(t);
  const project = await f.createProject("project");
  const path = project.roots[0]!.rootPath;
  const foreignKey = buildServerRemoteWorkspaceIdentity({
    serverId: "other-core",
    workspacePath: path,
  });
  const foreignHost = remoteHostIdFromWorkspaceIdentity(foreignKey)!;
  for (const input of [
    request(stableIdentity(path), { project: { projectId: project.id, hostId: foreignHost } }),
    request(stableIdentity(path), { taskId: "task", taskHostId: foreignHost }),
    request(foreignKey),
    request(stableIdentity(join(f.directory, "unverified"))),
  ]) {
    await assert.rejects(
      f.host.prepareWorkspace(input, new AbortController().signal),
      /host-mismatch|workspace-not-found/,
    );
  }
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM tasks").get()!.count, 0);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM workspace_alias").get()!.count, 0);
});

test("remote drafts require a project and preserve the project service's detailed errors", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.host.prepareWorkspace(
      request(stableIdentity(f.directory), {
        project: { projectId: null, hostId: "local", draftId: randomUUID() },
      }),
      new AbortController().signal,
    ),
    /project.remote-project-required/,
  );
  await assert.rejects(
    f.host.prepareWorkspace(
      request(stableIdentity(f.directory), {
        project: { projectId: "missing-project", hostId: ownerHostId },
      }),
      new AbortController().signal,
    ),
    /project.not-found/,
  );
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM tasks").get()!.count, 0);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM workspace_alias").get()!.count, 0);
});

test("historical orphan and changed-root tasks retain the original remote project policy", async (t) => {
  const f = await fixture(t);
  const project = await f.createProject("project");
  const path = project.roots[0]!.rootPath;
  const task = f.createTask(project.id, path, "session-history");
  const input = request(stableIdentity(path), { taskId: task.taskId, taskHostId: ownerHostId });
  f.db.prepare("UPDATE tasks SET project_id=NULL WHERE task_id=?").run(task.taskId);
  await assert.rejects(
    f.host.prepareWorkspace(input, new AbortController().signal),
    /project.remote-project-required/,
  );
  f.db.prepare("UPDATE tasks SET project_id=? WHERE task_id=?").run(project.id, task.taskId);
  f.db
    .prepare("UPDATE project_roots SET root_path=? WHERE project_id=?")
    .run(join(f.directory, "changed-root"), project.id);
  await assert.rejects(
    f.host.prepareWorkspace(input, new AbortController().signal),
    /project.cwd-not-in-roots/,
  );
  const row = f.db.prepare("SELECT root_path FROM tasks WHERE task_id=?").get(task.taskId)!;
  assert.equal(row.root_path, path);
});

test("cancellation fences a late project preparation before workspace identity registration", async (t) => {
  const f = await fixture(t);
  const project = await f.createProject("project");
  const started = deferred();
  const release = deferred();
  const host = createHeadlessRemoteWorkspaceHost({
    ...f.options,
    projectService: {
      ...f.projectService,
      async prepareSession(params) {
        const result = await f.projectService.prepareSession(params);
        started.resolve();
        await release.promise;
        return result;
      },
    },
  });
  const controller = new AbortController();
  const pending = host.prepareWorkspace(
    request(stableIdentity(f.directory), { project: { projectId: project.id } }),
    controller.signal,
  );
  await started.promise;
  controller.abort();
  release.resolve();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM workspace_alias").get()!.count, 0);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM tasks").get()!.count, 0);
});

test("cancellation after workspace resolution cannot publish a prepared target", async (t) => {
  const f = await fixture(t);
  const project = await f.createProject("project");
  const started = deferred();
  const release = deferred();
  const host = createHeadlessRemoteWorkspaceHost({
    ...f.options,
    workspaceService: {
      ...f.options.workspaceService,
      async resolveWorkspace(input) {
        const result = await f.options.workspaceService.resolveWorkspace(input);
        started.resolve();
        await release.promise;
        return result;
      },
    },
  });
  const controller = new AbortController();
  const pending = host.prepareWorkspace(
    request(stableIdentity(f.directory), { project: { projectId: project.id } }),
    controller.signal,
  );
  await started.promise;
  controller.abort();
  release.resolve();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM tasks").get()!.count, 0);
});
