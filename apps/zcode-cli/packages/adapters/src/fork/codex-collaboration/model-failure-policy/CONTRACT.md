# Workflow failure policy

Runner retry gates consume the adapter classifier's bounded retry facts for every session type.
Workflow inspection follows error causes and maps exhausted recovery budgets to a recoverable provider stop.
The existing model/workflow-model-failure-policy.ts entrypoint remains a compatibility re-export.
No driver may automatically create another model chain after recoveryBudgetExhausted.
Adapter normalization carries a typed localControl disposition for local request validation,
permission denial and blocked upstream access. Inspection preserves that fact through cause
wrappers and returns a stop policy, so the outer driver cannot reopen a forbidden request.
Request preparation and runtime header refresh failures carry prepare_failed and stop as well.

2026-11-03 upstream integration: keep this module as the only policy owner. Import upstream unknown-provider-code consecutive counting and plausible quota-reset timestamp parsing, preserving local-control and exhausted-budget terminal stops. Ordinary adapter backoff stays capped at 30 seconds and the physical budget remains 21. User-authorized Retry-After accepts 0..300000 ms independently of ordinary maxDelayMs and preserves upstream upward jitter (20%, at most 5000 ms), reaching at most 305 seconds. Above-five-minute hints are rejected even below uncapped exponential growth; governor cooldown accepts the same hint interval without extra jitter. No hint opens another driver retry chain.
