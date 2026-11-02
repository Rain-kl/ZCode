# Collaboration tool adapters

ToolEntry factories use the standard executor context with a caller-bound public
CollaborationToolPort. They perform schema/profile validation, preserve context errors,
and own no scheduling, mailbox or state. Model output carries only declared fields.
Root status is provided from the actual root runtime; controller idle is not evidence
that root is idle. Completed/idle child with no retained text maps completed:null.

Role rendering uses actual tool availability, depth and the shared normalized config.
Default depth excludes spawning by children. No unavailable host tool syntax is copied.
Provider envelopes are rendered separately; provenance must be durable before Task3b
projects them. Tests live in test/fork-codex-collaboration-tools.
