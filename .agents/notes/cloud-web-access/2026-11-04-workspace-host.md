# Server browser workspace host

- Boundary: the fork workspace host composes `IProjectService` and `ISourceServerWorkspaceService`;
  existing project storage owns project/task facts and directory policy. The connector owns bridge
  generations, AbortController cancellation, and attachment lifecycle. The Core constructs one host
  factory and one fresh `remoteSessionId` per lifetime.
- Order: read and verify owner/intent → prepare project or resolve exact persisted task → register
  stable-to-canonical identity through the workspace service → return the prepared remote target.
  A cancelled preparation is checked after every awaited boundary and cannot return a target.
- Project-tree RPC: the existing `bindRemoteProjectIdentities` decorator registers every root and
  historical cwd, including tasks in soft-deleted projects and projects created after bootstrap.
  Core exposes this decorator through its existing service collection; runtime closures and the
  workspace host retain the original authoritative service. The existing connection registration
  cache deduplicates by this Core's workspace service and path, evicting failed registration.
- Historical tasks use the persisted task reference and cwd. Remote orphan tasks and a cwd that no
  longer matches the project's immutable remote root retain the original service errors; the adapter
  does not introduce a second recovery policy. Initial fallback navigation allocates no task.
- Regression evidence: the first run failed because the host factory export was absent. The final
  ten `node:test` cases use temporary SQLite databases, real project migrations/repository/service,
  the actual alias repository, and the actual identity mapper. They cover empty-host entry, project
  preparation, canonical route mapping, historical task navigation, file-tree-only navigation,
  foreign-host and workspace rejection, remote project errors, and cancellation on both sides of
  identity registration. A follow-up RED reproduced an unmapped canonical identity after a project
  was created after bootstrap; the decorator closes that ordinary RPC entry point and the test
  confirms the inbound canonical seam and raw service ownership remain intact.
- Validation: focused host and Core cleanup tests 12/12,
  `pnpm exec tsc -b packages/zcode-server-cli --pretty false`, and scoped oxlint passed.
  Combined app checks and browser acceptance are coordinated by the parent task.
