# Model recovery budget

Core owns one counter per logical model step. Adapter claims immediately before invoking the SDK.
Every physical request, including stream recovery and auth/provider fallback, shares the counter.
The counter has no reset method: only a successful complete model step releases its owner reference.
Limits are 21 physical requests and 30 seconds per ordinary exponential delay. Lower ordinary-backoff overrides are allowed. Provider Retry-After is independently accepted only when finite and within 0..300000 ms; adapter adds upstream positive jitter up to min(20%, 5000 ms), so actual wait can reach 305 seconds. Larger hints fall back to ordinary backoff even if uncapped exponential growth exceeds the hint. Governor cooldown uses only accepted positive hints, without extra jitter.
This pure module performs no I/O and exposes no provider or runtime implementation.

Adapter constrains the shared limit with constrainMaxAttempts; it can only decrease.
SingleAttempt provider fallback does not constrain the whole logical chain.
