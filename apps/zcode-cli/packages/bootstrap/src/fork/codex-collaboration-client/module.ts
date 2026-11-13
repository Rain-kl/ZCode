import { CollaborationIdentityMetadataSchema, type SessionInfo } from "@zcode/contracts";
import {
  readCollaborationRootEntry,
  readCollaborationRelation,
  relationFromSnapshot,
} from "@zcode/core";
import type { CollaborationChildren, ReadCollaborationChildrenInput } from "./contract.js";
export type * from "./contract.js";

function readIdentity(value: unknown, sessionId: string, callId: string) {
  const result = CollaborationIdentityMetadataSchema.required({
    parentId: true,
    parentSessionId: true,
  }).safeParse(value);
  if (!result.success)
    throw new Error(
      `Invalid collaboration metadata: session ${sessionId}, call ${callId}: ${result.error.message}`,
      { cause: result.error },
    );
  return result.data;
}

/** Read-only canonical graph resolver; never constructs a controller or derives IDs from transcript text. */
export async function readCollaborationChildren(
  input: ReadCollaborationChildrenInput,
): Promise<CollaborationChildren> {
  const chain: SessionInfo[] = [];
  const visited = new Set<string>();
  let current = input.session;
  let entry;
  while (true) {
    if (visited.has(current.id))
      throw new Error(
        `Collaboration parent cycle at ${current.id} (requested ${input.session.id})`,
      );
    visited.add(current.id);
    entry = await readCollaborationRootEntry(input.store, current.id);
    if (entry) break;
    // 普通 UI fork 的 parentID 仅表示正文来源，不表示协作身份继承。
    if (current.taskType !== "subagent_child") {
      if (chain.length)
        throw new Error(
          `Collaboration root entry missing at ${current.id} for child ${input.session.id}`,
        );
      for (const message of input.messages)
        for (const part of message.parts) {
          if (
            part.type !== "tool" ||
            part.tool !== "spawn_agent" ||
            part.sessionID !== input.session.id
          )
            continue;
          const stateMetadata = "metadata" in part.state ? part.state.metadata : undefined;
          for (const metadata of [part.metadata, stateMetadata]) {
            if (!metadata || !("collaboration" in metadata)) continue;
            const identity = readIdentity(metadata.collaboration, input.session.id, part.callID);
            // 普通 fork 可重写 part.sessionID，真实 parentSessionId 仍属于原会话，不能据此收养 child。
            if (identity.parentSessionId !== current.id && current.parentID) continue;
            throw new Error(
              `Collaboration root entry missing at ${current.id}, call ${part.callID}`,
            );
          }
        }
      return { children: [] };
    }
    chain.push(current);
    const parent = current.parentID ? await input.store.getSession(current.parentID) : undefined;
    if (!parent)
      throw new Error(
        `Collaboration parent missing: ${String(current.parentID)} for child ${current.id}`,
      );
    current = parent;
  }
  const snapshot = entry.snapshot;
  for (const child of chain) {
    const record = snapshot.agents.find((agent) => agent.childSessionId === child.id);
    const relation = record && relationFromSnapshot(snapshot, record.agentId);
    if (!relation || relation.parentSessionId !== child.parentID) {
      throw new Error(
        `Collaboration accepted parent mismatch: child ${child.id}, parent ${String(child.parentID)}, root ${current.id}`,
      );
    }
  }
  const children: CollaborationChildren["children"] = [];
  for (const agent of snapshot.agents) {
    const relation = await readCollaborationRelation(input.store, snapshot, agent.agentId);
    if (!relation || relation.parentSessionId !== input.session.id) continue;
    const child = await input.store.getSession(relation.childSessionId as SessionInfo["id"]);
    if (!child || child.taskType !== "subagent_child" || child.parentID !== input.session.id) {
      throw new Error(
        `Collaboration accepted child unavailable: agent ${agent.agentId}, child ${relation.childSessionId}, parent ${input.session.id}`,
      );
    }
    const live = input.getAgentStatus?.(current.id, agent.agentId);
    const status = agent.status === "running" ? (live ?? "interrupted") : agent.status;
    children.push({
      ...relation,
      parentToolCallId: relation.toolCallId,
      status:
        status === "running" || status === "waiting"
          ? "running"
          : status === "errored"
            ? "failed"
            : status === "interrupted"
              ? "cancelled"
              : "success",
      summaryText: agent.lastError ?? agent.path,
    });
  }
  for (const message of input.messages)
    for (const part of message.parts) {
      if (part.type !== "tool" || part.tool !== "spawn_agent") continue;
      const stateMetadata = "metadata" in part.state ? part.state.metadata : undefined;
      for (const metadata of [part.metadata, stateMetadata]) {
        if (!metadata || !("collaboration" in metadata)) continue;
        const identity = readIdentity(metadata.collaboration, input.session.id, part.callID);
        const canonical = children.find((child) => child.toolCallId === part.callID);
        // 普通 fork 已有自身协作树时也可能保留来源正文；仅本图同 call 的错 parent 才构成身份冲突。
        if (identity.parentSessionId !== input.session.id) {
          if (canonical)
            throw new Error(
              `Collaboration metadata parent conflict: session ${input.session.id}, call ${part.callID}`,
            );
          continue;
        }
        if (!canonical)
          throw new Error(
            `Collaboration metadata has no accepted relation: session ${input.session.id}, call ${part.callID}`,
          );
        for (const key of [
          "agentId",
          "childSessionId",
          "parentId",
          "parentSessionId",
          "path",
          "toolCallId",
          "agentType",
        ] as const) {
          if (identity[key] !== canonical[key])
            throw new Error(
              `Collaboration metadata conflict: ${key}, session ${input.session.id}, call ${part.callID}`,
            );
        }
        if (identity.generation > canonical.generation)
          throw new Error(
            `Collaboration metadata generation conflict: session ${input.session.id}, call ${part.callID}`,
          );
      }
    }
  return { rootSessionId: current.id, children };
}
export const codexCollaborationClientModule = {
  id: "codex-collaboration-client",
  provides: ["canonical-collaboration-read-model"],
  requires: [
    "zcode-cli",
    "shared",
    "codex-collaboration-runtime",
    "codex-collaboration-tools-contract",
  ],
} as const;
