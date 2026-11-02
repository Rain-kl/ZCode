# ZCode collaboration tools

ZCode uses six collaboration actions. Use these directly in skill instructions;
there are no old subagent tool aliases or compatibility calls.

| Intent | Action |
| --- | --- |
| Dispatch a fresh implementation or review task | `spawn_agent` with a unique `task_name`, `fork_turns: "none"` and a complete `message` |
| Provide information to an existing collaborator | `send_message` with `target` and `message`; it does not start an idle agent |
| Continue an existing task or request a recheck | `followup_task` with `target` and `message`; retains the agent's session and history |
| Stop one collaborator's current run | `interrupt_agent` with `target`; retains identity and history |
| Inspect loaded collaborators and statuses | `list_agents` |
| Wait for messages or terminal activity | `wait_agent`; read delivered messages for the actual result |

Use the `task_name` returned by spawn as the target. Names contain only lowercase
letters, digits and underscores. A full-history fork uses `fork_turns: "all"`
(the default), inherits the parent model and reasoning effort, and cannot accept
model or reasoning overrides. Use a fresh fork for independent review and supply
all necessary context explicitly.

`wait_agent` does not return the result body or cancel collaborators. New user
input can wake a waiting parent without stopping its children. Messages enter
active model context at the safe request boundary. Ordinary send queues for an
idle recipient; use followup when work should start.

Respect available concurrency and depth. Completion releases execution capacity
automatically; interrupt is for stopping work, not a required completion cleanup.
All agents share the working directory, so assign independent write scopes and
preserve unrelated edits. User and applicable project/skill authorization govern
delegation.
