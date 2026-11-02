import {
  SESSION_ENTRY_MODEL_SELECTION,
  parseModelSelectionValue,
  type SessionId,
  type TraceContext,
  type ModelSelection,
  type CollaborationConfig,
  type CollaborationIdentityMetadata,
  type CollaborationToolCallContext,
} from "@zcode/contracts";
import type { AgentProfile } from "../../subagent/profile.js";
import { AgentRuntime } from "../../runtime/agent-runtime.js";
import type { AgentRuntimeInternal } from "../../runtime/internal.js";
import type { AgentRuntimeDeps } from "../../runtime/types.js";
import type { AgentIdentity } from "../codex-collaboration/contract.js";
import type { RuntimeCollaborationBinding, PreparedChildRequest } from "./contract.js";
import { readChildSettings, saveChildSettings } from "./child-settings.js";
import { buildExploreAgentPrompt } from "../../subagent/explore.js";
import { isBuiltInExploreAgentProfile } from "../../subagent/profile.js";
import { buildExploreAllowedTools } from "../../subagent/explore-tools.js";
import { createOfficialCuaPolicy } from "../../subagent/computer-use-policy.js";
import { loadPersistentAgentMemory } from "../../subagent/persistent-memory.js";
import { computeOfficialCuaServerNames } from "../../runtime/methods/mcp.js";
import { getSessionShellEnvironment } from "../../runtime/methods/session-shell-environment.js";
import { resolveRuntimeEmbeddedSearchEnabled } from "../../runtime/methods/embedded-search-branch.js";
import { deriveChildClientPorts } from "../../runtime/helpers/child-client-ports.js";
import {
  resolveSubagentMcpAccess,
  validateSubagentMcpRequirements,
  validateSubagentComputerUseConfiguration,
  resolveSubagentToolAllowlist,
  resolveSubagentSkillPort,
  resolveSubagentPermissionMode,
} from "./prepared-child-policy.js";
import { toMcpToolName } from "../../mcp/index.js";
import { forkCompletedHistory } from "./fork-history.js";
import { readMailboxReceipt } from "./mailbox.js";
import { resolveSubagentSelection } from "../../runtime/helpers/subagent-selection.js";
import { getOffPeakModelBinding } from "../../runtime/off-peak/model-binding.js";
import { childEventSink } from "./child-events.js";
export async function prepareChild(
  parent: AgentRuntimeInternal,
  deps: AgentRuntimeDeps,
  identity: AgentIdentity,
  config: CollaborationConfig,
  resume: boolean,
  binding: (runtime: AgentRuntimeInternal) => RuntimeCollaborationBinding,
  relation: () => CollaborationIdentityMetadata | undefined,
  execution?: CollaborationToolCallContext,
) {
  const profiles = parent.getAgentDefinitions().activeAgents;
  const agentType = identity.settings.agentType ?? "general-purpose";
  const savedSettings = resume
    ? await readChildSettings(parent.sessionStore, identity.childSessionId as SessionId)
    : undefined;
  const profile = resume
    ? savedSettings?.profile
    : profiles.find((candidate) => candidate.name === agentType);
  if (!profile)
    throw new Error(
      `Unknown agent_type ${agentType}; available profiles: ${profiles.map((p) => p.name).join(", ")}`,
    );
  const sessionId = identity.childSessionId as SessionId;
  let selection: ModelSelection | undefined;
  let persistedMessages:
    | Awaited<ReturnType<NonNullable<AgentRuntimeDeps["sessionStore"]>["messages"]>>
    | undefined;
  if (resume) {
    persistedMessages = await parent.sessionStore?.messages({ sessionID: sessionId });
    try {
      if (
        !persistedMessages?.some(
          (message) => readMailboxReceipt(message, identity)?.kind === "NEW_TASK",
        )
      )
        throw new Error("Initial NEW_TASK receipt missing");
      for (const message of persistedMessages) readMailboxReceipt(message, identity);
    } catch (cause) {
      throw new Error(
        `Accepted child transcript missing or incomplete for ${identity.path} (${sessionId})`,
        { cause },
      );
    }
    const entries = await parent.sessionStore?.sessionEntries?.({
      sessionID: sessionId,
      type: SESSION_ENTRY_MODEL_SELECTION,
    });
    selection = parseModelSelectionValue(entries?.at(-1)?.data);
    if (!selection)
      throw new Error(`Saved child model selection missing for ${identity.path} (${sessionId})`);
    if (
      savedSettings?.requiresExecutionContext &&
      (!execution?.executionOverride ||
        JSON.stringify(execution.executionOverride.selection) !== JSON.stringify(selection))
    )
      throw new Error(
        `Execution context required to restore ${identity.path} with saved model ${selection.providerId}/${selection.modelId}; no matching active host execution material`,
      );
  } else {
    selection = resolveChildSelection(parent, deps, identity, profile, execution);
  }
  const traceContext: TraceContext = {
    ...parent.rootTraceContext,
    traceId: identity.traceId as TraceContext["traceId"],
    sessionId,
  };
  const builtInExplore = isBuiltInExploreAgentProfile(profile);
  const embedded = resolveRuntimeEmbeddedSearchEnabled(parent);
  const request: PreparedChildRequest = {
    agentId: identity.agentId,
    agentType,
    sessionId,
    profile,
    allowedTools: builtInExplore
      ? buildExploreAllowedTools({ embeddedSearchEnabled: embedded })
      : [...(profile.tools ?? ["*"]), ...(profile.skills?.length ? ["Skill"] : [])],
    disallowedTools: profile.disallowedTools,
    permissionMode: profile.permissionMode,
    workingDirectory: parent.workingDirectory,
    workspaceRoot: parent.workspaceRoot,
    traceContext,
  };
  const officialServers = computeOfficialCuaServerNames(
    parent.config.mcp?.servers ?? {},
    new Set(parent.config.mcp?.trustedOfficialCuaServerNames ?? []),
  );
  const access = await resolveSubagentMcpAccess.call(parent, request, officialServers);
  const cua = createOfficialCuaPolicy(
    officialServers,
    access.parentSnapshot?.tools ?? access.snapshot?.tools ?? [],
    parent.config.pluginReferenceCatalog,
  );
  await validateSubagentComputerUseConfiguration(request, cua, parent.skillPort);
  let allowlist = resolveSubagentToolAllowlist.call(
    parent,
    request,
    access.snapshot?.tools.map(toMcpToolName) ?? [],
  );
  validateSubagentMcpRequirements(request, allowlist, access);
  if (identity.path.split("/").length - 2 >= config.maxDepth)
    allowlist = allowlist.filter((name) => name !== "spawn_agent");
  const memory = await loadPersistentAgentMemory({
    fileSystemPort: deps.fileSystemPort,
    memory: parent.config.memory,
    logger: parent.logger,
    profile,
    traceContext,
    workspaceRoot: parent.workspaceRoot,
  });
  const prompt = [
    builtInExplore
      ? buildExploreAgentPrompt({ embeddedSearchEnabled: embedded })
      : profile.systemPrompt,
    memory?.prompt,
  ]
    .filter(Boolean)
    .join("\n\n");
  const mode = resolveSubagentPermissionMode(
    parent.getPlanEnabled() ? "plan" : parent.config.mode,
    profile.permissionMode,
    builtInExplore,
  );
  const ports = deriveChildClientPorts(
    {
      permissionBroker: parent.permissionBroker,
      providerRuntimeHeadersPort: parent.providerRuntimeHeadersPort,
    },
    {
      agentId: identity.agentId,
      agentType,
      childSessionId: sessionId,
      description: identity.path,
      parentSessionId: parent.sessionId,
      get parentToolCallId() {
        return relation()?.toolCallId;
      },
    },
  );
  const browser =
    parent.browserControlPort?.forChildSession?.({
      childSessionId: sessionId,
      parentSessionId: parent.sessionId,
      tabOwner: "parent",
    }) ?? parent.browserControlPort;
  const userInstructions = resume
    ? savedSettings?.userInstructions
    : profile.injectAgentsMd !== false
      ? parent.contextSourceSnapshot?.userInstructions
      : undefined;
  const shell = getSessionShellEnvironment(parent);
  const envInfo = {
    ...(parent.contextSourceSnapshot?.envInfo ??
      parent.config.envInfo ?? {
        cwd: parent.workingDirectory,
        platform: "unknown",
        shell: "unknown",
        osVersion: "unknown",
        nodeVersion: "unknown",
      }),
    cwd: parent.workingDirectory,
    ...(shell ? { shell: shell.promptShell } : {}),
  };
  const runtime = new AgentRuntime(
    sessionId,
    {
      ...parent.config,
      mode: mode === "plan" ? parent.config.mode : mode,
      planEnabled: mode === "plan",
      parentSessionId: parent.sessionId,
      taskType: "subagent_child",
      modelSelection: selection,
      agentName: `zcode-${agentType}`,
      maxTurns: profile.maxTurns ?? parent.config.subagents?.maxTurns ?? parent.config.maxTurns,
      toolset: builtInExplore ? "explore" : "main",
      toolAllowlist: allowlist,
      subagents: { ...parent.config.subagents, ...config },
      subagentContext: { agentPrompt: prompt, ...(userInstructions ? { userInstructions } : {}) },
      systemPrompt: undefined,
      bashShellSelection: getSessionShellEnvironment(parent)?.selection,
      envInfo,
      mcp: access.config,
      dynamicWorkflowToolsOnDemand:
        parent.config.dynamicWorkflowToolsOnDemand === true &&
        !parent.dynamicWorkflowToolsActivated,
    },
    {
      ...deps,
      // 父轮次发布的目录冻结到 child；child 不能重新加载 Host 并污染已接受角色的上下文。
      getAgentDefinitions: () => ({ activeAgents: profiles }),
      loadAgentDefinitions: undefined,
      traceContext,
      eventStore: parent.eventStore,
      sessionStore: parent.sessionStore,
      ...ports,
      browserControlPort: browser,
      permissionService: parent.permissionService.forkForChild(),
      modelRequestAdmission: parent.modelRequestAdmission,
      modelFactory: execution?.executionOverride
        ? (target) => {
            const model = parent.modelFactory({
              ...target,
              requestDependencies: execution.executionOverride?.requestDependencies,
            });
            return (
              getOffPeakModelBinding(execution.executionOverride?.requestDependencies)?.wrap(
                model,
              ) ?? model
            );
          }
        : parent.modelFactory,
      mcpPort: access.port,
      skillPort: resolveSubagentSkillPort(parent.skillPort, profile.skills, cua),
      memoryRoot: memory?.rootDir,
      toolRegistry: undefined,
      toolExecutor: undefined,
      contextBuilder: undefined,

      createCollaborationBinding: binding,
      eventSink: childEventSink(parent, identity, traceContext, relation, () => internal),
    },
  );
  const internal = runtime as unknown as AgentRuntimeInternal;
  if (resume) await runtime.resumeFromStore({ persistedMessages, traceContext });
  else {
    await internal.ensureSessionPersisted(identity.path, traceContext);
    await saveChildSettings(parent.sessionStore, sessionId, {
      version: 1,
      profile,
      ...(userInstructions ? { userInstructions } : {}),
      ...(execution?.executionOverride ? { requiresExecutionContext: true } : {}),
    });
    if (identity.settings.forkTurns === "all") await forkCompletedHistory(parent, internal);
  }
  return runtime;
}
function resolveChildSelection(
  parent: AgentRuntimeInternal,
  deps: AgentRuntimeDeps,
  identity: AgentIdentity,
  profile: AgentProfile,
  execution?: CollaborationToolCallContext,
): ModelSelection {
  const inherited = execution?.modelSelection ?? parent.getSessionModelSelection();
  if (!inherited) throw new Error(`No model selected for ${identity.path}`);
  if (execution?.executionOverride) {
    if (identity.settings.model || identity.settings.reasoningEffort)
      throw new Error(
        `Host execution fixes the child model for ${identity.path}; explicit model/reasoning override is unavailable in this execution`,
      );
    return structuredClone(execution.executionOverride.selection);
  }
  if (identity.settings.forkTurns === "all") return structuredClone(inherited);
  const model = identity.settings.model;
  let selected = resolveSubagentSelection({
    parentSelection: inherited,
    profileSelection: profile.modelSelection,
    resolveSelection: deps.resolveEffectiveModelSelection,
  }).selection;
  if (!model && profile.modelSelection && parent.modelCatalogPort) {
    const catalog = parent.modelCatalogPort.listModels();
    if (
      !catalog.some(
        (candidate) =>
          !candidate.disabledReason &&
          candidate.providerId === selected.providerId &&
          candidate.modelId === selected.modelId,
      )
    )
      throw new Error(
        `Unavailable profile model ${selected.providerId}/${selected.modelId} for ${profile.name}; available models: ${
          catalog
            .filter((candidate) => !candidate.disabledReason)
            .map((candidate) => `${candidate.providerId}/${candidate.modelId}`)
            .join(", ") || "none"
        }`,
      );
  }
  if (model) {
    const catalog = parent.modelCatalogPort?.listModels() ?? [];
    const matches = catalog.filter(
      (candidate) =>
        !candidate.disabledReason &&
        (model === candidate.modelId || model === `${candidate.providerId}/${candidate.modelId}`),
    );
    if (matches.length !== 1)
      throw new Error(
        `Unknown or ambiguous model ${model}; available models: ${catalog.map((candidate) => `${candidate.providerId}/${candidate.modelId}`).join(", ") || "none"}`,
      );
    const match = matches[0]!;
    const effort = identity.settings.reasoningEffort ?? match.defaultReasoningLevel;
    if (effort && !match.reasoningLevels.includes(effort))
      throw new Error(
        `Unsupported reasoning_effort ${effort} for ${model}; available: ${match.reasoningLevels.join(", ")}`,
      );
    selected = {
      providerId: match.providerId,
      modelId: match.modelId,
      ...(effort ? { options: { reasoningLevel: effort } } : {}),
    };
  } else if (identity.settings.reasoningEffort) {
    const catalog = parent.modelCatalogPort?.listModels() ?? [];
    const match = catalog.find(
      (candidate) =>
        !candidate.disabledReason &&
        candidate.providerId === selected.providerId &&
        candidate.modelId === selected.modelId,
    );
    const effort = identity.settings.reasoningEffort;
    if (!match || !match.reasoningLevels.includes(effort))
      throw new Error(
        `Unsupported reasoning_effort ${effort} for ${selected.providerId}/${selected.modelId}; available: ${match?.reasoningLevels.join(", ") || "none"}`,
      );
    selected = { ...selected, options: { ...selected.options, reasoningLevel: effort } };
  }
  return selected;
}
