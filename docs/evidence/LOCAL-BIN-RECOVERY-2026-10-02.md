# Local bin move browser recovery receipt — 2026-10-02

Parent: `132c41a21e5080751ae04184ec311ec8e2176875`. The [machine companion](LOCAL-BIN-RECOVERY-2026-10-02.json) records tested input hashes, commands, outcomes and private log hashes. Environment: macOS arm64, Node 24.16.0, native SQLite and local synthetic Chromium fixtures. Direct workstation verification only; no CI runner, delegated/cloud session, provider request, workflow, PR, merge or deployment.

## Qualification added

Partial D-013/D-016/D-017 engineering coverage: a dedicated browser component saves an exact submitted whole or partial bin move before transport. Recovery is scoped to organization/staff identity, restores original readonly details and uses the same native command key/body. Web Locks coordinate tabs in one browser profile. Current server authority still precedes cached results; native code is unchanged.

Six bin journeys cover wrong serial refusal followed by exact lost-response replay; stale reviewed stock refusal and cancelled/whole quarantine movement; a two-unit split leaving four units with conserved original cost and condition; reload/sign-out/same-account recovery with no control under another account; a competing tab blocked from transport until it recovers the original move; malformed/write-refused local storage with zero transport and unchanged stock; and an actually committed response with a wrong bin field that must retain original details for exact recovery after navigation. These are six journeys with multiple assertions, not six product acceptance gates.

The final selected browser invocation passes 34 inventory/serial/scan journeys including five bin journeys. A separate final invocation passes the partial-bulk recovery journey; 35 unique selected browser checks pass in total, including all six bin journeys. No full browser suite is claimed.

## Actual commands and outcomes

| Command | Actual outcome |
| --- | --- |
| `npm test` | Exit 0; 1,976 passed, zero failed/cancelled/skipped; 81,290.818542 ms. Native source and inputs are unchanged by the subsequent browser-only corrections. |
| `npm run typecheck` | Exit 0 on final source. |
| `npm run build` | Exit 0 on final source; existing chunk-size warning remains. |
| `npx playwright test --grep 'browser:.*(bin\|stock\|serial\|scan)'` | Exit 0; 34 passed, 46.6 seconds. The actual regex uses ordinary alternation as recorded in the companion. |
| `npx playwright test --grep 'browser: phone partial bulk putaway'` | Exit 0; one passed, 7.8 seconds. |
| `npm run format:check` | Exit 0 on final source. |
| Changed-source React Doctor and dedicated component scan | Exit 0; zero errors, two complexity warnings in changed-source scan and one complexity warning in dedicated bin scan. No clean full-project scan is claimed. |

Initial focused browser verification passed two of three checks and caught a partial-result validation bug: new lots start at revision 1. After that fix, a second invocation passed four of five checks and exposed the test fixture's wrong session endpoint. A third invocation passed five of six checks; the navigation test tried to click through an open modal. Correcting the test to close the retained review before navigation produced final passing results. All three failing logs and trace directories remain private. Earlier React command syntax failure and formatting logs are retained. Historical receipts remain unchanged.

## Review and limits

Self-review checks persist-before-transport, original payload/key retention, readonly recovery, lock scope, actor separation, storage error behavior, reply validation, definitive refusal versus uncertain outcome, abandoned UI updates, native current authority and original quantities/cost/condition. Storage cleanup failure rereads evidence and retains exact recovery. Final document/link/whitespace and publication checks are recorded separately in the companion.

Local storage retains product/location/serial/reason details after sign-out for the original account. Shared-device retention/protection, physical workstation residency, cleared storage recovery, independent devices, real scanners/printers/providers, production load/security/recovery targets and operator acceptance remain unqualified. A historical recovered receipt does not establish current physical stock location. Bins remain text identifiers. Runtime schema, server source, dependencies, lockfile, licenses and workflows are unchanged. The owner-authorized original source/tests/documentation snapshot excludes private stores, keys and logs. All 44 tasks and 10 product gates remain NOT VERIFIED; the full system is incomplete.
