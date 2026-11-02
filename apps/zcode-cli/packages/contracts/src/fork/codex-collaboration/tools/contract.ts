import { z } from "zod";
import { modelSelectionSchema } from "@zcode/shared";
import type { ModelSelection } from "../../../model/index.js";
import type { ChildModelExecutionOverride } from "../../../model/invocation-context.js";
import { toToolJsonSchema } from "../../../tools/json-schema.js";
import type { TraceContext } from "../../../tracing/tracer.js";

const text = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "Text must not be blank");
const target = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "Target must not be blank");
export const COLLABORATION_TOOL_NAMES = [
  "spawn_agent",
  "send_message",
  "followup_task",
  "interrupt_agent",
  "list_agents",
  "wait_agent",
] as const;
export type CollaborationToolName = (typeof COLLABORATION_TOOL_NAMES)[number];

export const CollaborationConfigSchema = z
  .object({
    delegationMode: z.enum(["explicit", "proactive"]).default("explicit"),
    maxTotalAgents: z.number().int().positive().default(4),
    maxDepth: z.number().int().positive().default(1),
    maxLoadedChildren: z.number().int().positive().default(3),
  })
  .strict();
export type CollaborationConfig = z.infer<typeof CollaborationConfigSchema>;
export const CollaborationConfigPatchSchema = CollaborationConfigSchema.partial();

export const SpawnAgentInputSchema = z
  .object({
    task_name: z
      .string()
      .min(1)
      .regex(/^[a-z0-9_]+$/)
      .refine((name) => name !== "root", "root is reserved"),
    message: text,
    fork_turns: z.enum(["all", "none"]).default("all"),
    agent_type: z.string().min(1).max(256).optional(),
    model: z.string().min(1).max(512).optional(),
    reasoning_effort: z.string().min(1).max(64).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.fork_turns === "all" &&
      (input.model !== undefined || input.reasoning_effort !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Model and reasoning overrides require fork_turns="none"',
        path: ["fork_turns"],
      });
    }
  });
export const CollaborationSendMessageInputSchema = z.object({ target, message: text }).strict();
export const FollowupTaskInputSchema = z.object({ target, message: text }).strict();
export const InterruptAgentInputSchema = z.object({ target }).strict();
export const ListAgentsInputSchema = z.object({ path_prefix: target.optional() }).strict();
export const WaitAgentInputSchema = z
  .object({ timeout_ms: z.number().int().nonnegative().max(3_600_000).default(30_000) })
  .strict();

export const CollaborationAgentStatusSchema = z.union([
  z.enum(["pending_init", "running", "interrupted", "shutdown", "not_found"]),
  z.object({ completed: z.string().nullable() }).strict(),
  z.object({ errored: z.string() }).strict(),
]);
export type CollaborationAgentStatus = z.infer<typeof CollaborationAgentStatusSchema>;
const emptyOutput = z.object({}).strict();
export const CollaborationToolSchemas = {
  spawn_agent: {
    input: SpawnAgentInputSchema,
    output: z.object({ task_name: z.string().min(1) }).strict(),
  },
  send_message: { input: CollaborationSendMessageInputSchema, output: emptyOutput },
  followup_task: { input: FollowupTaskInputSchema, output: emptyOutput },
  interrupt_agent: {
    input: InterruptAgentInputSchema,
    output: z.object({ previous_status: CollaborationAgentStatusSchema }).strict(),
  },
  list_agents: {
    input: ListAgentsInputSchema,
    output: z
      .object({
        agents: z.array(
          z
            .object({ agent_name: z.string(), agent_status: CollaborationAgentStatusSchema })
            .strict(),
        ),
      })
      .strict(),
  },
  wait_agent: {
    input: WaitAgentInputSchema,
    output: z.object({ message: z.string(), timed_out: z.boolean() }).strict(),
  },
} as const;
export const CollaborationToolJsonSchemas = Object.fromEntries(
  COLLABORATION_TOOL_NAMES.map((name) => [
    name,
    {
      input: toToolJsonSchema(CollaborationToolSchemas[name].input),
      output: toToolJsonSchema(CollaborationToolSchemas[name].output),
    },
  ]),
) as Record<
  CollaborationToolName,
  { input: ReturnType<typeof toToolJsonSchema>; output: ReturnType<typeof toToolJsonSchema> }
>;

export interface CollaborationToolCallContext {
  toolCallId: string;
  signal: AbortSignal;
  traceContext?: TraceContext;
  /** Host-owned, transient execution facts. Never supplied by the model or persisted as credentials. */
  modelSelection?: ModelSelection;
  executionOverride?: ChildModelExecutionOverride;
  /** Private executor projection; never part of the tool output or provider schema. */
  recordIdentity?: (identity: CollaborationIdentityMetadata) => void;
}
export const CollaborationIdentityMetadataSchema = z
  .object({
    version: z.literal(1),
    agentId: z.string().min(1),
    childSessionId: z.string().min(1),
    parentId: z.string().optional(),
    parentSessionId: z.string().optional(),
    path: z.string().min(1),
    generation: z.number().int().nonnegative(),
    toolCallId: z.string().min(1),
    agentType: z.string().min(1),
    modelSelection: z
      .custom<ModelSelection>((value) => modelSelectionSchema.safeParse(value).success)
      .optional(),
  })
  .strict();
export type CollaborationIdentityMetadata = z.infer<typeof CollaborationIdentityMetadataSchema>;
export const CollaborationMessageProvenanceSchema = z
  .object({
    version: z.literal(1),
    messageId: z.string().min(1),
    kind: z.enum(["NEW_TASK", "MESSAGE", "FINAL_ANSWER", "STATUS"]),
    senderId: z.string().min(1),
    recipientId: z.string().min(1),
    senderPath: z.string().min(1),
    recipientPath: z.string().min(1),
  })
  .strict();
export type CollaborationMessageProvenance = z.infer<typeof CollaborationMessageProvenanceSchema>;
/** Bound to one caller by the runtime. Input cannot choose another caller identity. */
export interface CollaborationToolPort {
  spawn(
    input: z.infer<typeof SpawnAgentInputSchema>,
    context: CollaborationToolCallContext,
  ): Promise<z.infer<typeof CollaborationToolSchemas.spawn_agent.output>>;
  send(
    input: z.infer<typeof CollaborationSendMessageInputSchema>,
    context: CollaborationToolCallContext,
  ): Promise<Record<string, never>>;
  followup(
    input: z.infer<typeof FollowupTaskInputSchema>,
    context: CollaborationToolCallContext,
  ): Promise<Record<string, never>>;
  interrupt(
    input: z.infer<typeof InterruptAgentInputSchema>,
    context: CollaborationToolCallContext,
  ): Promise<z.infer<typeof CollaborationToolSchemas.interrupt_agent.output>>;
  list(
    input: z.infer<typeof ListAgentsInputSchema>,
    context: CollaborationToolCallContext,
  ): Promise<z.infer<typeof CollaborationToolSchemas.list_agents.output>>;
  wait(
    input: z.infer<typeof WaitAgentInputSchema>,
    context: CollaborationToolCallContext,
  ): Promise<z.infer<typeof CollaborationToolSchemas.wait_agent.output>>;
}
