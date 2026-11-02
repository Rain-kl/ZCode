# Protocol shutdown ownership

The process lifecycle owns its absolute exit deadline. This module owns app
resource handles and accepted app creations, and consumes finite cleanup ports.
It does not own session queues, model recovery, collaboration state or storage.

`ProtocolRuntimeResources.close()` is idempotent, rejects new creation, stops
existing apps and waits for accepted factories to settle. Late apps are closed
without publication. A normal publication rejection does not fail the drain;
an actual late cleanup failure does. App stop/close runs at most once.

`cleanupProtocolRuntime()` uses the existing absolute deadline. Mutable shared
dependencies close only after app drain succeeds. On failure or timeout it
reports original error context and retains those dependencies for process exit;
projection and diagnostic cleanup still run. Late settlement does not trigger
detached dependency cleanup.

```text
stop input → one app owner drains accepted resources → close dependencies
                                    failure/timeout → retain until process exit
```

The existing protocol files only re-export this module. Behavior regressions
live in `tests/protocol-runtime-shutdown.test.ts`; contract.test.ts verifies the
single public wiring. The production-wrapper acceptance is separate from the
independent HTTP fixture.
