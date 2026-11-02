# Model recovery budget

Core owns one counter per logical model step. Adapter claims immediately before invoking the SDK.
Every physical request, including stream recovery and auth/provider fallback, shares the counter.
The counter has no reset method: only a successful complete model step releases its owner reference.
Limits are 21 physical requests and 30 seconds per delay. Lower overrides are allowed.
This pure module performs no I/O and exposes no provider or runtime implementation.

Adapter constrains the shared limit with constrainMaxAttempts; it can only decrease.
SingleAttempt provider fallback does not constrain the whole logical chain.
