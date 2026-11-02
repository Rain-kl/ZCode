# Desktop steer acceptance

The product boundary is unchanged: a queued text steer waits until the active model
response and its tool results complete. It consumes only the selected queue item,
exactly once; a typed goal remains queued until the runtime can admit that intent.

The first November 2 replay passed M07a in both message modes and M07c, but M07b
and M07g timed out at the same 60 second boundary as their delayed base response.
The capture still showed that base request pending. This is insufficient evidence
to distinguish a product failure from the fixture timer racing the assertion timer.

Use the existing replay server's controlled stream gate for the base response.
Send the first text chunk, hold before a unique final text chunk and end_turn,
click steer, and assert no selected provider request while the gate remains closed.
Only then release the base stream. The next request must contain the unique final
chunk of that original response. Keep the selected response running while checking
the original unselected item ID, FIFO order and single consumption. Do not change
the product clock, shorten the product stream or remove the negative assertions.

```mermaid
sequenceDiagram
  participant Test
  participant Runtime
  participant Replay
  Runtime->>Replay: original model request
  Replay-->>Runtime: first text chunk
  Note over Replay: hold before final chunk
  Test->>Runtime: steer selected queue item
  Test->>Test: no selected request; original item retained
  Test->>Replay: release existing controlled gate
  Replay-->>Runtime: unique final chunk and end_turn
  Runtime->>Replay: selected request with complete original assistant
  Test->>Test: selected once; unselected original ID retained
```

This is desktop continuous delivery evidence. It does not establish mobile
replayable recovery or the new child runtime adapter's behavior.

## Executed evidence, November 2

- Original timed replay: 3/5 passed, M07b/M07g timed out with the original base
  request still pending; artifact `desktop-e2e-20261102-112106-936`.
- Added gate-based assertion first: M07b failed because its fixture had no gate;
  artifact `desktop-e2e-20261102-112936-180`. Then replaced base delay timers with
  the existing controlled stream gate; production code was unchanged.
- Final actual Electron replay: **5/5 passed** in 47.2 seconds; artifact
  `packages/desktop/.e2e-artifacts/desktop-e2e-20261102-113130-485`, including
  captured provider requests and UI results. M07a passed in both MCS modes;
  M07b/M07g retain the unselected queue item's original ID and check the full
  original stream suffix in the selected request; M07c preserves typed goal.
- Command: `ZCODE_E2E_SKIP_AGENT_BUILD=1` with the common and running-send-now
  replay fixtures, `pnpm --filter @zcode/desktop exec wdio run wdio.conf.ts --spec
./test/e2e/conversation-session/conversation-session-running-send-now.test.ts`.
  Desktop was rebuilt; the unchanged steer Agent bundle was reused. This run
  does not validate the subsequent collaboration runtime integration.
- Default replay, without explicit fixture paths: **5/5 passed**; artifact
  `packages/desktop/.e2e-artifacts/desktop-e2e-20261102-113619-467`.
  `e2e:fixture:check`, `typecheck:e2e` and root `typecheck` passed. Root `lint`
  passed with 102 existing warnings and no errors. Fixture validation retains
  its existing warning that the goal-continuation matcher has no E2E marker.

## Rebuilt collaboration runtime replay, November 2

After Task3b's production source was frozen, the default desktop replay rebuilt
the desktop and Agent bundle. `ZCODE_E2E_SKIP_AGENT_BUILD` was not set. The existing
controlled-stream spec passed **5/5 in 48.4 seconds**, artifact
`packages/desktop/.e2e-artifacts/desktop-e2e-20261102-140831-421`.

Command: `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm --filter @zcode/desktop exec
wdio run wdio.conf.ts --spec
./test/e2e/conversation-session/conversation-session-running-send-now.test.ts`.

This run covers the original response boundary, complete response suffix in the
next request, single selected-item consumption, retained unselected item and
typed goal queue behavior using the rebuilt collaboration runtime. It does not
exercise a spawned child's UI lifecycle or an actual mobile client. Those remain
separate Task4 acceptance boundaries.
