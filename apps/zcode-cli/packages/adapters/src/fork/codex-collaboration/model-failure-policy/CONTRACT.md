# Workflow failure policy

Runner retry gates consume the adapter classifier's bounded retry facts for every session type.
Workflow inspection follows error causes and maps exhausted recovery budgets to a recoverable provider stop.
The existing model/workflow-model-failure-policy.ts entrypoint remains a compatibility re-export.
No driver may automatically create another model chain after recoveryBudgetExhausted.
Adapter normalization carries a typed localControl disposition for local request validation,
permission denial and blocked upstream access. Inspection preserves that fact through cause
wrappers and returns a stop policy, so the outer driver cannot reopen a forbidden request.
Request preparation and runtime header refresh failures carry prepare_failed and stop as well.
