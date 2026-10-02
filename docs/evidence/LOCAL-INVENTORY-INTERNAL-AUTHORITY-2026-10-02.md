# Internal inventory authority — local engineering receipt

Date: 2026-10-02. Parent: `9883b0c`; branch: `codex/local-distributor-checkpoint`. Exact candidate/test/runtime inputs and command/log hashes are in the [machine receipt](LOCAL-INVENTORY-INTERNAL-AUTHORITY-2026-10-02.json). Local synthetic engineering only; all 44 tasks and 10 product gates remain **NOT VERIFIED**.

## Change and requirements

Twenty-six internal inventory owning-module boundaries now refresh active persisted role/site/password authority before reads, empty results or effects. Finance controls require finance/admin; opening stock and supplier returns require admin. Custody writes retain warehouse, commercial/buyer or warranty permissions as appropriate. These guards strengthen partial D-008, D-021, D-026 and D-030 engineering coverage; they do not complete these tasks or establish operator acceptance.

The caller retains its native transaction; there is no nested transaction. Internal projections still depend on owning modules to resolve customer entitlement and business/site context before exposing data. Destination-only transfer receiving must resolve source/transit units, and buyers must retain account-scoped ordering/cancellation and sold coverage. Trusted organization-scoped startup warehouse validation is unchanged. No schema, dependency, workflow or UI source change.

## Actual verification

| Direct workstation check | Result |
| --- | --- |
| Final unchanged-parent source plus final new tests, isolated private copy | Seven failures, two passes; reproduces authority gaps while existing valid buyer/native-custody cases pass |
| New inventory authority tests | 9/9 pass |
| Focused inventory/order/custody/replacement regression | 99/99 pass |
| Full backend regression | 1,841/1,841 pass; zero skipped/cancelled |
| Type checking, formatting and production build | Exit 0 |
| Four selected production-build Chromium journeys | 4/4 pass |
| Isolated production-only runtime install | PASS; CA/US each booted twice, local encrypted backup/restore and PDF/ZPL profiles |
| Planning structure/link validation and whitespace | Exit 0; command records in machine receipt |

The nine new tests cover unavailable/foreign/inactive principals, required-password state, forged roles/sites after demotion/revocation, newly granted authority, independent grant updates plus restart, and authorization changes during order acceptance. Denials conserve whole inventory/order/fulfillment/billing/warranty/platform native facts. Successful buyer cancellation/coverage and warehouse/warranty replacement/return flows retain stock, original cost and invoice behavior.

Selected Chromium flows cover partial transfers with damage/quarantine, two site-limited operators, multi-line buyer ordering with lost-response retry and serial/bulk fulfillment/paid return, and buyer sold coverage. The entire browser suite was not rerun. Runtime installation is synthetic on the workstation; it does not establish Canadian/US infrastructure residency or physical-device/provider qualification.

Initial new-test failures involved an incorrect order-detail line accessor and a conservation assertion spanning separately committed customer creation. Corrected the fixture/oracle without weakening production guards. Failed attempts and final parent reproduction remain private with hashes. Historical evidence and license notices are retained unchanged.

## Limits and next work

This does not establish independent account/site filtering on every raw internal projection, bounds on existing collections, a coherent snapshot across separate reads, approved staff visibility, all other internal module authorization, production scale/security/recovery or actual provider/device/operator acceptance. Unresolved operating policies remain explicit and configurable. Full-system work remains active.

Direct workstation checks and local commits only. No CI runners, cloud sessions, delegation, push, PR, deployment, real provider/device calls, live ingestion or source publication occurred.
