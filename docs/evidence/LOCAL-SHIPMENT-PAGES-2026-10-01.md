# Local shipment browse pages — 2026-10-01

Status: **PASS for bounded synthetic workstation checks**. Partial D-026/D-028 engineering, related to REQ-03/REQ-13/REQ-16 and CH-07; not a product-gate pass. All 44 tasks and 10 gates remain **NOT VERIFIED**; the full system is incomplete. Reviewer: Codex source review and automated workstation checks, without independent human acceptance.

Parent: `e4abf2d04cd6c79fd0086fccc3bbd723aef62554`, branch `codex/local-distributor-checkpoint`. The [machine companion](LOCAL-SHIPMENT-PAGES-2026-10-01.json) binds the tested candidate, documentation, available logs and unchanged historical evidence. Its own bytes are excluded to avoid circular hashing. The subsequent actual local commit identifies the deliverable.

## Behavior and boundaries

The dashboard now supplies the newest 20 shipment rows and `shipmentNext`; clients use `GET /api/shipments/page?after=…` for continuation. The endpoint returns `{items,next}` in descending creation-time/ID order and fetches up to 21 rows to determine whether another page exists. An actual currently scoped shipment supplies the cursor boundary; unknown, malformed or inaccessible cursors are refused. Shipments created after the first page become visible on refresh, not retroactively inserted into older pages. The internal full-list method remains compatible and unbounded.

Current actual identity, role, active status, buyer account, warehouse-site grants and password-change restrictions precede reads. Buyer and warehouse predicates apply in SQL before the limit. Other staff retain provisional organization-wide shipment reads pending operating acceptance. Empty warehouse grants return no shipments, and a cursor becomes invalid if the current grants no longer include its row. Latest delivery state/time/revision is joined into each page without separate application queries per shipment; private history evidence is omitted. Original shipment lines, units, invoice identity and packed/void/shipped behavior remain intact.

Browser **Load more shipments** appends unique rows, preserves loaded rows/cursor after a failure, and allows retry. Refresh or a saved change resets to the newest page; sign-out clears it. Delayed continuation responses are discarded after refresh or sign-out. Final-page completion focuses the shipment heading. The mobile stylesheet previously hid the only Sign out control; it now shows current-user information and Sign out with wrapping at phone widths. See [the runbook](../FULFILLMENT.md#browse-shipments).

## Actual checks

Environment: macOS arm64, Node 24.16.0, npm 11.13.0, SQLite 3.53.0, disposable synthetic databases and loopback headless Chromium. Available logs and the initial browser trace are under `/tmp/distributor-shipment-pages`; the companion hashes them. Temporary logs require separate durable archiving.

| Command | Observed result |
| --- | --- |
| `npm run typecheck` | PASS after the mobile correction |
| `npm run format:check` | PASS after the mobile correction |
| `npm exec -- tsx --test tests/fulfillment-delivery.test.ts tests/shipment-pages.test.ts` | PASS 16/16, 1976.652584 ms |
| `npm test` | PASS 364/364, 10343.770708 ms; zero failed/cancelled/skipped/todo |
| `npm run build` and `npm exec -- playwright test -g 'shipment pages retain rows'` | PASS; focused Chromium 1/1, 2.5 s, new journey 912 ms |
| `npm run test:e2e` | PASS 30/30, 52.5 s; new journey 1.1 s; production build passes |

The final backend run preceded the mobile CSS correction; no backend behavior changed afterward. Final type/format and browser checks include the CSS correction. No source/test/configuration edits follow the final passing checks. Planning/link, whitespace and content-hash checks follow receipt creation and appear in the companion.

Six new backend tests cover 20+20+3 tied-time continuation across restart and newer insertions; buyer/site filtering before limits, forged roles/accounts, changed/empty grants and cross-organization cursors; actual inactive/password-restricted readers; joined collection/carrier summaries through terminal outcomes and packed/void rows with native stock/orders/invoices/accounts unchanged; 103-row traversal with at most 21 returned SQL rows per page and one joined application query; and authenticated HTTP/dashboard/query-shape boundaries. Tied-time history rows are deliberately inserted synthetic fixtures, not proof of physical shipments or complete valid business histories.

The browser journey creates 23 genuine packed partial shipments through native commands, traverses all pages against the endpoint, retries a failed continuation, checks final focus and phone-width overflow, and releases previously captured successful responses after refresh and mobile sign-out. Browsing leaves stock, orders and invoices unchanged. Packing these synthetic goods does not prove physical shipment or operator acceptance. Full regression uses a shared disposable synthetic database and one worker; it does not qualify production concurrency or workload.

## Preserved failures and review

Initial source type checking failed on a nullable functional state update; the update now checks current state. Initial backend test typing referred to nonexistent `Inventory.units`; the fixture now uses the owning stock projection. Initial browser test typing left `packedIds` implicit; it now has an explicit string-array type. All three failed logs and corrected passes remain available.

The initial focused browser run timed out locating Sign out at phone width. The mobile stylesheet hid the entire identity/control area. Corrected the actual layout and retained the failure log, error context and trace; the corrected focused run passed without widening the viewport. An API fixture path was corrected to `/api/login` before that failure completed. No separate failed raw log is claimed for that edit.

Dependencies, lockfile and license notices are unchanged; no third-party implementation was copied. Review covers actual scoped cursor lookup, deterministic ordering, joined summary shape, bounded application row retrieval, refresh/sign-out invalidation and native-fact conservation. Returned row limits do not bound total SQLite work, temporary sorting or memory, especially for multi-site scopes. No query-plan, production load or capacity acceptance is claimed.

## Remaining qualification

Other dashboard collections and the internal compatibility shipment list remain unbounded. Shipment index construction and synchronous legacy delivery import remain unqualified for production upgrades; no interrupted/concurrent startup, older-writer coexistence or rollback capacity is established. Actual carriers/labels/retrieval and physical proof, return/remedy/correction/approval/coverage policy, individual devices/providers, production workload/clock/locking/retention/archive/termination/recovery/security/residency and human warehouse/finance/customer acceptance remain open. No task or gate passes from this receipt.

Direct workstation checks and local commits only. No CI runner/job, workflow/registration, push/PR, actual provider account/request, live data, deployment/purchase, publication/settings change or OPUS/UB integration. Future Distributor CI uses GitHub-hosted runners after separate authorization/qualification; no fresh remote-access claim.
