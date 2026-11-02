# Six tools only

The user explicitly rejected backward-compatible subagent tools on November 2:
“我不需要你做兼容. 直接讲旧的工具废弃掉. 全面转向新的工具”.
This supersedes the earlier hidden compatibility plan and custom-port exception.

Remove Agent/Task/SendMessage/RespondToCoordinator registrations, execution,
discovery, aliases and current guidance. Old direct calls fail as unavailable;
they are not silently redirected. TaskOutput/TaskStop retain non-subagent uses
only. Delete the old subagent scheduling/message ownership after the new driver
is wired. No new specialized old-history compatibility; no deletion/migration
of user transcripts or logs. New histories still require correct cold recovery.

Contracts and plan changed before implementation. Task3/4 must test absent old
registrations and direct calls, update bundled skills/examples, and register
behavioral fork-removal guards so synchronization cannot silently restore them.
Six-tool schemas and single-controller runtime integration remain required.
