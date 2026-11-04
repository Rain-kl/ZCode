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

The Worker serves the browser entry at `/remote/v4`. `app_version` selects the exact host release;
an entry without a version starts with the current deployment. Every resource URL carries its
release version. Unknown versions return an explicit version-unavailable response.

ASSETS owns the current page collection. The optional REMOTE_WEB_ARCHIVE R2 binding owns immutable
published page collections: shared content-addressed blobs and one complete manifest per release.
Publication validates every file, creates blobs once, then creates the release manifest last.
Identical publication is idempotent; different contents for an existing release fail. Supported
release manifests and their referenced blobs remain available across Worker deployments.

Cloudflare Builds uses its commit identity to build the same full development version as the
Server release. Archive publication completes before deployment; missing archive credentials or
an upload failure fails the build. Ordinary local Web builds retain their existing behavior.

Every request reaches the Worker first: `/` redirects to `/remote/v4`, `/api/*` uses authentication
and Relay logic, and unknown API routes return JSON 404. A versioned resource must match its
manifest and can never fall back to SPA HTML. Legacy local assets without a generated manifest
remain usable. Tests use isolated temporary assets and local R2 storage.
