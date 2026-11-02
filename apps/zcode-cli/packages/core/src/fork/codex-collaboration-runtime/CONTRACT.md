# Runtime collaboration adapter

The controller owns the durable graph. This module adapts AgentRuntime resources,
session-entry storage, prepared prompt admission, mailbox receipts and read-only
lifecycle projections. Resource maps contain handles, never independent accepted or
status truth. The runtime binding exposes six caller-bound tools, model boundaries,
accepted-input wakeups, native child interruption and awaited shutdown.
Driver release waits for the original accepted run promise to settle before closing
runtime resources. An abort notification is not a drain acknowledgment. The temporary
drain handle observes completion only; execution errors remain on the original run
and cleanup errors keep their causes. No independent timeout or accepted owner exists.
The root liveness query reads the whole canonical tree plus unsettled original command
handles and pending derived event writes. Child bindings read their subtree. Interrupted
status is not evidence that IO has drained, so automatic residency eviction remains blocked.

The root session entry restores identity and normalized limits before controller
creation. Child model-selection entries restore actual resolved selections. Only
unaccepted sessions can be discarded. Task receipts are durable and idempotent before
run; standard reserved runtime commands execute after controller acceptance.

Private message provenance survives history cloning and cold hydration. Provider
projection alone creates assistant envelopes. Tool metadata is written by standard
settlement; cold relation recovery uses the canonical root graph in a crash gap.

See docs/features/codex-collaboration/runtime-integration.md for ordering and acceptance.
