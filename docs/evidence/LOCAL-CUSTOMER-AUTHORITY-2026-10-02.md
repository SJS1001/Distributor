# Local customer authority checkpoint

Date: 2026-10-02. Engineering evidence only; all 44 tasks and 10 product gates remain **NOT VERIFIED**. Partial D-008/D-018/D-035 and REQ-03/REQ-12. See the [machine receipt](LOCAL-CUSTOMER-AUTHORITY-2026-10-02.json), [user access](../USER-ACCESS.md) and [implementation status](../IMPLEMENTATION.md).

## Version and environment

Parent: `10a4826` on `codex/local-distributor-checkpoint`. Candidate source, tests and documentation are hashed in the machine receipt; the committed-byte audit and commit identity are recorded in the [handoff](../HANDOFF.md). Direct macOS arm64 workstation checks use synthetic SQLite, loopback HTTP and local production-build Chromium. No CI runners, cloud sessions, provider/device requests, customer data, deployments or publication were used.

## Changed behavior and independent checks

Customer lookup/list and import review/application reload active persisted identity, role/account grants and required-password state. Customer creation and credit-hold authorization do the same before saved command results or effects inside the existing immediate transaction. Buyer lookups follow the current account assignment; an unassigned persisted buyer sees an empty list rather than every organization account. Staff customer visibility, commercial/admin creation and finance/admin credit-hold permissions retain their existing policy.

All seven new authority tests failed against the unchanged parent implementation. After the fix, the same seven passed. They cover unavailable/foreign/deactivated principals; administrator demotion before imports and old/new command keys; forced password changes; supplied buyer role/account forgery and actual account reassignment; null buyer assignment; valid finance/commercial grants despite stale supplied negative roles and revoked hold releases; and access changes through another connection followed by actual SQLite restart. Denied operations conserve customer records, command receipts, audit/order/clock and events. Credit holds continue to block native order acceptance after a revoked release retry. Trusted imports never import provider consent.

## Captured verification

| Check | Outcome |
| --- | --- |
| New authority regression | 7/7 after fix; original 0/7 failure retained |
| Focused customer/catalog/domain/import/residency | 47/47 |
| Full backend | 1780/1780 |
| Selected production-build Chromium journeys | 3/3: customer/catalog imports, cart/fulfillment/residency/return, user lifecycle |
| Typecheck, format and build | Exit 0 |
| Isolated production-only install/runtime | PASS: 209 copied inputs, 69 development-only packages absent, 27 child commands; CA/US each start twice with local backup/restore |
| Documentation structure and whitespace | Exact commands/outcomes retained in machine receipt |

Final test input hashes, command timings, private log hashes, production assets, runtime receipt, prior evidence and license notices are retained in the machine receipt. Original failure logs remain private under `/tmp/distributor-customer-authority-checkpoint`.

## Limits

This does not establish complete authorization or production security. Other module/cache boundaries remain to audit. Staff organization-wide customer visibility is provisional; customer lists remain unbounded and reads outside commands are not a coherent cross-query snapshot. No new operating credit rules, tax policy, customer-specific price schema or UI behavior is introduced. Other browser journeys were not rerun. Actual providers/devices, regional infrastructure, load/recovery targets, operating policies and human acceptance remain unqualified. The full-system goal remains active.
