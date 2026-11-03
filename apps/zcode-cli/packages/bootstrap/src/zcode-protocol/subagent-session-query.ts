import { Buffer } from "node:buffer";
import type { ZCodeSessionEndedSubagent, ZCodeSessionRunningSubagent } from "@zcode/shared";
import type { CollaborationChildFact } from "../fork/codex-collaboration-client/contract.js";

// FORK(codex-collaboration): 查询只消费 canonical reader 的事实，不再读取 ACK 或推断 session ID。
export interface SessionSubagentProjection {
  revision: number;
  running: ZCodeSessionRunningSubagent[];
  ended: ZCodeSessionEndedSubagent[];
}
export function projectSessionSubagents(input: {
  revision: number;
  children: readonly CollaborationChildFact[];
}): SessionSubagentProjection {
  const running: ZCodeSessionRunningSubagent[] = [];
  const ended: ZCodeSessionEndedSubagent[] = [];
  for (const child of input.children) {
    const common = {
      agentId: child.agentId,
      childSessionId: child.childSessionId,
      toolCallId: child.parentToolCallId,
      subagentType: child.agentType,
      title: child.path,
    };
    if (child.status === "running") running.push({ ...common, status: "running" });
    else ended.push({ ...common, status: child.status, summary: child.summaryText });
  }
  ended.sort((left, right) => right.childSessionId.localeCompare(left.childSessionId));
  return { revision: input.revision, running, ended };
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function encodeCursor(item: ZCodeSessionEndedSubagent): string {
  return Buffer.from(
    JSON.stringify({ childSessionId: item.childSessionId, endedAt: item.endedAt ?? 0 }),
  ).toString("base64url");
}

function decodeCursor(cursor: string | undefined): {
  childSessionId: string;
  endedAt: number;
} | null {
  if (!cursor) return null;
  try {
    const value = asRecord(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown,
    );
    const childSessionId = nonEmptyString(value.childSessionId);
    const endedAt = value.endedAt;
    return childSessionId && typeof endedAt === "number" ? { childSessionId, endedAt } : null;
  } catch {
    return null;
  }
}

export function paginateEndedSubagents(
  ended: readonly ZCodeSessionEndedSubagent[],
  options: { cursor?: string; limit: number },
): { items: ZCodeSessionEndedSubagent[]; nextCursor?: string } {
  const cursor = decodeCursor(options.cursor);
  const start = cursor
    ? ended.findIndex(
        (item) =>
          (item.endedAt ?? 0) < cursor.endedAt ||
          ((item.endedAt ?? 0) === cursor.endedAt &&
            item.childSessionId.localeCompare(cursor.childSessionId) < 0),
      )
    : 0;
  if (start < 0) return { items: [] };
  const items = ended.slice(start, start + options.limit);
  const last = items.at(-1);
  return {
    items,
    ...(last && start + items.length < ended.length ? { nextCursor: encodeCursor(last) } : {}),
  };
}
