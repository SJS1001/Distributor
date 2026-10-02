# Local billing authority checkpoint

Date: 2026-10-02. Engineering evidence only; all 44 tasks and 10 product gates remain **NOT VERIFIED**. Partial D-008/D-022/D-023/D-024/D-025 and REQ-03/REQ-14/REQ-15. See the [machine receipt](LOCAL-BILLING-AUTHORITY-2026-10-02.json), [access procedure](../USER-ACCESS.md#current-billing-authority), [billing procedure](../BILLING-DOCUMENTS.md#current-billing-access) and [implementation status](../IMPLEMENTATION.md).

## Version and environment

Parent: `abd2a70` on `codex/local-distributor-checkpoint`. Candidate source/tests/docs are hashed in the machine receipt; exact committed bytes and commit identity are recorded in the [handoff](../HANDOFF.md). Direct macOS arm64 workstation checks use synthetic SQLite, loopback HTTP and local production-build Chromium. No CI runners, cloud sessions, actual provider/device requests, customer data, deployments or publication were used.

## Changed behavior and independent checks

Invoice detail/lines/balances, invoice/credit collections, recorded money evidence, exposure and finance controls reload active persisted identity, current role/account and required-password state before reads. Buyer collections scope the current account before materialization; no account assignment returns empty collections. Held order exposure release checks the current buyer's account. Manual payment, standalone credit, refund request and bank confirmation reauthorize before cached results or effects inside existing native command transactions. Owning shipment invoicing, warranty credits and verified payments retain their existing warehouse, warranty/finance and finance permissions.

Seven initial regressions independently failed against unchanged parent Billing source; the fixed source passed the same seven. Two added tests cover valid buyer account isolation and owning warranty/finance-worker operations. Tests cover absent/foreign/deactivated principals; role demotion and required-password state before saved/new commands and owning writes; account reassignment and missing-account collection fencing; stale negative supplied fields despite actual finance grants; and independent grant changes followed by actual database/application restart. Denied operations conserve billing holds/counters/invoices/lines/credits/payments/refunds/proofs/document facts, order quantities, stock/allocations/movements and platform commands/audit/sequence/events. Valid finance retries preserve exact receipts, owning warranty credit preserves original 11300-cent totals, and synthetic verified payments preserve one recorded payment after exact retry.

An older focused refund fixture read totals through its just-deactivated actor. The first full backend run passed 1803/1807: older accounting/refund fixtures read through password-restricted actors, a supplier-return fixture read billing collections through a warehouse user, and a document-import test invented buyer fields on a persisted administrator. Corrected independent owning-store state oracles and actual persisted observer/buyer fixtures; added explicit denial assertions. No production guard was weakened. Initial/intermediate typechecks exposed missing credit collection inference; explicit `CreditRow` typing preserves the stored/runtime shape.

The first four selected browser journeys passed 3/4: the billing profile test depends on the preceding unpaid-document import test creating `BROWSER-LEGACY-001`, which the selection omitted. Preserved the failed log, error context and trace, then included that prerequisite in the five-test sequence. All five passed without changing browser or production source. Original failures and initial captured input hashes remain private under `/tmp/distributor-billing-authority-checkpoint`.

## Captured verification

| Check | Outcome |
| --- | --- |
| New authority regressions | 9/9; unchanged-parent seven-test failures retained |
| Focused billing/domain/refund/document/import/accounting/HTTP | 122/122 |
| Full backend | 1807/1807 |
| Selected production-build Chromium journeys | 5/5: multi-line order/fulfillment/paid return, unpaid document import, billing profiles/PDF/aging, credited cash refund and accounting queues |
| Typecheck, format and build | Exit 0 |
| Isolated production-only install/runtime | PASS: 209 copied inputs, 69 development-only packages absent, 27 child commands; CA/US each start twice with local backup/restore |
| Documentation structure and whitespace | Exact commands/outcomes retained in machine receipt |

All 351 final tested input hashes, command timings, private log hashes, production assets, runtime receipt, historical evidence and license notices are retained in the machine receipt.

## Limits

This does not establish complete authorization or production security. Other module/cache boundaries remain to audit. Staff organization-wide billing visibility remains provisional; warehouse invoice detail is an owning fulfillment requirement without site qualification. Compatibility collections remain unbounded; separate reads outside commands do not establish a coherent snapshot. No schema, dependency, workflow or UI source change. Other browser journeys were not rerun. Actual providers/devices, regional infrastructure, load/recovery/upgrades, operating policies and human acceptance remain unqualified. Full-system work remains active.
