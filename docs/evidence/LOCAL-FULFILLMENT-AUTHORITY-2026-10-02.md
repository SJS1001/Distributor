# Local fulfillment authority checkpoint

Date: 2026-10-02. Engineering evidence only; all 44 tasks and 10 product gates remain **NOT VERIFIED**. Partial D-008/D-026/D-028/D-030 and REQ-03/REQ-16. See the [machine receipt](LOCAL-FULFILLMENT-AUTHORITY-2026-10-02.json), [access procedure](../USER-ACCESS.md#current-fulfillment-authority), [fulfillment procedure](../FULFILLMENT.md) and [implementation status](../IMPLEMENTATION.md).

## Version and environment

Parent: `073ff35` on `codex/local-distributor-checkpoint`. Candidate source/tests/docs are hashed in the machine receipt; exact committed bytes and commit identity are recorded in the [handoff](../HANDOFF.md). Direct macOS arm64 workstation checks use synthetic SQLite, loopback HTTP and local production-build Chromium. No CI runners, cloud sessions, actual provider/device requests, customer data, deployments or publication were used.

## Changed behavior and independent checks

Shipment detail, picking projections and internal sales controls now reload active persisted identity, role/account/site grants and required-password state. Sales controls require current finance/admin access. Packing reloads current warehouse/admin authority before saved results or native effects inside its existing command transaction. Warehouse serialized sale lookup requires the shipment's current granted site, including exact unit lookup. Existing pick, shortage, handover, void and delivery command guards retain their current permissions. Buyer detail/sale scope and delivery history privacy use actual current account and role.

Eight initial regressions independently failed against unchanged parent source; the fixed source passed the same eight. A ninth test adds valid buyer delivery privacy, seven saved/new command refusals and missing-account fencing. Tests cover absent/foreign/deactivated principals; all seven public command paths before saved/new results after role, site and password changes; supplied buyer role/account and warehouse site forgery; valid actual warehouse picking/packing despite stale negative supplied fields; and independent grant changes followed by actual database/application restart. Denied actions conserve shipment/coverage/delivery/short-pick facts, order quantities/reservations, stock/allocations/movements, holds/invoices/counters and platform commands/audit/order/clock/events. Valid packing preserves quantity holds and exact replay without issuing an invoice; existing focused/native browser scenarios preserve stock, cost and money behavior.

The first expanded focused run passed 136/137: a synthetic missing-assignment fixture attempted an administrative update that correctly requires a buyer account. Corrected the fixture using owning test-store SQL. No production permission or shape check was weakened. Original reproduction and fixture failure logs remain private under `/tmp/distributor-fulfillment-authority-checkpoint`.

## Captured verification

| Check | Outcome |
| --- | --- |
| New authority regressions | 9/9 in final focused run; unchanged-parent 0/8 failures retained |
| Focused fulfillment/delivery/short-pick/coverage/reconciliation/domain | 137/137 |
| Full backend | 1798/1798 |
| Selected production-build Chromium journeys | 4/4: multi-line fulfillment/return, split packing/void/handover, short picks and delivery history/privacy |
| Typecheck, format and build | Exit 0 |
| Isolated production-only install/runtime | PASS: 209 copied inputs, 69 development-only packages absent, 27 child commands; CA/US each start twice with local backup/restore |
| Documentation structure and whitespace | Exact commands/outcomes retained in machine receipt |

All 350 final tested input hashes, command timings, private log hashes, production assets, runtime receipt, historical evidence and license notices are retained in the machine receipt.

## Limits

This does not establish complete authorization or production security. Other module/cache boundaries remain to audit. Staff organization-wide shipment visibility remains provisional. Compatibility collections/internal projections remain unbounded; separate reads outside commands do not establish a coherent snapshot. No schema, dependency, workflow or UI source change. Other browser journeys were not rerun. Actual providers/devices, regional infrastructure, load/recovery/upgrades, operating policies and human acceptance remain unqualified. Full-system work remains active.
