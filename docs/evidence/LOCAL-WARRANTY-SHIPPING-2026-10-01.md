# Local warranty replacement shipping — 2026-10-01

Status: **PASS for bounded synthetic workstation checks**. Partial D-028 and D-030–D-033 engineering evidence relevant to G5/G6. All 44 tasks and 10 gates remain **NOT VERIFIED**; the full system remains incomplete. Reviewer: Codex automated workstation checks and source review; no independent human acceptance.

Parent: `112317aaeea1fd73c457c455c7a68cffcd91e959`, branch `codex/local-distributor-checkpoint`. The [machine companion](LOCAL-WARRANTY-SHIPPING-2026-10-01.json) binds candidate source/tests/configuration, documentation, available logs/artifacts and unchanged historical evidence. Its own bytes are excluded to avoid circular hashing. The later actual local commit identifies the deliverable.

## Behavior and independent boundaries

The Returns screen records physical carrier handover of an already approved replacement: exact reserved serial, recipient, address, carrier, tracking and evidence. Collection and dispatch compete for the same replacement revision/hold. Warranty owns shipping metadata/history; Inventory alone consumes the hold, issues replacement stock and applies the approved original-unit restock/scrap disposition. The claim closes as replacement. These facts and command/audit/events commit or roll back together. No new order, ordinary shipment, invoice or payment is invented; successor warranty claims retain the original invoice, shipment and coverage through replacement custody.

One carrier/tracking pair per replacement is permanently unique within an organization's replacement shipping records after trimming, NFKC normalization and case folding. Ordinary outbound shipments use separate identities. Consolidated/multiple-package replacement shipping is unavailable. This is a manual custody/tracking record, not an actual carrier booking, purchased label or outbound provider request.

Warehouse/admin staff record in_transit, delayed, lost or delivered observations with expected shipping revision, unique normalized reference, required evidence and canonical UTC ISO timestamp. Times cannot precede the latest observation or exceed current time; equal timestamps are ordered by revision. Delivered is terminal. Delayed/lost observations change no custody, claim, invoice or money and do not authorize replacement/refund/restock. Exact retry keys recover one committed result, including after restart and terminal delivery; changed payloads conflict. A new key cannot bypass stale revisions or reused evidence references.

Current actual active identity, role, organization, password requirements, buyer account and applicable grants to both original/replacement sites precede cached mutations and history reads. Scoped buyers receive carrier/tracking/state/times without private address, recipient, evidence, reference or actor identity. Replacement projections use actual current grants even when a supplied Actor claims an administrator role. Shipping records outside current warehouse/warranty site grants are omitted from aggregate views; direct history reads are refused. Existing collection behavior is preserved.

History is ascending by revision in pages of 20. The browser retains loaded observations when a later page fails, and exact mutation keys survive lost committed responses. The broader claim/replacement dashboard history remains unpaged. HTTP mutations retain session/origin/CSRF and exact shape checks; the history route rejects unsupported query fields and malformed/out-of-range cursors.

## Actual checks

Environment: macOS arm64, Node 24.16.0, npm 11.13.0, SQLite 3.53.0, disposable synthetic SQLite databases and loopback headless Chromium. Available temporary logs/artifacts are hashed under `/tmp/distributor-replacement-shipping`; they require a separate durable archive.

| Command | Actual result |
| --- | --- |
| `npm run typecheck` | PASS, final candidate |
| `npm run format:check` | PASS, final candidate |
| `npm exec -- tsx --test tests/warranty-shipping.test.ts tests/warranty-replacement.test.ts` | PASS 15/15, 1886.258709 ms, final reviewed candidate |
| `npm test` | PASS 348/348, 12514.557083 ms; zero failures/cancellations/skips/todos |
| `npm run test:e2e -- --grep 'browser: replacement shipping retries'` | PASS 1/1, 3.4 seconds; journey 1.7 seconds; build 70 ms, before final backend aggregate-site filtering |
| `npm run test:e2e` | PASS 28/28, 54.4 seconds; shipping journey 1.9 seconds; build 229 ms, final reviewed candidate |

Planning/link and final whitespace/hash checks follow receipt creation and are recorded in the companion. No source/test/configuration edits follow the final full checks.

Eight new backend scenarios verify exact-once physical handover and original money/entitlement after restart; delays/loss/delivery and immutable 20+3 pagination; malformed scans/fields/times/references and normalized tracking reuse; actual authority before cached replies, changed sites/account/inactive/password/organization and buyer privacy; late-audit rollback across stock/hold/movements/cost clock/claim/shipping/events/receipts/audit; separate-process dispatch versus collection, same-key dispatch and competing delivery outcomes; HTTP session/CSRF/shape/history boundaries; and encrypted isolated backup/restore retaining original dispatch/history/receipts while excluding later delivery. Restore retains its provider hold. CA metadata does not prove infrastructure residency. Separate processes exercise SQLite races; audit injection is not process-kill/storage-failure qualification.

The new browser journey creates an original serialized sale and eligible inspected claim, reserves a replacement, rejects the wrong scan, loses committed dispatch and delay responses and retries the same keys. It refuses an outcome from a stale dialog after a concurrent lost observation, loads 23 observations with a failed later page and retry, checks mobile Escape/focus/no overflow, records terminal delivery, and verifies original orders/invoices/ordinary shipments unchanged and sold/scrapped serial custody. A real scoped buyer sees public tracking/state/history while private address/evidence remain absent. No physical scanner or human delivery acknowledgment is claimed.

## Preserved failures and review

The initial new backend attempt passed 5/8. Synthetic setup collided with the fixture administrator email, referenced nonexistent movement clock tables, and passed a hexadecimal recovery key instead of the required 32-byte Buffer. Corrected synthetic email names, actual owning cost clock/sequence tables and Buffer key; failed raw logs remain alongside later focused/full passes. The first focused command also listed nonexistent plural `warranty-replacements.test.ts`; tsx ran only the eight shipping tests. That log does not prove existing replacement coverage. Subsequent commands used the actual singular filename and passed all 15.

The first browser attempt expected capitalized `Shipping changed` while the actual stale error contains `Replacement shipping changed`. The second omitted required currentPassword in synthetic user creation and received HTTP 400. Corrected the stale-error locator and supplied the required administrator proof in the fixture without relaxing the tested stale conflict/history behavior; both failure logs and available artifacts were retained before reruns. Third focused and final full runs passed.

Source review checked owned writes, atomic custody/disposition, permanent tracking/reference identities, current authority before cache, staff/buyer projection privacy, site filtering, terminal/time/revision guards, exact retry keys, paging and original entitlement/money. It exposed the supplied-role projection issue and aggregate site failure, corrected before final full checks. No dependency/lockfile/license notice changes or copied third-party implementation. The instructed global predecessor HANDOVER.md is unavailable at its specified path.

## Remaining qualification

Actual carrier selection/contracts/residency choice, booking/labels/webhooks, consolidated packages, delivery corrections, lost-shipment remedies, authentic physical custody, coverage/finance/business approval duties and independent human acceptance remain open. Actual devices, regional hosting, production upgrades/clock/index/load/locking/retention/archive/termination/recovery/security and full D-028/D-030–D-033/G5/G6 qualification remain unverified. Manual observations prove recorded operator statements only.

Direct workstation checks and local commits only. No CI runner/job, workflow/registration, push/PR, actual provider account/request, live data, deployment/purchase, publication/settings change or OPUS/UB integration. Future Distributor CI is GitHub-hosted after separate authorization/qualification; no fresh remote-access claim.
