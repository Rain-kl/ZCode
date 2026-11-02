# Task 2 quality: quarantine pending cleanup and close resources despite failure

Failed release handles cannot be admitted again while their release is pending.
Per-agent retryCleanup cancels pending admission then releases the retained handle.
ensureLoaded and mailbox drain invoke it in the existing command lane; flush's
cleanup batch uses that same lane. A gated release therefore finishes before a
concurrent followup can restore/admit the next generation. No extra owner/polling.

Dispose closes normal admission and aborts every child before persistence IO.
It attempts save and every independent resource release, aggregates their original
structured errors, and preserves failed save/cleanup for explicit maintenance
flush/dispose retry. Ordinary commands remain CLOSED after a failed shutdown;
maintenance remains reachable. The parent/root stores must stay open until the
host has awaited cleanup. Failed storage can leave old durable running records;
that failure is exposed and cold recovery still maps them to interrupted.

RED/GREEN: failed-unload→followup→flush; failed-unload→gated flush release→concurrent
followup; shutdown with save failure plus one child release failure while another
child still aborts/releases. All3 initially failed; final53/53 tests pass. Regressions
assert same-session reprepare/history, loaded running visibility and working interrupt,
all signals aborted, every release attempted, preserved compound errors, CLOSED new
spawn, maintenance retry and repeated dispose. Two additional shutdown settlement
cases cover accepted abort rejection and late completion: flush resolves without
asynchronous error noise; no stale terminal overwrites interrupted generation. Core types/module lint/architecture pass.

Fake drivers now live under managed core/test/fork-codex-collaboration; pure settings
validation extracted without state. No real runtime/desktop integration modified.
