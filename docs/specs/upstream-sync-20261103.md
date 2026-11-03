# 2026-11-03 upstream integration

## Scope and decisions

Integrate upstream/main a60ba6a7 from the last imported source 3c5b2276, without rewriting history or pushing. Work in an isolated worktree based on canary 3001ebec; preserve the original worktree's .gitignore and codex/ changes.

The user explicitly chose to rename the fork settings reload command to /refresh and adopt upstream /reload as single-session runtime restart. Keep the existing settings reload owner and maintenance-turn admission; do not introduce a second queue or state owner. Persisted fork reload completion events/markers remain readable. The new /refresh route must not dispatch session restart; upstream /reload must not dispatch fork settings reload.

Preserve local-only operation, removed off-peak entry points, GitHub update channels, direct WebFetch, tool modes, identity presets, search providers and the six-tool Codex collaboration runtime. Prefer upstream lifecycle ownership and adapt fork collaboration cleanup through existing ports, never resurrect the removed legacy subagent runner.

The user explicitly approved the upstream Retry-After allowance: accept provider hints up to five minutes, followed by upstream positive jitter (up to five additional seconds). Keep the fork's 21 physical request budget and ordinary exponential backoff capped at 30 seconds. Retry admission and adapter waiting must share this policy without adding a second cooldown after the adapter has waited.

The user explicitly retained unsigned Windows NSIS updates. Keep the GitHub feed and disable mandatory Authenticode enforcement in both runtime and packaging configuration; retain unrelated upstream launch-argument and packaged-source hardening. This does not remove macOS signing requirements or imply signed update metadata.

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

## Architecture adaptation

The collaboration tool contract tests consume the existing public ToolSearch exposure/search APIs. Upstream now manages those paths as `tool-discovery`; declare that dependency on `codex-collaboration-tools` instead of bypassing the new boundary. No state ownership changes.

## Compatibility adapters

Upstream data-sync and Source Server lifecycle now consume `compareSemverVersions` from its force-update module. This fork intentionally removes that module. Expose only the existing pure comparator via shared semver utilities; do not restore the force-update provider, endpoints, state or UI. The initialize RPC branch must deserialize its own body after upstream header-first dispatch, preserving the fork channel manifest without decoding unrelated request bodies twice.

## Validation record

- Original worktree remains on canary 3001ebec; unrelated .gitignore and codex/ unchanged.
- Rename commit 8c1491e0: tests-first red/green, shared/UI scoped typecheck and root lint passed before merge.
- Architecture full check: 0 violations; architecture engineering regressions: 51/51 passed.
- Adapter/model regressions: 410 passed; bootstrap command suites: 319 passed; provider regression runtime path: 11 passed.
- Final retained package fork Vitest project including updater: 51 files, 1157 tests passed (170.51 seconds). Expected jsdom canvas diagnostics remain; no failures.
- Core lifecycle/residency and owned cleanup race tests passed; detailed evidence in collaboration integration spec.
- CLI typecheck: 34/34 tasks passed after adapting the provider-regression tool to the removed subagents.enabled option. Invoked with root node_modules/.bin added to PATH for the isolated hoisted install.
- Full fork node:test runner: 7/7 groups passed.
- After Windows policy resolution, full root `pnpm typecheck` passed, including remote-main and CUA; root lint passed with 85 existing warnings and zero errors. Full architecture check reports zero violations, and all five fork removal feature guards passed (9583 scanned code/config files).
- Updater runtime regressions: 72 passed; feed/dependency/unsigned-policy node contracts: 15 passed. Windows unsigned installation itself was not run on this macOS host.
- Retry-After policy regressions: five adapter suites / 235 tests and governor / 48 tests passed. Contract build and adapters/bootstrap typechecks passed; scoped lint has zero errors and six existing warnings.
- Explicit fork-test discovery and collaboration removal engineering regressions: 3 passed. Final fork node:test runner: 7/7 groups passed, including the new unsigned Windows policy contract.
- Engineering affected selection chose all 157 engineering specs because this merge changes shared configuration. Per the existing affected-runner contract, it reported a full-suite skip and success without executing those specs; this is not a full engineering pass. Targeted architecture (51 tests) and fork discovery/removal (3 tests) runs above did execute.
- `pnpm docs:stale-phrases:check` passed across 2287 files. SQLite schema compatibility passed for both services and CLI stores; schema checker regressions: 8 passed.
- CLI lint actual runner executed with Corepack project version enabled: 2 errors (preexisting fork-modified oversized fs/index.ts 1642 and cold-event-merge.ts 805), 72 warnings; prior collaboration verification note recorded the same oversized files. Do not report as pass or hide with a broad admission exception.
- Desktop FRR01 refresh/restart separation E2E authored, fixture validation passed. First launch blocked by autoUpdater.ts merge markers in main build; no UI assertions executed. E2E source typecheck and fixture/lint checks passed. Do not claim desktop/mobile acceptance.

## Resolved product conflicts

- Retry-After: upstream accepts hints up to five minutes with positive jitter; the previous fork capped all waits at 30 seconds. User approved the upstream hint policy while retaining fork attempt limits and ordinary backoff.
- Windows Authenticode: upstream requires signed NSIS updates; user explicitly chose to continue allowing unsigned Windows packages. Preserve that fork policy, not the upstream enforcement hooks.
- Both decisions require regression tests and final checks before the atomic merge commit. No push is authorized.

## Final review regressions

- Upstream moved skills and dynamic announcements into runtime history attachments. Rebuilding only the fork context prefix left old settings visible after `/refresh`. Reuse the existing announcement reconciler at the maintenance boundary, remove only known disabled runtime attachment sources from the in-memory model projection, and keep original stored parts, ordinary messages, AGENTS and memory untouched. Also gate the per-request output-style reminder and preserve child identity isolation. Tests first failed, then passed: announcement 49, child prompt 10, fork refresh/identity node 16; core typecheck passed. No-change refresh is byte-identical; disable/re-enable follows the existing announcement owner.
- Real Electron FRR01 confirmed `/refresh` does not change runtime generation or issue model requests, and `/reload` advances generation while preserving task identity and user history. It then caught a missing refresh timeline marker after restart. This is a regression under investigation, not an accepted E2E pass; the continuation reply assertion has not yet executed in that failed run.

### Approved timeline persistence repair

The user approved reusing upstream transcript timeline persistence for refresh completion. A separate `timeline_event` assistant carrier with a fork-specific typed timeline part belongs to the existing session message/part store and is hidden from provider input. Its physical transcript position inherits active-branch, rewind and fork behavior. Do not create a session_entry ledger or reconstruct branch membership from timestamps, generations or nullable anchors. Persist before publishing completion, hydrate at the stored position, and deduplicate the live event against the durable completion identity. Required evidence includes first-command refresh, ordered repeated completions, restart, cut/rewind, fork, no duplicate or empty assistant work row, and the unchanged FRR01 desktop test.

The repair is implemented through the existing timeline owner, with strict fork timeline decoding and a managed bootstrap fork adapter. Real SQLite first-command write/reopen, same-event idempotency, part-write failure suppression and fork-prefix cloning passed. The strict legacy timeline export schema and mapper preserve completion identity and optional sourceCommandId rather than dropping the new part. Shared node regressions: 9 passed (including six existing refresh routes); V4 wire: 14 passed; shared typecheck passed. Final combined gates and real Electron FRR01 are recorded after completion.

The broader cold-merge run also exposed an old Agent/SendMessage test fixture. It was aligned to accepted spawn_agent identity and followup generation 2, retaining the running/cancelled lifecycle and stable original tool-call anchor assertions. Failure was captured before editing; all 19 cold-merge tests passed. This test correction does not change cold-merge collaboration behavior.

An expanded core persistence run exposed another stale fake: its streamText threw `not used`, contrary to the already specified fork nonstream-via-stream route. The test now provides text/finish stream events from the same fake generation result; original requested-model and factory-property assertions remain unchanged. Red was captured first; all 70 runtime-persistence tests passed. No model routing implementation was changed for this fixture repair.

## Post-repair gates

- Full root typecheck passed again after the final timeline and shared schema repair. Root lint again reports 85 warnings and zero errors; full architecture check has zero violations; all fork removal guards pass (12408 code/config files scanned, one generated file over 5 MB skipped by the existing scanner).
- CLI lint was actually rerun after final edits: two max-lines errors remain, `adapters/src/fs/index.ts` at 1642 lines and `bootstrap/src/zcode-protocol-v4/cold-event-merge.ts` at 830 lines, plus 72 warnings. Both files already exceeded the limit before this repair (cold merge was 805 lines); the minimal cold-recovery wiring increases its existing violation. No baseline refresh or suppression was added. This is a real remaining failure, not a pass.
- Final combined fork Vitest rerun after shared schema integration: 51 files / 1157 tests passed (255.31 seconds). Final node runner: 7/7 groups passed, including the new strict timeline protocol tests. CLI typecheck rerun: 34/34 tasks passed.
- Real macOS Electron FRR01 passed 1/1 with unchanged assertions: `/refresh` leaves generation/history/model-request count unchanged and emits its receipt; `/reload` increments generation while preserving task identity, user history and that receipt; the new runtime then replies successfully. Artifact: `packages/desktop/.e2e-artifacts/desktop-e2e-20261103034836677-p75939-160e432e8a8fcc16`. Test HOME remains isolated. This is desktop idle-path evidence, not mobile, busy-queue or Windows installer acceptance.
- After that replay, final targeted red/green regressions removed settled controlOnly start/end shells for a completion cut from the active branch and rejected an explicitly empty sourceCommandId (missing remains compatible). These narrow branch-cut/decoder changes were verified by unit tests and type/lint checks, not by another identical idle Electron replay. They do not add a persistence owner or broaden removal to ordinary turns.
- Final marker-focused suites: bootstrap five files / 358 tests and core two files / 73 tests passed; contracts/core builds, bootstrap typecheck, changed architecture and 11-file lint passed. Catalog/matrix marks only FRR01 covered / pending-review, not other SLR cases in the shared spec.
- `git diff --cached --check` reports only two upstream-preserved blank EOF lines (the provider SSE fixture and causality-order-functions.ts); both match the upstream snapshot. No owned-file whitespace errors remain.
