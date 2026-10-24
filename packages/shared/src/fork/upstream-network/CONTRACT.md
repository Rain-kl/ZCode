# Upstream network policy

`isUpstreamRequestAllowed(url, method, aliases)` is the single pure decision owner. Known upstream hosts and configured upstream aliases are denied unless a reviewed anonymous read path matches. `assertUpstreamRequestAllowed` throws before transport and omits query secrets. Node bootstrap installs transport interception once per process; Electron Session uses the same predicate for each redirect and WebSocket handshake. See docs/features/upstream-network/design.md for scope and audit.
