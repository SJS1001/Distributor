# Local short-pick allocation and stock review

Date: 2026-10-01. Parent local commit `34a10dbf4fa6d0ae1da9ecc00c402475f2e8d1d1`; branch `codex/local-distributor-checkpoint`. Partial engineering for D-015/D-021/D-026/D-029 and G2/G3/G5. All 44 tasks and 10 gates remain NOT VERIFIED; full-system goal remains incomplete. [Machine companion](LOCAL-SHORT-PICKS-2026-10-01.json) binds candidate, documentation, workstation logs and unchanged historical evidence.

Previously unavailable allocations had no recorded shortage-to-backorder workflow. Warehouse staff now submit exact order/stock revisions, allocation, unavailable whole quantity and evidence. Fulfillment subtracts active packing; Orders releases only the reported allocation quantity; Inventory quarantines expected book stock, splitting partial bulk at original cost with procurement origin retained. Other reservations, packed stock, ordered/shipped/canceled quantities and customer exposure remain intact. No invoice, credit, refund or book loss is created by the report. Found stock requires inspection before reallocation. Confirmed bulk loss uses a separate count observation and administrator review; serialized custody/writeoff remains pending.

The report, stock/allocation/order/movement sequence, event, audit and exact command receipt share one transaction. Current real identity/site/password checks precede cached results and history. Changed same-key requests conflict. Strict HTTP fields, origin/CSRF and per-order history cursor validation are enforced. History pages contain at most 20 reports with timestamp/ID ordering; the browser retains prior history after a failed page and supports retry and mobile/Escape navigation.

## Observed direct workstation checks

| Command | Actual outcome |
| --- | --- |
| `npm run typecheck` | Final candidate PASS. |
| `npm run format:check` | Final source/test/configuration PASS. |
| `npm exec -- tsx --test tests/short-picks.test.ts tests/fulfillment.test.ts` | Earlier 14/14 PASS, 1610.787 ms; final full regression additionally covers the subsequent separate warehouse-observer/admin-review fixture. |
| `npm test` | Final 321/321 PASS, 11266.82675 ms; zero fail/cancel/skip/todo. |
| `npm run test:e2e -- --grep 'browser: short picks'` | Build PASS (101 ms); corrected new journey PASS (1.4 s), 1/1 (3.1 s overall). |
| `npm run test:e2e` | Production build PASS (78 ms); 25/25 journeys PASS (47.1 s), new short-pick journey 1.5 s. |

Environment: macOS arm64, Node 24.16.0, npm 11.13.0, SQLite 3.53.0; disposable synthetic databases and loopback headless Chromium. No CI runner or actual provider request occurred. The final backend run covers all implementation and backend tests; a subsequent browser-only selector correction is covered by final type/format and focused/full browser checks. Planning/link and whitespace checks prove document consistency only.

Eleven new backend scenarios cover partial picked bulk with existing packing, another order's shared lot reservation, serial substitution and original held identity, count observation/review and original cost, purchase origin across splits, exact retries/restart/payload conflict, malformed/stale/foreign inputs, packed overlap and voiding, late-audit rollback, current real grants/site/active/password constraints, support/commercial/buyer visibility, tied timestamps and foreign cursors, strict HTTP/CSRF, and separate OS-process packing/shortage contention using a ready barrier. Financial facts remain unchanged until actual handover or separately approved loss. Contending processes admit one outcome and preserve serial quantity/cost without an invoice.

The browser journey creates synthetic bulk stock/order, packs one unit, reports two unavailable units while intentionally losing a committed response, and retries the same key to produce one report. It creates further reports, loses a next-page read, retains the first 20 reports, retries to load 23 without duplicates, confirms one real handover, and cancels 24 backordered units. Only the handed-over unit is invoiced (2,825 cents); remaining book stock is 24,000 cents. Narrow-screen overflow and page errors are checked. This establishes local behavior, not actual physical custody or operator acceptance.

## Preserved failures and self-review

Initial test typing exposed incorrect query-schema optional arguments, inventory receipt fixture arguments and HTTP payload typing. Corrected to the schema's optional string array, owning procurement receipt command and typed JSON payload. Initial focused regression passed 10/11: the packing-race loser reports `STATE`, whereas the test expected `REVISION`; corrected the expected existing conflict without relaxing the exactly-one outcome invariant. Subsequent focused checks passed 14/14.

The first browser attempt failed because its customer-only row locator matched both cart and order. Bound the order row to its actual short ID. The next attempt timed out waiting for a guessed handover button; the collection action is **Confirm collection**, opening the handover dialog. Corrected the selector and exact **Handover evidence** label. The final focused browser passes. Failed logs and traces are preserved alongside successful reruns; formatter writes are not verification passes. Runtime color warnings remain in browser logs.

Self-review checked module ownership/transaction boundaries, release-before-split stock conservation, protection of other reservations and active packing, original cost/procurement lineage, quarantine versus actual loss, revision fencing, current authorization before cached results, strict HTTP/CSRF, tuple pagination and failure/retry UI. No dependency/lockfile/license changes or copied third-party implementation. Historical receipt bytes remain unchanged against parent. The global predecessor HANDOVER.md remains unavailable at its instructed path; concrete repository self-review was performed.

## Limits and continuation

Expected quarantined book stock may not physically exist. Actual bin/lot segregation, counts and evidence require warehouse/finance approval; partial lots sharing a bin need a complete physical review to avoid double counting. Serialized shortage custody/writeoff, attachments, disputed/corrected reports and production approval-duty policies are pending. Pages bound server rows; continued UI history loads accumulate displayed text. Source lineage, allocation/packing queries, synchronous database locks and wall-clock cursor ordering require production index/load/clock/archive/retention/security/upgrade/restore qualification. Real carrier bookings/labels/tracking, devices, residency, operator acceptance and full-system gates remain open.

Continue serialized shortage review and other fulfillment exceptions, accounting/import/provider operator boundaries, individual carrier/device support and production/human acceptance. Current execution remains direct workstation checks and local commits only: no local/self-hosted/cloud CI jobs, workflows/registrations, push/PR, actual provider accounts/requests, deployments/purchases, live data, publication/settings changes or OPUS/UB integration. Future CI remains GitHub-hosted after separate authorization and qualification; no fresh remote-access claim.
