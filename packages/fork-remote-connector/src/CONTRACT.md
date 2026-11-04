# Fork Remote Connector Contract

`@zcode/fork-remote-connector` owns the outbound device connection between a headless ZCode Server
and the self-hosted Relay. It does not own projects, tasks, sessions, the Core service collection, or
the Relay's device catalog.

## Invariants

- `createForkRemoteConnector` has one active Relay generation and one active terminal bridge.
- The connector obtains a device ticket through the existing authenticated V2 HTTP contract and
  sends `auth_init` with the persisted `device_sid`.
- A valid `auth_ack` marks startup ready even when pairing is `waiting`; a phone is not required
  during startup.
- Relay ticket HTTP `401`/`403` and WebSocket `AUTH_FAILED` are terminal authentication failures.
  Network errors, Relay 5xx, `INTERNAL`, disconnects, and heartbeat expiry remain reconnectable.
- App payloads are accepted only while the current device socket is `matched`. Reconnection receives
  a fresh acknowledgement before queued bridge frames can replay.
- Bridge generation is checked before and after asynchronous open. A late open or frame from an old
  generation is closed or ignored.
- The loopback bridge retains Core frames emitted between socket open and router subscription, then
  delivers them once in arrival order. The RPC `Initialize` frame cannot be lost at this boundary.
- Raw RPC frames enter the existing acknowledged replay adapter only after `workspace-bridge-ready`;
  no second ServiceCollection, Host, Agent, or task queue is created.
- `stop()`, timeout, `AUTH_FAILED`, repeated `KICKED`, and a superseded bridge all release the
  current generation before a new one can own it.
- Headless platform operations return explicit safe results or unsupported errors; they never wait
  for an Electron handler.

`module.ts` is the public entrypoint. `openLoopbackCoreBridge` uses the Core's existing loopback
`/ws`; `buildHeadlessWorkspaceSnapshot` only projects the injected project service's primary roots.
