# Codex collaboration controller

Public types: `contract.ts`. Construction and persistence schema: `module.ts`.
One root-owned controller owns identities, mailbox admission, accepted spawn IDs,
run generation, cancellation, capacity and restore. Runtime/clock/session-entry IO
is injected through finite ports; no provider, filesystem or registry dependency.

- `spawn` returns after the child identity/session exists, mailbox is installed,
  task is admitted, and acceptance is durable. Its caller signal is no longer
  consulted after durable acceptance. Replay the same call ID and arguments to
  recover the same identity. Agent/session/message IDs must be globally unique,
  including across process restarts.
- `admit` cannot execute a model until `TurnAdmission.run()`. It owns the task's
  transcript entry durably and deduplicates by message ID. Cancel releases an
  unstarted admission; it never deletes prior transcript history.
- `deliver` ACK transfers message ownership durably, idempotently by message ID.
  Repeating an ACK after root-entry persistence failure cannot duplicate context.
  Ordinary idle send only queues. Running send uses this same sink. Root and idle
  mailboxes are drained explicitly by the runtime at its safe consumption boundary.
- Runtime prepare resumes the exact childSessionId or fails with its cause. It
  must clean partial resources if prepare rejects before returning a handle.
  Release is idempotent, may receive no loaded handle after a crash, and discards
  persisted history only for a child that was never accepted.
- Storage read returns undefined for an absent entry; all other values undergo
  version/reference/schema validation. Atomic write failure leaves the old entry.
  Explicit memory mode is available; persistent mode requires matching storage.
- No driver may call back into a controller mutation and wait for it from inside
  prepare/install/deliver/admit/release/write; mutations serialize admission.
  Long model execution only happens in run(), outside that serialized lane.
- Root occupies one reserved execution slot. Idle runtime unloading preserves
  identity and mailbox. Terminal generations release execution capacity.
- wait only observes activity. It never consumes messages or controls child
  signals. Caller abort cancels that wait. Steer wakes wait without cancelling it
  through the parent/provider execution signal. Interrupt targets one child run.
- A failed asynchronous terminal save is surfaced by flush and retained for retry;
  another flush after storage recovery commits that same completion. No automatic
  timer retry masks the original failure. A failed save does not claim durability.

Acceptance order, race cases, remaining integration work and cross-client
boundaries: `docs/features/codex-collaboration/controller-contract.md`.

Review invariants: only idle/generation-zero identities without an accepted call
may be discarded during cold recovery. Other missing acceptance records are
corruption, rejected before any driver cleanup. Runtime release and admission
cancel must support idempotent retries. Acceptance failure aborts the independent
signal even if cancel fails. A failed cancel retains its admission; flush retries
cancel before releasing its runtime. Preparation failures retain both the mailbox
installation error and release error, together with the actual handle for retry.
