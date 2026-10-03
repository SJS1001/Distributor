# Local receipt history verification — 2026-10-02

Parent `b4ac227fce7f671f4bc6ddd238f84b08884b7dbb`, branch `codex/local-distributor-checkpoint`. Direct workstation checks on macOS arm64, Node 24.16.0 and production headless Chromium with disposable synthetic stores. The [machine receipt](LOCAL-RECEIPT-HISTORY-2026-10-02.json) binds tested source/test/config inputs, assets and private failed logs/traces. No CI runner, provider IO, PR, merge or deployment.

## Reproduction and change

Old-build controlled journeys reproduced a delayed successful history read reopening after navigation, delayed failure affecting another page, sign-out causing an unhandled unauthenticated refresh error, and read-only Close reporting Saved. A selected AbortController and identity fence now discard abandoned responses/errors. Active errors clear busy state and permit retry. Close and Cancel dismiss history without writes, Saved or dashboard refresh. Native source/schema/dependencies are unchanged.

Original fixture errors (missing origin, sign-in/Close selectors), valid red runs and an interrupted initial green run remain private. Two proposed tests attempted to click background navigation/Refresh behind an open modal; the modal correctly blocked them. Those invalid interactions were removed; actual navigation/sign-out during pending reads and Close/Cancel remain tested.

## Fresh outcomes

- Five targeted journeys pass in 10.8 seconds: delayed navigation success, delayed navigation error, sign-out, active failure/retry and Close, and Cancel. Purchasing facts remain unchanged and no page errors occur.
- Final complete production Chromium suite: 189 passed, zero failed, 3.9 minutes. Final source/config inputs remained unchanged during the run.
- TypeScript, production build and formatting pass. Existing large-bundle warning remains.
- Changed-source React Doctor diagnostic JSON retains one error and two warnings. App complexity is existing. The loading warning points to a reset inside guarded `finally`. The impurity error points to Refresh's ordinary `onClick` callback calling `run(refresh, false)`, rather than a React state updater. Source review finds those two classifier false positives; this scan is not declared clean. The previously recorded full-App baseline remains unclean and was not rerun here.
- No fresh native suite result is claimed because native inputs are unchanged.

Self-review checks active failure/retry, busy-state recovery, session/navigation boundaries, cancellation and read conservation. Other browser engines, actual operators/devices, production security/load/recovery/residency and provider qualification remain open. All 44 tasks and 10 gates remain NOT VERIFIED; full-system completion is not claimed.
