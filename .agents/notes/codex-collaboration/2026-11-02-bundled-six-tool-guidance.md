# Bundled instructions use the six tools

Removing old executable entries also requires removing their active instructions.
The shipped review templates still used Task-tool fields and parallel examples
called Task(...); dynamic-workflows routed simple delegation to Agent. These now
use native spawn_agent with task_name, message and explicit fresh context, plus
six-tool lifecycle guidance. The workflow script agent() API remains untouched.

Added an explicit ZCode mapping selected by using-superpowers, preserving other
platform references as foreign documentation rather than a compatibility path.
Wait observes activity and the mailbox carries results; send does not start idle
work, followup does; terminal releases execution capacity automatically.

Evidence: ten actual bundled-Markdown contract regressions initially RED, then
16/16 including existing pack tests GREEN. Spec review caught quality-template
context outside message; a dedicated RED reproduced it, then message block
indentation fixed it and final17/17 GREEN. Bootstrap tsc and scoped lint pass.
Full integration/root checks remain part of the larger migration, not established
by Markdown contracts. No remote push.
