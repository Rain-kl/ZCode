# 2026-11-03 upstream integration

## Scope and decisions

Integrate upstream/main a60ba6a7 from the last imported source 3c5b2276, without rewriting history or pushing. Work in an isolated worktree based on canary 3001ebec; preserve the original worktree's .gitignore and codex/ changes.

The user explicitly chose to rename the fork settings reload command to /refresh and adopt upstream /reload as single-session runtime restart. Keep the existing settings reload owner and maintenance-turn admission; do not introduce a second queue or state owner. Persisted fork reload completion events/markers remain readable. The new /refresh route must not dispatch session restart; upstream /reload must not dispatch fork settings reload.

Preserve local-only operation, removed off-peak entry points, GitHub update channels, direct WebFetch, tool modes, identity presets, search providers and the six-tool Codex collaboration runtime. Prefer upstream lifecycle ownership and adapt fork collaboration cleanup through existing ports, never resurrect the removed legacy subagent runner.

## Fork verification exception

Upstream retires App business UT and keeps an explicit engineering project. Adopt that retirement for untouched upstream tests, but retain fork-owned and fork-modified dependency-contract regressions (plus their minimal fixture import closure) under explicit fork test entries. Keep the node:test fork runner and dedicated Vitest fork project; do not restore broad App test discovery. This preserves the user-required dependency API contracts without undoing upstream test retirement.

## Ownership and delivery

```text
/refresh -> existing command admission -> fork settings maintenance turn -> completion projection
/reload -> upstream session lifecycle owner -> stop owned work -> restore same history
Desktop continuous / Mobile replayable -> existing shared Host -> same session owner
```

## Acceptance and sequence

1. Update refresh spec and command-routing regressions before implementation; demonstrate the rename regression fails, then implement and commit only owned files.
2. Preview merge conflicts; preserve explicit removals, adapt fork wiring to upstream contracts and record product conflict decisions in FEATURES.md.
3. Verify refresh/reload independence, collaboration owner cleanup, removals and affected contract tests. Run typecheck, lint, architecture checks and fork removal guard; document actual results and E2E gaps.
4. Commit the merge on codex/sync-upstream-20261103. Do not move the dirty original worktree or push.

## Validation record

Pending.
