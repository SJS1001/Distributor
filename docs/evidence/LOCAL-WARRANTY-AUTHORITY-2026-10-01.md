# Local current warranty authority, 2026-10-01

**PASS — bounded local engineering only.** Partial D-008/D-030–D-033 evidence for CH-06/CH-07/CH-08, REQ-03/REQ-17, G1/G6. All 44 tasks and 10 product gates remain **NOT VERIFIED**. Parent agent implementation/self-review; no independent reviewer or actual operator/provider sign-off.

Parent `73c138c3f6097f462bcbc8b661770c6136f9b76d`, branch `codex/local-distributor-checkpoint`. The [content record](LOCAL-WARRANTY-AUTHORITY-2026-10-01.json) binds 224 application/test/configuration/license inputs, final documents, actual logs and 149 unchanged historical evidence files. A subsequent local commit contains these exact content bindings.

## Environment and expected results

Direct workstation commands in `/Users/stevensmith/Documents/Distributor`; macOS-27.0-arm64-arm-64bit-Mach-O, Node v24.16.0, npm 11.13.0. Disposable native SQLite CA/CAD fixtures with actual synthetic IAM users, orders, sold and returned serials, manufacturer records and replacement stock. No schema/dependency/license/UI change or copied third-party implementation. No CI runner/job/workflow/registration, cloud checkout/source transfer, push/PR, actual provider account/request, deployment/purchase/live data/publication/settings or OPUS/UB integration.

- Actual deactivation and forced password reset deny six public warranty reads and all thirteen native commands before any warranty query, including previously cached successful submissions/reviews/referrals/receipts/inspections/reservations. Independent retained-row projections of warranty, inventory allocations/movements/units, orders, shipments, billing and platform command/audit/event records remain exactly unchanged. Read denials persist after reopening the database.
- Current support role, missing principal and wrong organization cannot forge old administrator authority or recover successful command results. Actual role changes to buyer narrow returned replacement fields and manufacturer projections while retaining original invoice/coverage entitlement for a successor claim.
- An actual buyer account change replaces access to original-account claims/sold equipment, denies original claims and exact cached submission, and exposes only the second account's records before and after restart.
- Native transfer puts the replacement serial at the second warehouse. An original-site warehouse reader sees the claim but no replacement serial until both grants exist; revoking the original grant removes the claim and denies direct access. Commercial/warranty/finance overview retains the existing organization-level policy.
- Existing synthetic native lifecycle, late-fault rollback, real process contention, HTTP origin/CSRF/session/exact-field protection, evidence-file grants, shipping privacy and encrypted restore tests continue to run. This checkpoint adds no new vendor or device qualification.

Public claim, sold-unit, replacement, manufacturer and shipping-history reads own one transaction for current authority and projection. Private record helpers participate in already-open command transactions and evidence authorization, avoiding nested transactions. Command authorization still runs before the platform returns cached results. Existing task-specific write permissions remain in place.

## Actual commands

| Command | Final observed outcome | Command duration |
| --- | --- | --- |
| `npm test` | PASS 762/762; zero fail/cancel/skip/todo; reported 23767.67325 ms; exit 0 | 23.970 seconds |
| `node --import tsx --test tests/warranty-authority.test.ts tests/warranty-manufacturer.test.ts tests/warranty-replacement.test.ts tests/warranty-shipping.test.ts tests/warranty-evidence.test.ts` | PASS 36/36; zero fail/cancel/skip/todo; exit 0 | 5.737 seconds |
| `npm run typecheck` | PASS, exit 0 | 1.089 seconds |
| `npm run format:check` | PASS, exit 0 | 7.967 seconds |
| `npm run build` | PASS, exit 0, unchanged application bytes | 0.550 seconds |

Only restoration of one existing role-denial test with real IAM users changed after the build capture. The final full/focused/type/format checks ran on that restored test. The companion binds the exact test delta. No frontend edit, so Chromium was not rerun; preceding 48/48 browser evidence remains historical. Planning/whitespace checks run after receipt creation and their actual results are recorded in the companion.

Preserve initial focused failures on obsolete forged-user fixtures, incorrectly parsing already-decoded site grants, and nested read/command transactions. The fixtures now use owning IAM operations; private helpers participate in the existing transaction without changing database transaction semantics. Self-review restored the replacement-denial role matrix rather than reducing coverage. Earlier/intermediate passes do not substitute for final evidence. Private result records/log hashes remain under `/tmp/distributor-warranty-authority-checkpoint`, without archival guarantee. An initial receipt-generation assertion used the final capture instead of its retained preceding capture and failed before writing either receipt; the comparison now uses the actual build-era capture.

## Remaining scope

The read transactions use SQLite's existing immediate lock and do not qualify production contention/latency. No new concurrent grant-revocation race test or atomicity wrapper for every evidence read is claimed. Claim/manufacturer dashboard collections remain unbounded. Actual coverage/expiry/remedy/financial/manufacturer policies, physical returned custody, carrier accounts/services/correlation/terms/residency/credentials, hardware, production security/load/retention/upgrades/recovery, independent review and business/operator acceptance remain open. Changed authority/contracts/configuration/dependencies invalidate affected evidence. This receipt cannot pass a product gate or complete the full system.
