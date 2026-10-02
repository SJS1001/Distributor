# Local ordering authority checkpoint

Date: 2026-10-02. Engineering evidence only; all 44 tasks and 10 product gates remain **NOT VERIFIED**. Partial D-008/D-018/D-019 and REQ-03/REQ-12. See the [machine receipt](LOCAL-ORDER-AUTHORITY-2026-10-02.json), [user access](../USER-ACCESS.md) and [implementation status](../IMPLEMENTATION.md).

## Version and environment

Parent: `e22140d` on `codex/local-distributor-checkpoint`. Candidate source/tests/docs are hashed in the machine receipt; exact committed bytes and commit identity are recorded in the [handoff](../HANDOFF.md). Direct macOS arm64 workstation checks use synthetic SQLite, loopback HTTP and local production-build Chromium. No CI runners, cloud sessions, provider/device requests, customer data, deployments or publication were used.

## Changed behavior and independent checks

Order detail/line reads, durable cart lists and internal sales projections now reload active persisted identity, role/account/site grants and required-password state. Buyers follow current account assignment; unassigned buyers receive an empty cart list. Warehouse order details retain their existing site restriction. Sales evidence requires current finance/admin access. Cart save, quote, acceptance and cancellation reauthorize inside their existing command transaction before saved results or native effects. Allocation, amendment and reservation commands retain their fresh guards. Owning shipment completion and shortage updates require current warehouse/admin authority inside the fulfillment caller's transaction.

Eight initial regressions independently failed against unchanged parent source; the fixed source passed all eight. A ninth test covers buyer reassignment before four completed ordering commands. Final checks cover unavailable/foreign/deactivated principals; all eight public command paths before saved/new results after demotion/password changes; supplied role/account/site forgery; actual account/site changes; a null buyer assignment; valid commercial/buyer commands despite stale negative caller fields; independent database connection grant changes followed by actual restart; and forged warehouse roles before owning shipment changes. Denied operations conserve carts/quotes/orders/lines/amendments/reservation records, stock/allocations/movements, exposure/invoice records and command/audit/order/clock/event facts. Valid operations preserve native accepted unit price/tax, quantities and exact acceptance retry.

## Captured verification

| Check | Outcome |
| --- | --- |
| New authority regressions | 9/9 final; initial unchanged-parent 0/8 failures retained |
| Focused ordering/domain/amendment/reservation/shortage | 117/117 |
| Full backend | 1789/1789 |
| Selected production-build Chromium journeys | 4/4: multi-line cart/fulfillment/residency/return, short picks, phone amendments and reservation expiry |
| Typecheck, format and build | Exit 0 |
| Isolated production-only install/runtime | PASS: 209 copied inputs, 69 development-only packages absent, 27 child commands; CA/US each start twice with local backup/restore |
| Documentation structure and whitespace | Exact commands/outcomes retained in machine receipt |

All 349 final tested input hashes, command timings, private log hashes, production assets, runtime receipt, historical evidence and license notices are retained in the machine receipt. Original reproduction and new-test typing failure logs remain private under `/tmp/distributor-order-authority-checkpoint`.

## Limits

This does not establish complete authorization or production security. Other module/cache boundaries remain to audit. Staff organization-wide order/cart visibility remains provisional; no new commercial warehouse policy is introduced. Cart lists/full internal projections remain unbounded, and separate reads outside commands do not provide a coherent snapshot. Owning operations still depend on the native fulfillment caller transaction and shape validation. No schema, dependency, workflow or UI source change. Other browser journeys were not rerun. Actual providers/devices, regional infrastructure, load/recovery/upgrades, operating policies and human acceptance remain unqualified. The full-system goal remains active.
