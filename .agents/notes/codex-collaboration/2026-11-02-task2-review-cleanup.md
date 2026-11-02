# Task 2 review: reject unsafe restore and retain compound cleanup failures

A missing acceptance record is not proof that a child is unaccepted. Only an
idle/generation-zero placeholder can be discarded. The snapshot boundary now
rejects missing acceptance for all running/terminal/nonzero-generation children
before runtime cleanup, so corruption cannot delete accepted transcript history.

Mailbox install failure and runtime release failure are separate facts. Preserve
both under a structured prepare error and retain the actual handle plus discard
policy for retry. The outer spawn cleanup can retry that same handle immediately;
flush handles remaining resources. Never substitute undefined for a known handle.

Acceptance persistence/cancellation failure must abort the independent signal even
if admission.cancel rejects. Retain the admission for idempotent cancel retry and
defer runtime release until cancel succeeds. Aggregate both causes with the original
error code and phase. New turns cannot pass a pending admission cleanup.

Evidence: all11 added regressions RED before implementation;47/47 final module tests
GREEN. Cases assert no discard for9 invalid snapshot combinations, same-handle second
release after install+release failure, and save+cancel errors with signal aborted and
flush ordering cancel before release. No integration/E2E claim and no remote push.
