# Fork Remote Relay Contract

`@zcode/fork-remote-relay` owns the self-hosted Worker and Durable Object boundary. It authenticates
one configured tenant, registers devices, issues one-use role tickets, coordinates one device and
one terminal owner per device SID, and forwards valid V2 `data.payload` values without interpreting
or persisting them.

## Invariants

- `RelayRoom` is the only owner of device records, tickets, and `(device SID, role)` leases.
- A role comes from the consumed ticket; `auth_init` cannot change it.
- Replacing an owner sends `KICKED`. A late close from the replaced socket cannot release the new
  owner.
- Durable Object storage contains device and lease metadata only. Forwarded task/RPC data is never
  stored.
- WebSocket identity is serialized as a hibernation attachment and recovered through
  `getWebSockets()` after eviction.
- Browser sessions are stateless signed credentials. Incrementing `AUTH_EPOCH` revokes all issued
  sessions.
- Production deployment supplies `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `AUTH_SECRET`, and
  `AUTH_EPOCH` as secrets or deployment variables. No plaintext password belongs in source.

The public module surface is intentionally small: `contract.ts` describes deployment/runtime
bindings and `module.ts` exports the Worker and Durable Object entrypoints.

The deployed Worker also serves the built `packages/web/dist` SPA. Every request reaches the Worker
first: `/` redirects to `/remote/v4`, `/api/*` uses Worker authentication and Relay logic, and other
paths fall through to the asset binding. Unknown `/api/*` routes return a JSON 404 and never fall
back to `index.html`, while existing asset files are served byte-for-byte. Relay tests use an
isolated temporary asset directory so a stale or pre-existing `packages/web/dist` cannot make this
contract pass accidentally.
