# Server cloud web access

This managed fork module owns the Source Server's self-hosted relay configuration, canonical
operational log stream, and browser workspace navigation boundary. The existing Server Supervisor
remains the sole lifecycle owner.

Authentication succeeds before configuration is atomically replaced. The persisted record never
contains the password and is restricted to the Server instance. Logs are redacted before both
console output and persistence; readers never start Core or Supervisor. Callers provide only the
two canonical paths required by this boundary, so the module does not depend back on its host.

Each successful connect registers exactly one Relay V2 device and atomically persists its
`deviceMid` and `deviceSid`. Server start/restart reuses that pair; it never derives wire identity
from the independent Source Server installation id. A failed login or registration leaves the
previous complete configuration untouched.

Browser navigation uses the existing project's authoritative host, task, and directory rules.
The current-host `local` alias resolves to this Server's owner identity. Foreign hosts and
unverified workspace targets are rejected. Existing tasks keep their persisted execution directory;
project drafts require an explicit project. The initial workspace opens the host interface and
allows the first project to be created.

Workspace targets expose stable remote identities and one connection session for the current Core
lifetime. Project and task identities are registered before a browser attachment is returned.
Each project-tree response registers its project roots and task directories before publication,
including projects created after the initial connection. Registration is reused within the current
Core lifetime; a failed registration is retried on the next request.
Cancellation prevents an obsolete navigation from publishing a prepared target; the connector owns
navigation generations and attachments, while project and workspace services retain their facts.
