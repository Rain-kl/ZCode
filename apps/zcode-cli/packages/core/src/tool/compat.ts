// FORK(codex-collaboration): 旧 Agent/Task 不再拥有别名或执行入口。

const hookMatcherAliasesByToolName = new Map<string, readonly string[]>([
  ["ApplyPatch", ["Write", "Edit"]],
]);

export function isSubagentDispatchToolName(toolName: string | undefined): boolean {
  return toolName === "spawn_agent";
}

export function hookMatcherToolNamesForTool(toolName: string): readonly string[] {
  const aliases = hookMatcherAliasesByToolName.get(toolName) ?? [];
  if (aliases.length === 0) return [toolName];

  const values = new Set<string>([toolName]);
  for (const alias of aliases) values.add(alias);
  return [...values];
}
