# Desktop steer replay evidence

The first actual replay reached the window after local-mode ARMS startup fixes.
M07a in both modes and M07c passed; M07b and M07g waited for a selected request
with the exact same 60s timeout as the fixture's delayed original response. Their
capture still showed the original pending. Increasing that timeout would retain
an unnecessary timer race.

Used the existing controlled-replay gate instead. The test clicks steer while
the original is held after first text, verifies no selected request, releases the
original unique suffix/end_turn, and checks that suffix in the selected request.
Queue identity, unselected item and double-click exactly-once assertions remain.
The gate regression was RED before fixture support, then actual Electron 5/5
GREEN in artifact desktop-e2e-20261102-113130-485. No product changes were needed.

This is a local desktop replay with an unchanged previously built Agent bundle;
the next Task3 adapter still requires its own build and integration validation.
Mobile/reconnect/active-goal-verifier cases are not established by these tests.

## Rebuilt runtime verification

Task3b production source frozen, then default WDIO rebuilt desktop and Agent without
`ZCODE_E2E_SKIP_AGENT_BUILD`. The same controlled-stream spec passed **5/5 in 48.4s**,
artifact `desktop-e2e-20261102-140831-421`. This replaces the earlier old-bundle evidence
for main-session steer only; it is not child UI or mobile validation.
