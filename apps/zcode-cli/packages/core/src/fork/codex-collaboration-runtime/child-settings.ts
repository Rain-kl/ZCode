import { z } from "zod";
import { agentProfileSchema, type AgentProfile } from "@zcode/shared";
import type { SessionId, SessionStorePort } from "@zcode/contracts";

const TYPE = "codex_collaboration_child_settings";
const instructionFields = {
  filePath: z.string(),
  fileName: z.string(),
  content: z.string(),
  bytesRead: z.number().nonnegative(),
  sizeBytes: z.number().nonnegative(),
  truncated: z.boolean(),
};
const instructions = z
  .object({
    ...instructionFields,
    sources: z
      .array(z.object({ ...instructionFields, scope: z.enum(["user", "workspace"]) }).strict())
      .optional(),
  })
  .strict();
const schema = z
  .object({
    version: z.literal(1),
    profile: z.custom<AgentProfile>((value) => agentProfileSchema.safeParse(value).success),
    userInstructions: instructions.optional(),
    requiresExecutionContext: z.boolean().optional(),
  })
  .strict();
type ChildSettings = z.infer<typeof schema>;
export async function readChildSettings(
  store: SessionStorePort | undefined,
  sessionId: SessionId,
): Promise<ChildSettings> {
  const entries = await store?.sessionEntries?.({ sessionID: sessionId, type: TYPE });
  const value = entries?.at(-1)?.data;
  if (!value) throw new Error(`Accepted child settings missing for ${sessionId}`);
  return schema.parse(value);
}
export async function saveChildSettings(
  store: SessionStorePort | undefined,
  sessionId: SessionId,
  settings: ChildSettings,
): Promise<void> {
  if (!store) return;
  if (!store.saveSessionEntry)
    throw new Error(`Child settings persistence unsupported for ${sessionId}`);
  const now = Date.now();
  await store.saveSessionEntry({
    id: `${sessionId}:codex-collaboration-settings`,
    sessionID: sessionId,
    type: TYPE,
    touchSession: false,
    time: { created: now, updated: now },
    data: schema.parse(settings),
  });
}
