# Task 2: durable root-owned collaboration controller

## Decision

One app owner, finite injected runtime/storage/clock/ID ports. The old runner starts a model
before its caller can establish durable acceptance, so do not wrap runExploreAgent as an
admission method. Prepare -> install mailbox -> admit (no model execution) -> atomic accepted
snapshot -> run is the required sequence. Root keeps its reserved capacity; loaded handles,
known identities and active runs are distinct resources.

Mailbox ACK is a durable ownership transfer, not a read receipt. Runtime deduplicates message IDs;
root entry dequeue can fail after ACK and must safely replay. Root/idle delivery is explicit at
its safe boundary. Plain send never starts an idle turn. Session history belongs to the runtime
and survives error/interrupt/unload. Controller owns the identity tree and all acceptance state.

A cold entry can contain a pre-accept reservation; release with no loaded handle must be
idempotent and discard only unaccepted session storage. A missing accepted transcript is a
restoration error, never grounds for constructing a blank replacement. Terminal save failures
remain visible via flush and preserve a completion for explicit retry. Projection exceptions
cannot roll back a durable spawn. Error cleanup aggregates causes rather than hiding the trigger.

## Evidence

- Contract/design written first. Missing owner: 19/19 RED; first implementation19/19 GREEN.
- Additional RED rounds: cold pending identity, terminal persistence retry, runtime result schema,
  strict snapshot/settings, failed cleanup cause, projection observer and interrupt notification,
  call-ID scope across nested agents. Final36/36 GREEN using explicit src-test Vitest include.
- Core tsc noEmit passes. Architecture changed gate passes with no exemption. New controller
  and helpers remain under800 lines after formatting. Source driver has no direct IO/timers.
- Core lint failure: untouched tool/executor/background-tasks.ts and runtime/methods/session-fork.ts
  max-lines. No full-CLI success claim. Final integration owns root/CLI aggregate gates and E2E.

## Integration boundary

Exported createCollaborationController(options), parseCollaborationSnapshot(value,rootSessionId).
Driver prepare resumes exact childSessionId, installMailbox has no polling, admit returns
{run,cancel}; run is the sole model execution edge. Storage read returns undefined for absent;
all other values require strict version1 validation; write atomically replaces root session entry.
subscribe produces detached snapshots for registry projection and lifecycle events, including
runtime load/unload changes. It is not another accepted queue. IDs must remain globally unique
across restarts; call-ID dedup is scoped to callerId. Task3 must thread traceId/profile and model
selection through the actual runtime, preserve custom SubagentPort injection, and verify provider
message metadata survives store/load without extending global roles.

No push. User-owned codex/ reference checkout is untouched and unstaged.
