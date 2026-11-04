# Server cloud web access

This managed fork module owns only the Source Server's self-hosted relay configuration and
canonical operational log stream. The existing Server Supervisor remains the sole lifecycle
owner; this module cannot start, stop, restart, or create a second daemon.

Authentication succeeds before configuration is atomically replaced. The persisted record never
contains the password and is restricted to the Server instance. Logs are redacted before both
console output and persistence; readers never start Core or Supervisor. Callers provide only the
two canonical paths required by this boundary, so the module does not depend back on its host.

Each successful connect registers exactly one Relay V2 device and atomically persists its
`deviceMid` and `deviceSid`. Server start/restart reuses that pair; it never derives wire identity
from the independent Source Server installation id. A failed login or registration leaves the
previous complete configuration untouched.
