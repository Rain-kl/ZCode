import { describe, expect, it } from "vitest";
import type { SessionInfo, SessionStorePort } from "@zcode/contracts";
import { readCollaborationChildren } from "../src/fork/codex-collaboration-client/module.js";

const root = {
  agentId: "root-agent",
  childSessionId: "root-session",
  path: "/root",
  traceId: "trace",
  settings: { forkTurns: "all" },
  status: "idle",
  generation: 0,
  mailbox: [],
};
const child = {
  ...root,
  agentId: "agent-opaque-a7",
  childSessionId: "session-random-f91",
  parentId: root.agentId,
  path: "/root/worker",
  status: "running",
  generation: 2,
};
const envelope = {
  version: 1,
  config: { maxDepth: 3, maxTotalAgents: 8 },
  snapshot: {
    version: 1,
    rootSessionId: root.childSessionId,
    agents: [root, child],
    accepted: [
      { callerId: root.agentId, callId: "spawn-call-6", fingerprint: "fp", agentId: child.agentId },
    ],
  },
};
function fixture() {
  const sessions = new Map<string, SessionInfo>([
    [root.childSessionId, info(root.childSessionId)],
    [child.childSessionId, info(child.childSessionId, root.childSessionId, "subagent_child")],
  ]);
  const entries = new Map([[root.childSessionId, envelope]]);
  const store = {
    getSession: async (id: string) => sessions.get(id),
    sessionEntries: async (query: { sessionID: string; type?: string }) =>
      query.type === "codex_collaboration" && entries.has(query.sessionID)
        ? [{ data: entries.get(query.sessionID) }]
        : [],
  } as unknown as SessionStorePort;
  return { store, sessions, entries };
}
function info(id: string, parentID?: string, taskType?: SessionInfo["taskType"]): SessionInfo {
  return {
    id,
    parentID,
    taskType,
    projectID: "p",
    slug: id,
    directory: "/workspace",
    title: id,
    version: "test",
    time: { created: 1, updated: 2 },
  } as SessionInfo;
}
describe("canonical client query", () => {
  it("recovers accepted-before-tool-result with unrelated opaque identity and no fabricated completion", async () => {
    const f = fixture();
    const model = await readCollaborationChildren({
      store: f.store,
      session: f.sessions.get(root.childSessionId)!,
      messages: [],
      getAgentStatus: () => "running",
    });
    expect(model.children).toMatchObject([
      {
        agentId: child.agentId,
        childSessionId: child.childSessionId,
        parentToolCallId: "spawn-call-6",
        generation: 2,
        status: "running",
      },
    ]);
  });
  it("does not advertise cold saved running as an active execution", async () => {
    const f = fixture();
    const model = await readCollaborationChildren({
      store: f.store,
      session: f.sessions.get(root.childSessionId)!,
      messages: [],
    });
    expect(model.children).toMatchObject([{ status: "cancelled" }]);
  });
  it("ordinary UI fork never adopts source children", async () => {
    const f = fixture();
    const fork = info("ordinary-fork", root.childSessionId);
    f.sessions.set(fork.id, fork);
    expect(
      (await readCollaborationChildren({ store: f.store, session: fork, messages: [] })).children,
    ).toEqual([]);
  });
  it("validates the accepted parent edge while walking a real child", async () => {
    const f = fixture();
    expect(
      (
        await readCollaborationChildren({
          store: f.store,
          session: f.sessions.get(child.childSessionId)!,
          messages: [],
        })
      ).rootSessionId,
    ).toBe(root.childSessionId);
    f.sessions.set(
      child.childSessionId,
      info(child.childSessionId, "missing-parent", "subagent_child"),
    );
    await expect(
      readCollaborationChildren({
        store: f.store,
        session: f.sessions.get(child.childSessionId)!,
        messages: [],
      }),
    ).rejects.toThrow(/missing-parent/);
  });
  it("rejects cycles explicitly", async () => {
    const f = fixture();
    const cycle = info("cycle", "cycle", "subagent_child");
    f.sessions.set(cycle.id, cycle);
    await expect(
      readCollaborationChildren({ store: f.store, session: cycle, messages: [] }),
    ).rejects.toThrow(/cycle/);
  });
  it("walks real nested children but returns only accepted direct descendants", async () => {
    const f = fixture();
    const grandchild = {
      ...child,
      agentId: "agent-grandchild",
      childSessionId: "opaque-grandchild",
      parentId: child.agentId,
      path: "/root/worker/nested",
    };
    f.sessions.set(
      grandchild.childSessionId,
      info(grandchild.childSessionId, child.childSessionId, "subagent_child"),
    );
    f.entries.set(root.childSessionId, {
      ...envelope,
      snapshot: {
        ...envelope.snapshot,
        agents: [...envelope.snapshot.agents, grandchild],
        accepted: [
          ...envelope.snapshot.accepted,
          {
            callerId: child.agentId,
            callId: "nested-spawn",
            fingerprint: "nested-fp",
            agentId: grandchild.agentId,
          },
        ],
      },
    });
    expect(
      (
        await readCollaborationChildren({
          store: f.store,
          session: f.sessions.get(child.childSessionId)!,
          messages: [],
        })
      ).children,
    ).toMatchObject([
      {
        agentId: grandchild.agentId,
        childSessionId: grandchild.childSessionId,
        parentToolCallId: "nested-spawn",
      },
    ]);
    expect(
      (
        await readCollaborationChildren({
          store: f.store,
          session: f.sessions.get(grandchild.childSessionId)!,
          messages: [],
        })
      ).rootSessionId,
    ).toBe(root.childSessionId);
  });
});

function spawnMessage(identity: unknown) {
  return [
    {
      info: { id: "a", role: "assistant" },
      parts: [
        {
          type: "tool",
          tool: "spawn_agent",
          callID: "spawn-call-6",
          sessionID: "root-session",
          state: {
            status: "completed",
            input: { task_name: "worker" },
            output: '{"task_name":"/root/worker"}',
            metadata: { collaboration: identity },
          },
        },
      ],
    },
  ] as unknown as import("@zcode/contracts").MessageWithParts[];
}
const relation = {
  version: 1,
  agentId: child.agentId,
  childSessionId: child.childSessionId,
  parentId: root.agentId,
  parentSessionId: root.childSessionId,
  path: child.path,
  generation: 1,
  toolCallId: "spawn-call-6",
  agentType: "general-purpose",
};
it("validates state.metadata with exact canonical identity and accepts old spawn generation after followup", async () => {
  const f = fixture();
  expect(
    (
      await readCollaborationChildren({
        store: f.store,
        session: f.sessions.get(root.childSessionId)!,
        messages: spawnMessage(relation),
        getAgentStatus: () => "running",
      })
    ).children,
  ).toHaveLength(1);
  for (const bad of [
    { ...relation, childSessionId: "guessed-session" },
    { ...relation, path: "/root/other" },
    { ...relation, generation: 3 },
    { ...relation, invented: true },
    { ...relation, parentSessionId: undefined },
  ]) {
    await expect(
      readCollaborationChildren({
        store: f.store,
        session: f.sessions.get(root.childSessionId)!,
        messages: spawnMessage(bad),
      }),
    ).rejects.toThrow();
  }
  await expect(
    readCollaborationChildren({
      store: f.store,
      session: f.sessions.get(root.childSessionId)!,
      messages: spawnMessage({ ...relation, invented: true }),
    }),
  ).rejects.toThrow(/root-session.*spawn-call-6/);
});
it("diagnoses private metadata without canonical root authority", async () => {
  const f = fixture();
  f.entries.clear();
  await expect(
    readCollaborationChildren({
      store: f.store,
      session: f.sessions.get(root.childSessionId)!,
      messages: spawnMessage(relation),
    }),
  ).rejects.toThrow(/root.*missing/i);
});
it("uses exact live child status, never a running sibling or historical model completion", async () => {
  const f = fixture();
  expect(
    (
      await readCollaborationChildren({
        store: f.store,
        session: f.sessions.get(root.childSessionId)!,
        messages: [],
        getAgentStatus: (_rootId, agentId) => (agentId === child.agentId ? "errored" : "running"),
      })
    ).children,
  ).toMatchObject([{ status: "failed" }]);
});
it("filters copied foreign metadata in an ordinary fork even when storage rewrites part.sessionID", async () => {
  const f = fixture();
  const fork = info("ordinary-fork", root.childSessionId);
  f.sessions.set(fork.id, fork);
  const messages = spawnMessage(relation);
  for (const message of messages) for (const part of message.parts) part.sessionID = fork.id;
  expect(
    (await readCollaborationChildren({ store: f.store, session: fork, messages })).children,
  ).toEqual([]);
});
it("keeps a fork's own collaboration tree separate from copied source spawn metadata", async () => {
  const f = fixture();
  const fork = info("ordinary-fork", root.childSessionId);
  f.sessions.set(fork.id, fork);
  const ownRoot = { ...root, agentId: "fork-root-agent", childSessionId: fork.id };
  const ownChild = {
    ...child,
    agentId: "fork-agent",
    childSessionId: "fork-child",
    parentId: ownRoot.agentId,
    path: "/root/own",
  };
  f.sessions.set(ownChild.childSessionId, info(ownChild.childSessionId, fork.id, "subagent_child"));
  f.entries.set(fork.id, {
    ...envelope,
    snapshot: {
      version: 1,
      rootSessionId: fork.id,
      agents: [ownRoot, ownChild],
      accepted: [
        {
          callerId: ownRoot.agentId,
          callId: "own-spawn-call",
          fingerprint: "own-fp",
          agentId: ownChild.agentId,
        },
      ],
    },
  });
  const messages = spawnMessage(relation);
  for (const message of messages) for (const part of message.parts) part.sessionID = fork.id;
  expect(
    (await readCollaborationChildren({ store: f.store, session: fork, messages })).children,
  ).toMatchObject([{ agentId: ownChild.agentId, childSessionId: ownChild.childSessionId }]);
});
it("diagnoses a private parent conflicting with an accepted canonical spawn", async () => {
  const f = fixture();
  await expect(
    readCollaborationChildren({
      store: f.store,
      session: f.sessions.get(root.childSessionId)!,
      messages: spawnMessage({ ...relation, parentSessionId: "foreign-parent" }),
    }),
  ).rejects.toThrow(/parent.*conflict|conflict.*parent/i);
});
