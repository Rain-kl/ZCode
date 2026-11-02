import {
  CollaborationConfigSchema,
  SESSION_ENTRY_MODEL_SELECTION,
  parseModelSelectionValue,
  type SessionId,
  type CollaborationConfig,
  type SessionStorePort,
} from "@zcode/contracts";
import { z } from "zod";
import { parseCollaborationSnapshot } from "../codex-collaboration/module.js";
import type { CollaborationSnapshot } from "../codex-collaboration/contract.js";
import { COLLABORATION_SESSION_ENTRY } from "./contract.js";
const envelope = z
  .object({ version: z.literal(1), config: z.unknown(), snapshot: z.unknown() })
  .strict();
export interface CollaborationRootEntry {
  version: 1;
  config: CollaborationConfig;
  snapshot: CollaborationSnapshot;
}
export function parseRootEntry(value: unknown, rootSessionId: string): CollaborationRootEntry {
  const parsed = envelope.parse(value);
  return {
    version: 1,
    config: CollaborationConfigSchema.parse(parsed.config),
    snapshot: parseCollaborationSnapshot(parsed.snapshot, rootSessionId),
  };
}
export async function readCollaborationRootEntry(
  store: SessionStorePort | undefined,
  rootSessionId: string,
): Promise<CollaborationRootEntry | undefined> {
  const entries = await store?.sessionEntries?.({
    sessionID: rootSessionId as SessionId,
    type: COLLABORATION_SESSION_ENTRY,
  });
  const entry = entries?.at(-1);
  return entry ? parseRootEntry(entry.data, rootSessionId) : undefined;
}
export function relationFromSnapshot(snapshot: CollaborationSnapshot, agentId: string) {
  const agent = snapshot.agents.find((candidate) => candidate.agentId === agentId);
  if (!agent || !agent.parentId) return undefined;
  const accepted = snapshot.accepted.find((candidate) => candidate.agentId === agentId);
  const parent = snapshot.agents.find((candidate) => candidate.agentId === agent.parentId);
  if (!accepted || !parent) return undefined;
  return {
    version: 1 as const,
    agentId,
    childSessionId: agent.childSessionId,
    parentId: parent.agentId,
    parentSessionId: parent.childSessionId,
    path: agent.path,
    generation: agent.generation,
    toolCallId: accepted.callId,
    agentType: agent.settings.agentType ?? "general-purpose",
  };
}
/** Identity comes from the graph; the actual model selection stays owned by the child session entry. */
export async function readCollaborationRelation(
  store: SessionStorePort | undefined,
  snapshot: CollaborationSnapshot,
  agentId: string,
) {
  const relation = relationFromSnapshot(snapshot, agentId);
  if (!relation) return undefined;
  const entries = await store?.sessionEntries?.({
    sessionID: relation.childSessionId as SessionId,
    type: SESSION_ENTRY_MODEL_SELECTION,
  });
  const selection = parseModelSelectionValue(entries?.at(-1)?.data);
  return { ...relation, ...(selection ? { modelSelection: selection } : {}) };
}
