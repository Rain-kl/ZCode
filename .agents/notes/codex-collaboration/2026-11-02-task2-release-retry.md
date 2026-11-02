# Task 2 rereview: complete runtime unload after release retry

A failed idle unload retained its loaded handle for recovery. flush retried the
external release successfully but only removed cleanupPending, leaving list and
followup pointed at the released runtime. Normal and retried release now share
completeRelease: remove the cleanup marker, remove loaded, publish projection.
Identity, mailbox and session history remain owned by their existing components.

The retry record explicitly stores discard and passes it unchanged. Accepted
sessions use false on both attempts, so retry cannot delete their transcript.

One failing fake-driver lifecycle regression observed the child remaining in
list. After the fix all48 module tests pass; it also asserts unloaded projection,
mailbox/history survival, a new resume=true prepare and the same childSessionId.
No Task3/runtime/E2E changes and no remote push.
