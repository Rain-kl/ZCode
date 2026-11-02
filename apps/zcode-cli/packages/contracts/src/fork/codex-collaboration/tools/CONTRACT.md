# Collaboration tools

Six strict model tool contracts; caller identity is bound by the runtime port.
Input toolCallId comes from ToolExecutionContext, never model input. Full history forks
inherit model/effort and reject overrides. none permits runtime-validated overrides.
Statuses use Codex wire unions, not controller internal status strings. Message success
is an empty object internally and empty provider text. Private identities belong to
durable lifecycle metadata, not the spawn model result. No I/O or scheduler owner here.

Shared config defaults explicit delegation, 4 total slots, depth 1, 3 loaded children.
Root runtime selection/state and root identity are restored by the runtime adapter.
