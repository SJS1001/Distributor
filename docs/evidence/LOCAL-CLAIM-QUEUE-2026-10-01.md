# Local Returns claim queue evidence

Partial D-030–D-033 and scoped claim/authorization engineering evidence. All 44 tasks and 10 gates remain NOT VERIFIED. [Hash-bearing companion](LOCAL-CLAIM-QUEUE-2026-10-01.json) and [queue operation](../WARRANTY.md#browse-the-claim-queue).

Parent `a54943db8fb8805c835c3c55c5229c3804b6a2ad`, branch `codex/local-distributor-checkpoint`. The companion identifies 309 unchanged tested input hashes and actual command UTC times, exits and log hashes. Checks ran 2026-10-02 UTC (2026-10-01 Toronto), on the direct macOS arm64 workstation with Node 24.16.0/npm 11.13.0, synthetic SQLite and loopback HTTP/Chromium. No schema, dependency, license or workflow change. No CI/cloud/delegation, provider/device request, push/PR, live data or deployment.

| Check | Actual outcome |
| --- | --- |
| `npm test` | PASS 1557/1557, including five new queue tests |
| `npm run test:e2e` | PASS 71/71 with production build, including two new queue journeys |
| `npm run typecheck` | PASS, exit 0 |
| `npm run format:check` | PASS, exit 0 |
| `npm run verify:runtime` | PASS, exit 0; 194 copied inputs, 69 exclusively development packages absent, 27 child commands, CA/US startup twice each, authenticated PDF/ZPL replay and local encrypted backup/restore |
| Focused queue backend | PASS 5/5 |
| Focused queue browser | PASS 2/2 |

## Tested behavior

Native procurement, receipt, order acceptance, fulfillment and claim submission create the queue fixtures. Forty-five claims with tied timestamps traverse as 20/20/5 in reverse recording order, including actual application restart and a later native append. The dashboard supplies only the first page and continuation. State filters supply submitted and rejected claims separately, exclude other states and bind their cursors. Reviewing the cursor claim between pages does not prevent continuation. Read-only traversal conserves retained claim, inventory, money, command, event and audit facts.

Warehouse paging skips whole batches outside current custody grants. Persisted site/account changes refuse old continuations. Current role, inactive identity, forced password change and organization checks precede cursor reads; forged stale actor grants cannot restore authority. Buyers receive only their current account's claims without manufacturer cases. Real HTTP sessions check exact fields, known states, malformed/noncanonical/missing/foreign cursors and session revocation. Returned projections exclude internal row positions. These are local authorization checks, not production security qualification.

The 390-by-844 phone journey loses a page response, preserves the first 20 rows and retries the same cursor, then reaches all 45 claims. Keyboard focus stays on the pager or moves to the heading at completion. A failed state-filter request clears the old filter's rows and retries; submitted/rejected/empty queues return their expected counts. No viewport overflow or browser errors occur. A buyer journey holds requests and observes their cancellation on filter change, refresh, navigation and sign-out; current results never include the cancelled page.

## Corrections and limitations

Initial backend failures came from test fixtures: a shared cart helper selected the revision without the warehouse, and login omitted the required Origin. The new fixture now uses its exact account/warehouse cart and correct login header. Initial phone runs could not locate the implicit label containing select options; an explicit label/id corrects the selector. New test instrumentation initially lost the generic Store return type; its signature now preserves it. Failed/superseded logs and phone traces remain private and hashed; no assertions or authorization checks were relaxed.

Each response contains at most 20 claims, using 21-row SQL lookahead batches. Warehouse eligibility can scan multiple batches; per-claim replacement/manufacturer histories and the legacy direct-module list remain unbounded. No new index or large-data/lock/throughput qualification is claimed. This is a live queue: new claims require refresh, reviews/custody changes can move rows between filters, and the UI removes repeated IDs. It is not a snapshot export. Actual coverage/remedy terms, devices/providers, infrastructure residency, production security/load/recovery, agreed RPO/RTO and operator acceptance remain outstanding. The full system is incomplete; no product gate is accepted.
