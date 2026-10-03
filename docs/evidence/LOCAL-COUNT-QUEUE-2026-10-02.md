# Local scoped cycle count queue verification

Date: 2026-10-02. Tested parent: `c043867081991d737e4acab320b7bdc9743e9014` plus the candidate bound by the [machine receipt](LOCAL-COUNT-QUEUE-2026-10-02.json). Direct workstation verification on macOS arm64, Node 24.16.0, native SQLite and headless Chromium. No CI runners, cloud sessions, delegated agents, provider/device IO, PR, merge or deployment.

The new `/api/counts/page` reads at most 21 scoped rows and returns 20 count details. Current native organization/site authority and optional state constrain SQL before the limit. Canonical continuation tokens bind the organization, current sites, state and accessible anchor ID; tied timestamps use native row order without exposing row positions or start hashes. Anchors remain valid after state changes; changed scope, missing anchors and malformed tokens refuse. Fresh review policy and current approval eligibility accompany historical decisions. The compatible full-list endpoint also applies native custody scope before materialization. No schema, dependency, license, workflow or count mutation policy changes.

Inventory now shows a current page with state filters, older/newer navigation, refresh and exact failed-read retry. Pending or failed reads expose no stale rows/actions; abandoned reads cannot overwrite a new filter, refreshed Inventory, another screen or signed-out account. Existing observation/approval/rejection reviews use original evidence and exact command retries. Three new mobile/scoped browser journeys cover 20/20/5 navigation, support-only state visibility, empty grants, focus, read failures, lost committed approval replies and superseded responses. Native CA/US checks cover tied rows, state-changing anchors, forged/revoked authority, current independent-review policy, strict HTTP validation, restart and read conservation.

| Command | Actual outcome |
| --- | --- |
| `npm test` | Exit 0; 1,990 passed, zero failed/cancelled/skipped; 82,328.08375 ms. |
| `npx tsx --test tests/count-policy.test.ts tests/count-queue.test.ts tests/counts.test.ts` | Exit 0; 21 passed, zero failed/cancelled/skipped. |
| Focused count production Chromium journeys | Exit 0; three passed; 11.3 seconds. |
| Complete production Chromium suite | Exit 0; 184 passed, zero failed; 3.6 minutes. |
| `npm run typecheck` | Exit 0, including the final browser readiness correction. |
| `npm run build` | Exit 0; existing minified chunk warning above 500 kB. |
| `npm run format:check` | Exit 0, including the final browser readiness correction. |
| Changed-source React Doctor including untracked files | Exit 0; eleven files, zero errors, two warnings. |

React warnings concern existing main application complexity and a guarded count-page loading reset in `finally`; no suppression or clean full-project scan is claimed. The production build precedes browser verification; no concurrent rebuild changes its assets.

The initial focused native run passed 20/21: a test tried inserting an existing user-security row. The fixture now updates that row; the failed log remains private. The initial complete browser run passed 183/184 and timed out cancelling a retained transfer-loss review opened during initial Inventory loading. The initial read refresh remounted that component. The existing recovery test now waits for the visible Transfer queue before opening retained review, preserving all exact-attempt and stock assertions without a fixed delay or forced click. This is test readiness correction; early initial-load remount behavior is not claimed fixed. Its failed log, error context and trace remain private. Only this browser test file changed after the full native run; native test/runtime inputs are unchanged. The machine receipt preserves the earlier input hash and final input hashes.

Self-review covers module ownership, current native authority/policy, SQL scope/state before limits, cursor eligibility, original read/mutation behavior, exact retries, quantity/cost conservation, focus and abandoned replies. Paging reads current facts rather than a frozen historical snapshot. Legacy full-list reads, large-history query/index/locking costs, generic count review durability across reload, browser storage protection, physical custody, actual devices/providers, production security/load/recovery/residency and operator acceptance remain unqualified. All 44 tasks and 10 gates remain NOT VERIFIED; the full system is incomplete. Private data, credentials, raw logs/traces and generated build assets remain excluded from publication.
