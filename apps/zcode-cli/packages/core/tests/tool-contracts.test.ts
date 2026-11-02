import { describe, expect, it } from "vitest";
import { BashInputJsonSchema, BashOutputJsonSchema } from "@zcode/contracts";
import { bashToolEntry } from "../src/tool/handlers/bash.js";
import { editToolEntry } from "../src/tool/handlers/edit.js";
import { globToolEntry } from "../src/tool/handlers/glob.js";
import { grepToolEntry } from "../src/tool/handlers/grep.js";
import { builtInTools, registerBuiltInTools } from "../src/tool/handlers/index.js";
import { addReadLineNumbers, readToolEntry } from "../src/tool/handlers/read.js";
import { orderProviderVisibleToolContracts } from "../src/tool/provider-visible-order.js";
import { writeToolEntry } from "../src/tool/handlers/write.js";
import { formatTaskNotification } from "../src/runtime-task/notification.js";
import { createToolRegistry } from "../src/tool/registry.js";
import { buildExploreSystemPrompt } from "../src/subagent/explore.js";

function normalizeWebSearchDynamicDate(description: string | undefined): string {
  return (description ?? "").replace(
    /The current month is [A-Z][a-z]+ \d{4}/u,
    "The current month is <current-month>",
  );
}

const DIRECT_BRANCH_REFERENCE_SEARCH_DESCRIPTIONS = {
  Glob: 'Fast file pattern matching. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time.',
  Grep: `Content search built on ripgrep. Prefer this over \`grep\`/\`rg\` via Bash — results integrate with the permission UI and file links.

- Full regex syntax (e.g. "log.*Error", "function\\s+\\w+"). Ripgrep, not grep — escape literal braces (\`interface\\{\\}\`).
- Filter with \`glob\` (e.g. "**/*.tsx") or \`type\` (e.g. "js", "py", "rust").
- \`output_mode\`: "content" (matching lines), "files_with_matches" (paths only, default), or "count".
- \`multiline: true\` for patterns that span lines.`,
} as const;

const DIRECT_BRANCH_EXPECTED_PROVIDER_TOOL_ORDER = [
  "AskUserQuestion",
  "Bash",
  "Edit",
  "EnterPlanMode",
  "ExitPlanMode",
  "Glob",
  "Grep",
  "Read",
  "Skill",
  "TaskOutput",
  "TaskStop",
  "TodoRead",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "Write",
  "ToolSearch",
  "DeferredToolCall",
  "spawn_agent",
  "send_message",
  "followup_task",
  "interrupt_agent",
  "list_agents",
  "wait_agent",
  "ReadSessionContext",
  "ReplyToChannel",
  "CreateWorkflow",
  // 修订入口紧随 CreateWorkflow 注册（docs/dynamic-workflow/launch.md「The `AmendWorkflow` tool」）。
  "AmendWorkflow",
  "SaveWorkflow",
  "EvalWorkflowSnippet",
  // run 内省与定义清单四个工具都不进 SORTED_PROVIDER_TOOL_NAMES（与 CreateWorkflow 同规），
  // 所以按注册序排在尾部。ResumeWorkflowRun 插在 GetWorkflowRun 之后（run 工具簇相邻）。
  "ListWorkflowRuns",
  "GetWorkflowRun",
  "ResumeWorkflowRun",
  // 升级问答的主代理侧（apps/zcode-cli/packages/dynamic-workflow/docs/execution-engine.md）：同为无 gate 的主会话工具，
  // 紧随 run 工具簇——它读的正是那些 run 上停驻的问题。
  "ResolveWorkflowQuestion",
  // 留白补全（docs/dynamic-workflow/launch.md「The `FillWorkflowHole` tool」）：alwaysAsk 门的主会话工具，
  // 按注册序紧随 ResolveWorkflowQuestion。
  "FillWorkflowHole",
  "ListSavedWorkflows",
  // 模型目录（docs/dynamic-workflow/launch.md）：同样不进 SORTED_PROVIDER_TOOL_NAMES，
  // 所以按注册序排在定义清单之后。
  "ListModels",
] as const;

const EMBEDDED_SEARCH_EXPECTED_PROVIDER_TOOL_ORDER =
  DIRECT_BRANCH_EXPECTED_PROVIDER_TOOL_ORDER.filter(
    (toolName) => toolName !== "Glob" && toolName !== "Grep",
  );

const SOURCE_DERIVED_WEBFETCH_DESCRIPTION = [
  "Fetches a URL, converts the page to markdown, and answers `prompt` against it using a small fast model.",
  "",
  "- Fails on authenticated/private URLs — use an authenticated MCP tool or `gh` for those instead.",
  "- HTTP is upgraded to HTTPS. Cross-host redirects are returned to you rather than followed; call again with the redirect URL.",
  "- Responses are cached for 15 minutes per URL.",
].join("\n");

const SOURCE_DERIVED_READ_SHORT_DESCRIPTION = [
  "Reads a file from the local filesystem.",
  "",
  "- `file_path` must be an absolute path.",
  "- Reads up to 2000 lines by default.",
  "- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters",
  "- Results are returned using cat -n format, with line numbers starting at 1",
  "- Reads images (PNG, JPG, …) and presents them visually.",
  // video 输入一期新增能力行：Read 支持读取视频作为模型输入。
  "- Reads videos (MP4, MOV, WEBM, …) and presents them as video input (subject to ZCode's video input limit).",
  "- Reading a directory, a missing file, or an empty file returns an error or system reminder rather than content.",
  "- Do NOT re-read a file you just edited to verify — Edit/Write would have errored if the change failed, and the harness tracks file state for you.",
].join("\n");

function getSchemaPath(schema: unknown, path: readonly string[]): unknown {
  let current = schema;
  for (const segment of path) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

describe("tool contract declarations", () => {
  it("orders shared provider-visible tool contracts by source name sort before appending local-only tools", () => {
    const directRegistry = createToolRegistry();
    registerBuiltInTools(directRegistry, {
      includeCollaboration: true,

      includeSkill: true,
    });
    expect(directRegistry.list().slice(0, 4)).toEqual([
      "ToolSearch",
      "DeferredToolCall",
      "Read",
      "Write",
    ]);
    expect(
      orderProviderVisibleToolContracts(directRegistry.toContracts()).map((tool) => tool.name),
    ).toEqual(DIRECT_BRANCH_EXPECTED_PROVIDER_TOOL_ORDER);

    const embeddedRegistry = createToolRegistry();
    registerBuiltInTools(embeddedRegistry, {
      embeddedSearchEnabled: true,
      includeCollaboration: true,

      includeSkill: true,
    });
    expect(
      orderProviderVisibleToolContracts(embeddedRegistry.toContracts()).map((tool) => tool.name),
    ).toEqual(EMBEDDED_SEARCH_EXPECTED_PROVIDER_TOOL_ORDER);
  });

  it("orders shared provider tools before preserving local-only relative order", () => {
    expect(
      orderProviderVisibleToolContracts([
        { name: "TodoWrite" },
        { name: "Bash" },
        { name: "TodoRead" },
        { name: "Task" },
        { name: "Read" },
        { name: "ReadSessionContext" },
      ]).map((tool) => tool.name),
    ).toEqual(["Bash", "Read", "TodoRead", "TodoWrite", "Task", "ReadSessionContext"]);
  });

  it("orders optional Workflow with the shared provider tool partition when it is present", () => {
    expect(
      orderProviderVisibleToolContracts([
        { name: "Write" },
        { name: "Workflow" },
        { name: "ReadSessionContext" },
        { name: "WebSearch" },
      ]).map((tool) => tool.name),
    ).toEqual(["WebSearch", "Workflow", "Write", "ReadSessionContext"]);
  });

  it("matches source-derived provider-visible schema facts for supported tools", () => {
    const registry = createToolRegistry();
    registerBuiltInTools(registry, {
      embeddedSearchEnabled: true,
      includeCollaboration: true,
      includeSkill: true,
    });

    const byName = new Map(registry.toContracts().map((tool) => [tool.name, tool]));
    const cases: Array<{ toolName: string; path: readonly string[]; expected: unknown }> = [
      {
        toolName: "AskUserQuestion",
        path: ["properties", "questions", "minItems"],
        expected: 1,
      },
      {
        toolName: "AskUserQuestion",
        path: ["properties", "questions", "maxItems"],
        expected: 4,
      },
      {
        toolName: "AskUserQuestion",
        path: ["properties", "questions", "items", "required"],
        expected: ["question", "header", "options", "multiSelect"],
      },
      {
        toolName: "AskUserQuestion",
        path: ["properties", "questions", "items", "properties", "multiSelect", "default"],
        expected: false,
      },
      {
        toolName: "AskUserQuestion",
        path: ["properties", "questions", "items", "properties", "multiSelect", "description"],
        expected:
          "Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive.",
      },
      {
        toolName: "WebFetch",
        path: ["properties", "url", "description"],
        expected: "The URL to fetch content from",
      },
      {
        toolName: "WebFetch",
        path: ["properties", "prompt", "description"],
        expected: "The prompt to run on the fetched content",
      },
      {
        toolName: "WebSearch",
        path: ["properties", "query", "minLength"],
        expected: 2,
      },
      {
        toolName: "WebSearch",
        path: ["properties", "allowed_domains", "items", "type"],
        expected: "string",
      },
      {
        toolName: "WebSearch",
        path: ["properties", "allowed_domains", "maxItems"],
        expected: undefined,
      },
      {
        toolName: "WebSearch",
        path: ["properties", "blocked_domains", "items", "type"],
        expected: "string",
      },
      {
        toolName: "WebSearch",
        path: ["properties", "blocked_domains", "maxItems"],
        expected: undefined,
      },
    ];

    for (const { toolName, path, expected } of cases) {
      expect(
        getSchemaPath(byName.get(toolName)?.inputSchema, path),
        `${toolName}.${path.join(".")}`,
      ).toEqual(expected);
    }
  });

  it("matches direct short Glob and Grep provider contracts exactly", () => {
    const registry = createToolRegistry();
    registerBuiltInTools(registry);
    const byName = new Map(registry.toContracts().map((tool) => [tool.name, tool]));

    for (const toolName of ["Glob", "Grep"] as const) {
      expect(byName.get(toolName)?.description, `${toolName}.description`).toBe(
        DIRECT_BRANCH_REFERENCE_SEARCH_DESCRIPTIONS[toolName],
      );
    }
  });

  it("requires every built-in tool to declare the v2 common contract", () => {
    for (const entry of builtInTools) {
      expect(entry.capability, entry.metadata.name).toBeTruthy();
      expect(entry.inputSchema, entry.metadata.name).toEqual(expect.any(Object));
      expect(entry.outputSchema, entry.metadata.name).toEqual(expect.any(Object));
      expect(entry.runtimeInputSchema, entry.metadata.name).toBeTruthy();
      expect(entry.runtimeOutputSchema, entry.metadata.name).toBeTruthy();
      expect(entry.permission.permission, entry.metadata.name).toBeTruthy();
      expect(entry.permission.reason, entry.metadata.name).toBeTruthy();
      expect(entry.permission.riskLevel, entry.metadata.name).toBe(entry.metadata.riskLevel);
      expect(entry.permission.sideEffectScope, entry.metadata.name).toBe(
        entry.metadata.sideEffectScope,
      );
      expect(entry.resultBudget.maxInlineBytes, entry.metadata.name).toBeGreaterThan(0);
      expect(entry.resultBudget.maxModelBytes, entry.metadata.name).toBeGreaterThan(0);
      if (entry.timeout.kind === "none") {
        expect(entry.metadata.timeoutMs, entry.metadata.name).toBeUndefined();
      } else {
        expect(entry.timeout.defaultMs, entry.metadata.name).toBe(entry.metadata.timeoutMs);
      }
      expect(entry.cancellation.userVisibleMessage, entry.metadata.name).toBeTruthy();
      expect(entry.trace.required, entry.metadata.name).toBe(true);
    }
  });

  it("keeps Bash background fields in provider schemas without exposing execution internals", () => {
    expect(BashOutputJsonSchema.properties).toHaveProperty("backgroundTaskId");
    expect(BashOutputJsonSchema.properties).toHaveProperty("assistantAutoBackgrounded");
    expect(BashInputJsonSchema.properties).toHaveProperty("run_in_background");
  });

  it("projects output schema and runtime-only declarations into model contracts", () => {
    const registry = createToolRegistry();
    registerBuiltInTools(registry, {
      includeCollaboration: true,

      includeWorkflow: true,
    });

    const contracts = registry.toContracts();
    const byName = new Map(contracts.map((contract) => [contract.name, contract]));

    expect(byName.get("spawn_agent")?.outputSchema).toBeDefined();
    expect(byName.get("spawn_agent")?.permission?.sideEffectScope).toBe("session");
    expect(byName.get("Read")?.outputSchema).toBeDefined();
    expect(byName.get("Read")?.capability).toContain("Read");
    expect(byName.get("Read")?.description).toBe(SOURCE_DERIVED_READ_SHORT_DESCRIPTION);
    expect(byName.get("Glob")?.permission?.permission).toBe("read");
    expect(byName.get("Glob")?.description).toContain("Fast file pattern matching.");
    expect(byName.get("Glob")?.description).toContain('glob patterns like "**/*.js"');
    expect(byName.get("Glob")?.description).toContain("sorted by modification time");
    expect(byName.get("Glob")?.description).not.toContain("from the main agent");
    expect(byName.get("Grep")?.inputSchema).toHaveProperty("properties.pattern");
    expect(byName.get("Grep")?.description).toContain("ripgrep");
    expect(byName.get("Grep")?.description).toContain("Prefer this over `grep`/`rg` via Bash");
    expect(byName.get("Grep")?.description).toContain("Full regex syntax");
    expect(byName.get("Grep")?.description).toContain("files_with_matches");
    expect(byName.get("Grep")?.description).not.toContain("from the main agent");
    expect(byName.get("WebFetch")?.permission?.sideEffectScope).toBe("network");
    expect(byName.get("WebFetch")?.needsApproval).toBe(true);
    expect(byName.get("WebFetch")?.description).toBe(SOURCE_DERIVED_WEBFETCH_DESCRIPTION);
    expect(normalizeWebSearchDynamicDate(byName.get("WebSearch")?.description)).toContain(
      "Search the web. Returns result blocks with titles and URLs. US-only.",
    );
    expect(byName.get("TodoRead")?.permission?.sideEffectScope).toBe("none");
    expect(byName.get("TodoWrite")?.permission?.sideEffectScope).toBe("session");
    expect(byName.get("AskUserQuestion")?.requiresUserInteraction).toBe(true);
    expect(byName.get("AskUserQuestion")?.permission?.sideEffectScope).toBe("userInteraction");
    expect(byName.get("AskUserQuestion")?.description).toContain("Preview feature");
    expect(byName.get("AskUserQuestion")?.description).toContain("multiSelect");
    expect(byName.get("EnterPlanMode")?.requiresUserInteraction).toBe(false);
    expect(byName.get("EnterPlanMode")?.permission?.sideEffectScope).toBe("session");
    expect(byName.get("EnterPlanMode")?.permission?.needsApproval).toBe(false);
    const enterPlanDescription = byName.get("EnterPlanMode")?.description ?? "";
    expect(enterPlanDescription).toContain(
      "1. Thoroughly explore the codebase using Glob, Grep, and Read",
    );
    expect(enterPlanDescription).not.toContain("`find`/Glob");
    expect(enterPlanDescription).not.toContain("`grep`/Grep");
    expect(byName.get("ExitPlanMode")?.requiresUserInteraction).toBe(true);
    expect(byName.get("ExitPlanMode")?.permission?.sideEffectScope).toBe("session");
    expect(byName.get("ExitPlanMode")?.inputSchema).toHaveProperty("properties.plan");
    expect(byName.get("ExitPlanMode")?.inputSchema).not.toHaveProperty("properties.planFilePath");
    expect(byName.get("ExitPlanMode")?.inputSchema).not.toHaveProperty("properties.filePath");
    expect(byName.get("ExitPlanMode")?.description).toContain("## How This Tool Works");
    expect(byName.get("ExitPlanMode")?.description).not.toContain("Usage:");
    expect(byName.get("ExitPlanMode")?.description).toMatch(
      /^Use this tool when you are in plan mode/u,
    );
    expect(byName.get("ExitPlanMode")?.description).toContain(
      "DOES take the plan content as the required plan parameter",
    );
    expect(byName.get("ExitPlanMode")?.description).toContain("research tasks");
    expect(byName.get("ExitPlanMode")?.description).toContain(
      "Search for and understand the implementation of vim mode",
    );
    expect(byName.get("ExitPlanMode")?.description).toContain("AskUserQuestion");
    expect(byName.get("ExitPlanMode")?.description).toContain(
      "use AskUserQuestion before finalizing your plan",
    );
    expect(byName.get("ExitPlanMode")?.description).not.toContain("yolo");
    expect(byName.get("ExitPlanMode")?.description).toMatch(/\n$/u);
    expect(byName.get("send_message")?.permission?.sideEffectScope).toBe("session");
    expect(byName.get("Write")?.permission?.permission).toBe("edit");
    expect(byName.get("Write")?.description).toContain("Writes a file to the local filesystem");
    const applyPatch = byName.get("ApplyPatch");
    if (applyPatch) {
      expect(applyPatch.permission?.permission).toBe("edit");
      expect(applyPatch.description).toContain("structured file patches");
      expect(applyPatch.description).toContain("do not switch to Python");
      expect(applyPatch.description).toContain("GB2312");
    }
    expect(byName.get("Edit")?.description).toContain("Performs exact string replacement");
    expect(byName.get("Bash")?.resultBudget?.strategy).toBe("artifact");
    expect(byName.get("Bash")?.description).toBe(
      [
        "Executes a bash command and returns its output.",
        "",
        "- Working directory persists between calls, but prefer absolute paths — `cd` in a compound command can trigger a permission prompt. Shell state (env vars, functions) does not persist; the shell is initialized from the user's profile.",
        "- IMPORTANT: Avoid using this tool to run `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user.",
        "- `timeout` is in milliseconds: default 120000, max 600000.",
        "- `run_in_background` runs the command detached: it keeps running across turns and re-invokes you when it exits. No `&` needed.",
        "",
        "# Git",
        "- Interactive flags (`-i`, e.g. `git rebase -i`, `git add -i`) are not supported in this environment.",
        "- Use the `gh` CLI for GitHub operations (PRs, issues, API).",
        "- Commit or push only when the user asks. If on the default branch, branch first.",
      ].join("\n"),
    );
    expect(byName.get("Skill")?.description).toContain("available skills");
    expect(byName.get("Skill")?.inputSchema).not.toHaveProperty("_def");
    const workflow = byName.get("Workflow");
    if (workflow) {
      expect(workflow.description).toContain("workflow");
      const workflowSchema = workflow.inputSchema as any;
      for (const field of [
        "args",
        "description",
        "name",
        "resumeFromRunId",
        "script",
        "scriptPath",
        "title",
      ]) {
        expect(workflowSchema.properties?.[field]?.description).toEqual(expect.any(String));
      }
    }
  });

  it("formats local-agent task notifications with the provider-visible XML shape", () => {
    const notification = formatTaskNotification({
      agentId: "agent_done",
      description: "review diff",
      outputFile: "/tmp/agent_done/output.txt",
      result: "Done <ok>",
      status: "completed",
      subagentType: "code-reviewer",
      summary: 'Agent code-reviewer task "review diff" completed.',
      taskId: "agent_done",
      taskType: "local_agent",
      toolUseId: "toolu_123",
      usage: {
        durationMs: 33,
        modelUsage: {
          inputTokens: 1,
          outputTokens: 2,
          totalTokens: 11,
        },
        toolUseCount: 2,
        totalTokens: 11,
      },
    });

    expect(notification.split("\n")[0]).toBe("<task-notification>");
    expect(notification).toContain("<task-id>agent_done</task-id>");
    expect(notification).toContain("<tool-use-id>toolu_123</tool-use-id>");
    expect(notification).toContain("<output-file>/tmp/agent_done/output.txt</output-file>");
    expect(notification).toContain("<status>completed</status>");
    expect(notification).toContain(
      "<summary>Agent code-reviewer task &quot;review diff&quot; completed.</summary>",
    );
    expect(notification).toContain("<result>Done &lt;ok&gt;</result>");
    expect(notification).toContain(
      "<usage><subagent_tokens>11</subagent_tokens><tool_uses>2</tool_uses><duration_ms>33</duration_ms></usage>",
    );
    expect(notification).not.toContain("SYSTEM NOTIFICATION");
    expect(notification).not.toContain("<task-type>");
    expect(notification).not.toContain("<agent-id>");
    expect(notification).not.toContain("<subagent-type>");
    expect(notification).not.toContain("<description>");
    expect(notification).not.toContain("<total-tokens>");
    expect(notification).not.toContain("<input-tokens>");
  });

  it("omits local-agent notification token usage when token usage is unavailable", () => {
    const notification = formatTaskNotification({
      agentId: "agent_done",
      description: "review diff",
      outputFile: "/tmp/agent_done/output.txt",
      result: "Done",
      status: "completed",
      subagentType: "code-reviewer",
      summary: 'Agent code-reviewer task "review diff" completed.',
      taskId: "agent_done",
      taskType: "local_agent",
      toolUseId: "toolu_123",
      usage: {
        durationMs: 33,
        modelUsage: {},
        toolUseCount: 2,
      },
    });

    expect(notification).not.toContain("<subagent_tokens>");
    expect(notification).toContain("<tool_uses>2</tool_uses>");
    expect(notification).toContain("<duration_ms>33</duration_ms>");
  });

  it("formats local-bash task notifications with provider-visible XML shape", () => {
    const notification = formatTaskNotification({
      description: "run tests",
      outputFile: "/tmp/bash/stdout.log",
      result: "must not be provider-visible",
      status: "completed",
      error: "must not be provider-visible",
      stderrFile: "/tmp/bash/stderr.log",
      stdoutFile: "/tmp/bash/stdout.log",
      summary: 'Background command "npm test" completed (exit code 0)',
      taskId: "exec_done",
      taskType: "local_bash",
      toolUseId: "toolu_bash",
    });

    expect(notification).toBe(
      [
        "<task-notification>",
        "<task-id>exec_done</task-id>",
        "<tool-use-id>toolu_bash</tool-use-id>",
        "<output-file>/tmp/bash/stdout.log</output-file>",
        "<status>completed</status>",
        '<summary>Background command "npm test" completed (exit code 0)</summary>',
        "</task-notification>",
      ].join("\n"),
    );
  });

  it("aligns P0 tool prompt semantic guidance", () => {
    const registry = createToolRegistry();
    registerBuiltInTools(registry, {
      includeCollaboration: true,
      includeSkill: true,
      includeWorkflow: true,
    });

    const byName = new Map(registry.toContracts().map((tool) => [tool.name, tool]));

    const todoWriteDescription = byName.get("TodoWrite")?.description ?? "";
    expect(todoWriteDescription).toContain("task list for the current session");
    expect(todoWriteDescription).toContain("rendered to the user as your working plan");
    expect(todoWriteDescription).toContain("replaces the previous one");
    expect(todoWriteDescription).toContain("Keep one item");
    expect(todoWriteDescription).toContain("in_progress");
    expect(todoWriteDescription).toContain("completed");
    expect(todoWriteDescription).not.toContain("activeForm");
    expect(todoWriteDescription).not.toContain("## When to Use");
    expect(todoWriteDescription).not.toContain("<reasoning>");

    const enterPlanDescription = byName.get("EnterPlanMode")?.description ?? "";
    expect(enterPlanDescription).toContain("non-trivial implementation task");
    expect(enterPlanDescription).toContain("explore the codebase");
    expect(enterPlanDescription).toContain("using Glob, Grep, and Read");
    expect(enterPlanDescription).not.toContain("`find`/Glob");
    expect(enterPlanDescription).not.toContain("`grep`/Grep");
    expect(enterPlanDescription).toContain("AskUserQuestion");
    expect(enterPlanDescription).toContain("ExitPlanMode");
    expect(enterPlanDescription).toContain("REQUIRES user approval");
    expect(enterPlanDescription).toContain(
      "Pure research/exploration tasks (use the spawn_agent tool instead)",
    );
    expect(enterPlanDescription).not.toContain("with explore agent instead");

    const exitPlanDescription = byName.get("ExitPlanMode")?.description ?? "";
    expect(exitPlanDescription).toContain("plan parameter");
    expect(exitPlanDescription).toContain("complete plan");
    expect(exitPlanDescription).toContain("Do NOT use AskUserQuestion");
    expect(exitPlanDescription).toContain("ExitPlanMode inherently requests user approval");
    expect(exitPlanDescription).not.toContain("read the plan from the file");
    expect(exitPlanDescription).not.toContain("ExitPlanMode V2");

    const askDescription = byName.get("AskUserQuestion")?.description ?? "";
    expect(askDescription).toContain("blocked on a decision");
    expect(askDescription).toContain("cannot resolve from the request");
    expect(askDescription).toContain("sensible defaults");
    expect(askDescription).toContain("Do NOT use this tool to ask");
  });

  it("keeps Skill naming and loading guidance", () => {
    const registry = createToolRegistry();
    registerBuiltInTools(registry, {
      includeCollaboration: true,
      includeSkill: true,
      includeWorkflow: true,
    });

    const byName = new Map(registry.toContracts().map((tool) => [tool.name, tool]));

    const skillDescription = byName.get("Skill")?.description ?? "";
    const normalizedSkillDescription = skillDescription.toLowerCase();
    expect(skillDescription).toContain("available skills");
    expect(skillDescription).toContain("slash command");
    expect(skillDescription).toContain("exact name");
    expect(skillDescription).toContain("Never guess or invent");
    expect(normalizedSkillDescription).toContain("blocking requirement");
    expect(normalizedSkillDescription).toContain("already been loaded");
    expect(skillDescription).toContain("built-in CLI commands");
  });

  it("projects preview guidance and direct Explore search instructions", () => {
    const registry = createToolRegistry();
    registerBuiltInTools(registry, {
      includeCollaboration: true,
      includeSkill: true,
      includeWorkflow: true,
    });

    const byName = new Map(registry.toContracts().map((tool) => [tool.name, tool]));
    const askDescription = byName.get("AskUserQuestion")?.description ?? "";
    expect(askDescription.length).toBeGreaterThan(1700);
    expect(askDescription).toContain("Preview feature");
    expect(askDescription).toContain("rendered as markdown in a monospace box");
    expect(askDescription).toContain("side-by-side layout");
    expect(askDescription).toContain("single-select");
    expect(askDescription).toContain("Do not use previews for simple preference questions");

    const askSchema = byName.get("AskUserQuestion")?.inputSchema as any;
    const previewDescription =
      askSchema?.properties?.questions?.items?.properties?.options?.items?.properties?.preview
        ?.description ?? "";
    expect(previewDescription).toBe(
      "Optional preview content rendered when this option is focused. Use for mockups, code snippets, or visual comparisons that help users compare options. See the tool description for the expected content format.",
    );

    const explorePrompt = buildExploreSystemPrompt({
      workingDirectory: "/workspace/project",
      workspaceRoot: "/workspace/project",
      envInfo: {
        isGitRepository: true,
        platform: "darwin",
        shell: "zsh",
        osVersion: "Darwin 24.3.0",
      },
      modelName: "Haiku 4.5",
    });
    expect(explorePrompt).toContain("Use Glob for broad file pattern matching");
    expect(explorePrompt).toContain("Use Grep for searching file contents with regex");
    expect(explorePrompt).not.toContain("Use WebSearch");
    expect(explorePrompt).not.toContain("exact model ID");
    expect(explorePrompt).not.toContain("Assistant knowledge cutoff");
  });

  it("keeps built-in tool input JSON schemas provider-compatible", () => {
    for (const entry of builtInTools) {
      // Provider 只接收输入声明；输出 union 由本地 executor 校验，不能套用输入限制。
      const schemaIssues = findProviderSchemaIssues(
        entry.inputSchema,
        `${entry.metadata.name}.inputSchema`,
      );

      expect(schemaIssues, entry.metadata.name).toEqual([]);
    }
  });

  it("exposes Glob and Grep in the direct search branch", () => {
    const mainRegistry = createToolRegistry();
    registerBuiltInTools(mainRegistry, { includeCollaboration: true });

    const mainAllowlistRegistry = createToolRegistry();
    registerBuiltInTools(mainAllowlistRegistry, { allowedTools: ["Read", "Glob", "Grep"] });

    expect(mainRegistry.has("spawn_agent")).toBe(true);
    expect(mainRegistry.has("Glob")).toBe(true);
    expect(mainRegistry.has("Grep")).toBe(true);
    expect(mainAllowlistRegistry.list()).toEqual(["Read", "Glob", "Grep"]);
  });

  it("does not expose explicitly disallowed built-in tools", () => {
    const registry = createToolRegistry();
    registerBuiltInTools(registry, {
      includeCollaboration: true,
      disallowedTools: ["TodoWrite", "Bash"],
    });

    expect(registry.has("Read")).toBe(true);
    expect(registry.has("TodoWrite")).toBe(false);
    expect(registry.has("Bash")).toBe(false);
    expect(registry.toContracts().map((tool) => tool.name)).not.toContain("TodoWrite");
  });

  it("uses the embedded search provider-visible branch when enabled", () => {
    const registry = createToolRegistry();
    registerBuiltInTools(registry, {
      embeddedSearchEnabled: true,
      includeCollaboration: true,
    });

    const byName = new Map(registry.toContracts().map((contract) => [contract.name, contract]));

    expect(byName.has("Glob")).toBe(false);
    expect(byName.has("Grep")).toBe(false);

    const bashDescription = byName.get("Bash")?.description ?? "";
    expect(bashDescription).toBe(
      [
        "Executes a bash command and returns its output.",
        "",
        "- Working directory persists between calls, but prefer absolute paths — `cd` in a compound command can trigger a permission prompt. Shell state (env vars, functions) does not persist; the shell is initialized from the user's profile.",
        "- IMPORTANT: Avoid using this tool to run `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user.",
        "- `timeout` is in milliseconds: default 120000, max 600000.",
        "- `run_in_background` runs the command detached: it keeps running across turns and re-invokes you when it exits. No `&` needed.",
        "",
        "# Git",
        "- Interactive flags (`-i`, e.g. `git rebase -i`, `git add -i`) are not supported in this environment.",
        "- Use the `gh` CLI for GitHub operations (PRs, issues, API).",
        "- Commit or push only when the user asks. If on the default branch, branch first.",
      ].join("\n"),
    );

    const enterPlanDescription = byName.get("EnterPlanMode")?.description ?? "";
    expect(enterPlanDescription).toContain("using `find`/Glob, `grep`/Grep, and Read");
    expect(enterPlanDescription).not.toContain("using `find`, `grep`, and Read");
    expect(enterPlanDescription).not.toContain("using Glob, Grep, and Read");

    const explorePrompt = buildExploreSystemPrompt({
      workingDirectory: "/workspace/project",
      workspaceRoot: "/workspace/project",
      embeddedSearchEnabled: true,
      envInfo: {
        isGitRepository: true,
        platform: "darwin",
        shell: "zsh",
        osVersion: "Darwin 24.3.0",
      },
      modelName: "fast-search-model",
    });
    expect(explorePrompt).toContain("Use `find` via Bash for broad file pattern matching");
    expect(explorePrompt).toContain("Use `grep` via Bash for searching file contents with regex");
    expect(explorePrompt).toContain(
      "Use Bash ONLY for read-only operations (ls, git status, git log, git diff, find, grep, cat, head, tail)",
    );
    expect(explorePrompt).not.toContain("Use Glob for broad file pattern matching");
    expect(explorePrompt).not.toContain("Use Grep for searching file contents with regex");
  });

  it("aligns provider-visible hard schema diffs for P-12", () => {
    const registry = createToolRegistry();
    registerBuiltInTools(registry, {
      includeCollaboration: true,
    });

    const contracts = registry.toContracts();
    const byName = new Map(contracts.map((contract) => [contract.name, contract]));
    const skillInput = byName.get("Skill")?.inputSchema as any;
    const readInput = byName.get("Read")?.inputSchema as any;
    const writeInput = byName.get("Write")?.inputSchema as any;
    const editInput = byName.get("Edit")?.inputSchema as any;
    const todoWrite = byName.get("TodoWrite");
    const todoWriteInput = todoWrite?.inputSchema as any;
    const exitPlanInput = byName.get("ExitPlanMode")?.inputSchema as any;

    expect(skillInput.properties).toHaveProperty("skill");
    expect(skillInput.properties).not.toHaveProperty("name");
    expect(skillInput.required).toEqual(expect.arrayContaining(["skill"]));
    expect(skillInput.properties.skill.description).toBe(
      "The name of a skill from the available-skills list. Do not guess names.",
    );
    expect(skillInput.properties.args.description).toBe("Optional arguments for the skill");

    expect(readInput.properties.file_path.description).toContain("absolute");
    expect(readInput.properties.file_path.description).not.toMatch(/relative|session cwd/iu);
    expect(readInput.properties.offset.description).toBe(
      "The line number to start reading from. Only provide if the file is too large to read at once",
    );
    expect(readInput.properties.limit.description).toBe(
      "The number of lines to read. Only provide if the file is too large to read at once.",
    );
    expect(readInput.properties).not.toHaveProperty("pages");
    expect(writeInput.properties.file_path.description).toBe(
      "The absolute path to the file to write (must be absolute, not relative)",
    );
    expect(writeInput.properties.content.description).toBe("The content to write to the file");
    expect(editInput.properties.file_path.description).toContain("absolute");
    expect(editInput.properties.file_path.description).not.toMatch(/relative|session cwd/iu);
    const webFetchInput = byName.get("WebFetch")?.inputSchema as any;
    expect(webFetchInput.properties.url.description).toBe("The URL to fetch content from");
    expect(webFetchInput.properties.prompt.description).toBe(
      "The prompt to run on the fetched content",
    );
    const webSearchInput = byName.get("WebSearch")?.inputSchema as any;
    expect(webSearchInput.properties.query.description).toBe("The search query to use");
    expect(webSearchInput.properties.allowed_domains.description).toBe(
      "Only include search results from these domains",
    );
    expect(webSearchInput.properties.blocked_domains.description).toBe(
      "Never include search results from these domains",
    );
    expect(webSearchInput.properties).not.toHaveProperty("maxUses");
    expect(exitPlanInput.properties.allowedPrompts.description).toBe(
      "Prompt-based permissions needed to implement the plan. These describe categories of actions rather than specific commands.",
    );
    expect(exitPlanInput.properties.allowedPrompts.items.properties.tool.description).toBe(
      "The tool this prompt applies to",
    );
    expect(exitPlanInput.properties.allowedPrompts.items.properties.prompt.description).toBe(
      'Semantic description of the action, e.g. "run tests", "install dependencies"',
    );

    const todoItem = todoWriteInput.properties.todos.items;
    expect(todoItem.properties).toHaveProperty("content");
    expect(todoItem.properties).toHaveProperty("status");
    expect(todoItem.properties).toHaveProperty("priority");
    expect(todoItem.properties).not.toHaveProperty("activeForm");
    expect(todoItem.properties.status.enum).toEqual(["pending", "in_progress", "completed"]);
  });

  it("describes Grep input with ripgrep-oriented guidance", () => {
    const properties = grepToolEntry.inputSchema.properties as Record<
      string,
      { description?: string }
    >;

    expect(properties.pattern?.description).toBe(
      "The regular expression pattern to search for in file contents",
    );
    expect(properties.glob?.description).toBe(
      'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") - maps to rg --glob',
    );
    expect(properties["-o"]?.description).toBe(
      'Print only the matched (non-empty) parts of each matching line, one match per output line (rg -o / --only-matching). Requires output_mode: "content", ignored otherwise. Defaults to false.',
    );
    expect(properties.multiline?.description).toContain("rg -U --multiline-dotall");
  });

  it("describes Glob and Grep provider contracts without session-cwd wording", () => {
    const globSchema = globToolEntry.inputSchema as any;
    const grepSchema = grepToolEntry.inputSchema as any;

    expect(globSchema.required).toEqual(["pattern"]);
    expect(grepSchema.required).toEqual(["pattern"]);
    expect(globSchema.additionalProperties).toBe(false);
    expect(grepSchema.additionalProperties).toBe(false);

    expect(globSchema.properties.path.description).toContain("current working directory");
    expect(grepSchema.properties.path.description).toContain("current working directory");
    expect(globSchema.properties.path.description).not.toMatch(/session cwd/iu);
    expect(grepSchema.properties.path.description).not.toMatch(/session cwd/iu);

    expect(globToolEntry.metadata.description).toContain("modification time");
    expect(globToolEntry.metadata.description).toContain("glob patterns");
    expect(grepToolEntry.metadata.description).toContain("files_with_matches");
    expect(grepToolEntry.metadata.description).toContain("Content search built on ripgrep.");
  });

  it("formats Glob results as provider-visible file lists for the model", () => {
    expect(
      globToolEntry.formatModelContent?.({
        durationMs: 1,
        numFiles: 2,
        filenames: ["src/a.ts", "src/b.ts"],
        truncated: false,
      }),
    ).toBe("src/a.ts\nsrc/b.ts");

    expect(
      globToolEntry.formatModelContent?.({
        durationMs: 1,
        numFiles: 0,
        filenames: [],
        truncated: false,
      }),
    ).toBe("No files found");

    expect(
      globToolEntry.formatModelContent?.({
        durationMs: 1,
        numFiles: 2,
        filenames: ["src/a.ts", "src/b.ts"],
        truncated: true,
      }),
    ).toBe(
      "src/a.ts\nsrc/b.ts\n(Results are truncated. Consider using a more specific path or pattern.)",
    );
  });

  it("keeps Bash model input simple while accepting semantic runtime values", () => {
    const properties = bashToolEntry.inputSchema.properties as Record<string, { type?: string }>;

    expect(properties).toHaveProperty("command");
    expect(properties).toHaveProperty("timeout");
    expect(properties).toHaveProperty("description");
    expect(properties).toHaveProperty("run_in_background");
    expect(properties).toHaveProperty("dangerouslyDisableSandbox");
    expect(properties).not.toHaveProperty("argv");
    expect(properties).not.toHaveProperty("cwd");
    expect(properties).not.toHaveProperty("env");
    expect(properties.timeout?.type).toBe("number");
    expect(properties.run_in_background?.type).toBe("boolean");
    expect(properties.dangerouslyDisableSandbox?.type).toBe("boolean");

    expect(
      bashToolEntry.runtimeInputSchema.parse({
        command: "npm test",
        timeout: "30000",
        run_in_background: "true",
        dangerouslyDisableSandbox: "0",
      }),
    ).toEqual({
      command: "npm test",
      timeout: 30000,
      run_in_background: true,
      dangerouslyDisableSandbox: false,
    });

    expect(() =>
      bashToolEntry.runtimeInputSchema.parse({
        command: "node -v",
        argv: { file: "node", args: ["-v"] },
      }),
    ).toThrow();
  });

  it("formats Grep results as search text for the model", () => {
    expect(
      grepToolEntry.formatModelContent?.({
        mode: "files_with_matches",
        durationMs: 1,
        numFiles: 2,
        filenames: ["src/a.ts", "src/b.ts"],
        truncated: false,
      }),
    ).toBe("Found 2 files\nsrc/a.ts\nsrc/b.ts");

    expect(
      grepToolEntry.formatModelContent?.({
        mode: "content",
        durationMs: 1,
        numFiles: 1,
        filenames: [],
        content: "src/a.ts:1:needle",
        numLines: 1,
        numMatches: 1,
        truncated: false,
      }),
    ).toBe("src/a.ts:1:needle");

    expect(
      grepToolEntry.formatModelContent?.({
        mode: "count",
        durationMs: 1,
        numFiles: 1,
        filenames: [],
        content: "src/a.ts:3",
        numMatches: 3,
        truncated: false,
      }),
    ).toBe("src/a.ts:3\n\nFound 3 total occurrences across 1 file.");
  });

  it("formats file mutation results as concise model-visible confirmations", () => {
    const originalFile = "secret old content";
    const structuredPatch = [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: ["-secret old content", "+new content"],
      },
    ];

    const editContent = editToolEntry.formatModelContent?.({
      filePath: "/work/file.ts",
      oldString: "old",
      newString: "new",
      originalFile,
      structuredPatch,
      userModified: false,
      replaceAll: true,
    });
    expect(editContent).toBe(
      "The file /work/file.ts has been updated. All occurrences were successfully replaced. (file state is current in your context — no need to Read it back)",
    );

    const writeCreateContent = writeToolEntry.formatModelContent?.({
      type: "create",
      filePath: "/work/new.ts",
      content: "large new file content",
      structuredPatch: [],
      originalFile: null,
    });
    expect(writeCreateContent).toBe(
      "File created successfully at: /work/new.ts (file state is current in your context \u2014 no need to Read it back)",
    );

    const writeUpdateContent = writeToolEntry.formatModelContent?.({
      type: "update",
      filePath: "/work/file.ts",
      content: "large new file content",
      structuredPatch,
      originalFile,
    });
    expect(writeUpdateContent).toBe(
      "The file /work/file.ts has been updated successfully. (file state is current in your context \u2014 no need to Read it back)",
    );
  });

  it("formats Read text output as cat-n content without JSON escaping tabs", () => {
    const content = "工作任务\n- [ ] prd auto research 的\n\t- [ ] beta 部分继续";

    const modelContent = readToolEntry.formatModelContent?.({
      type: "text",
      filePath: "/work/2026-05-08.md",
      content,
      numLines: 3,
      startLine: 1,
      totalLines: 3,
    });

    expect(modelContent).toBe(
      "1\t工作任务\n2\t- [ ] prd auto research 的\n3\t\t- [ ] beta 部分继续",
    );
  });

  it("exports the Read line-number formatter for raw text content", () => {
    expect(addReadLineNumbers({ content: "alpha\n\tbeta", startLine: 12 })).toBe(
      "12\talpha\n13\t\tbeta",
    );
  });
});

function findProviderSchemaIssues(schema: Record<string, unknown>, path: string): string[] {
  const issues: string[] = [];
  scanProviderSchema(schema, path, issues);
  return issues;
}

function scanProviderSchema(value: unknown, path: string, issues: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanProviderSchema(item, `${path}[${index}]`, issues));
    return;
  }

  if (!isRecord(value)) return;

  for (const key of ["$id", "$ref", "$defs", "definitions", "anyOf"]) {
    if (key in value) {
      issues.push(`${path} contains provider-internal key ${key}`);
    }
  }

  if (("enum" in value || "const" in value) && !("type" in value)) {
    issues.push(`${path} uses enum/const without an explicit type`);
  }

  const typeValues = Array.isArray(value.type) ? value.type : [value.type];
  if (
    typeValues.includes("object") &&
    !isRecord(value.properties) &&
    value.additionalProperties === undefined &&
    value.propertyNames === undefined
  ) {
    issues.push(`${path} is an object schema without properties`);
  }

  if (isRecord(value.properties)) {
    for (const [key, child] of Object.entries(value.properties)) {
      scanProviderSchema(child, `${path}.properties.${key}`, issues);
    }
  }
  scanProviderSchema(value.items, `${path}.items`, issues);
  scanProviderSchema(value.additionalProperties, `${path}.additionalProperties`, issues);
  scanProviderSchema(value.oneOf, `${path}.oneOf`, issues);
  scanProviderSchema(value.allOf, `${path}.allOf`, issues);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
