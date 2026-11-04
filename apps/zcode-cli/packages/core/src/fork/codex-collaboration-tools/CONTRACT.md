# Collaboration tool adapters

ToolEntry factories use the standard executor context with a caller-bound public
CollaborationToolPort. They perform schema validation, preserve context errors,
and own no scheduling, mailbox or state. Model output carries only declared fields.
Root status is provided from the actual root runtime; controller idle is not evidence
that root is idle. Completed/idle child with no retained text maps completed:null.

Role rendering uses actual tool availability, depth and the shared normalized config.
Default depth excludes spawning by children. No unavailable host tool syntax is copied.
Provider envelopes are rendered separately; provenance must be durable before Task3b
projects them. Tests live in test/fork-codex-collaboration-tools.
Canonical collaboration envelopes keep assistant identity. When the final provider
message is such an envelope, provider projection must append a payload-free,
host-owned continuation boundary so message-based providers do not interpret the
envelope as an assistant prefill. The boundary is transient, is explicitly not user
input, and must not alter latest-real-user accounting or canonical history.

Task3b host adapters validate agent profiles against their available list and model
selections against their model catalog. Factories cannot validate host availability.
Plan-mode descriptions derive spawn availability from the same registry registration
options and permission rules, and guide direct exploration when spawn is unavailable.
The managed boundary also covers the bootstrap builtin workflow prompt as a narrow
guidance seam. It imports shared command metadata, never Core runtime implementation.
