# Local Canada Post multiple-warehouse verification — 2026-10-02

Status: PASS for the recorded local synthetic engineering scope. Full system incomplete; all 44 task acceptances and 10 product gates remain NOT VERIFIED. Partial D-027/D-029 engineering coverage only.

## Tested version and environment

Local parent `67e20cf802cff6eaf048ab0162d80eb8f75f089b` plus the exact candidate and 334 tested input hashes in [the companion manifest](LOCAL-CANADA-POST-ORIGINS-2026-10-02.json). Companion SHA256: `87757e00663fc664861359a669d0418af47ec6264894d84915539189ffddd29e`. Direct macOS arm64 workstation with Node v24.16.0/npm 11.13.0, synthetic SQLite stores and loopback HTTP. Every carrier transport is injected synthetic data; no actual provider request, physical scanner/printer, customer data, CI runner, cloud session, push/PR or deployment.

## Recorded outcomes

| Check | Actual result |
| --- | --- |
| Full backend (`npm test`) | PASS, 1677/1677; 27 new multiple-origin tests |
| Focused Canada Post protocol/runtime/startup | PASS, 249/249 |
| Typecheck and formatting | PASS, exit 0 |
| Isolated production-only install/startup | PASS, 204 copied inputs, 69 development-only packages absent, 27 child commands, CA/US twice |

Trusted normal startup accepts an exact list of 1–20 warehouse registrations in one regional organization, or the retained single-origin format. Tests refuse empty/null/nonarray/oversized/malformed input, duplicate/foreign warehouses, extra configuration fields, invalid account/contract/company/shipping points/services and absent/invalid named credentials. Each of the six legacy origin variables conflicts with list mode even when empty. All failures preserve the whole native store and use sanitized errors. Disabled outer processing does not parse subordinate configuration; startup performs no provider I/O.

Both CA and US stores accept twenty scoped synthetic warehouse registrations. Changing the original environment object after construction does not change the captured runtime. Current warehouse grants and organization isolation apply; the generic individual Canada Post adapter remains disabled.

Two real native warehouse stock positions use different synthetic account/contract/company identities, pickup/deposit points and credentials. Protocol transports verify each account's token credentials, paths, original account/contract/company and shipping point; a mixed-warehouse group is refused. Separate groups retain different non-secret configuration hashes. Carrier create/manifest operations leave native stock/orders/invoices unchanged until separate exact handovers. Each account creates one member and transmits one manifest, retains private label/manifest bytes, and issues one native shipment/invoice at handover.

Lost committed creation and manifest replies remain uncertain across actual SQLite/application restart. A missing registration or changed contract refuses recovery before transport. Reordered registrations select the original exact binding. Creation/transmission retries cannot repeat a purchase; read-only reconciliation recovers existing effects. Both account counters remain exactly one create and one manifest after final handover.

The manifest retains exact source/test/config hashes, command timestamps/exit codes/log hashes, runtime inputs and child commands, unchanged historical evidence/license notices, and matching current/private production assets. Initial type/fixture failures and the first captured test results are retained privately. The initial test helper incorrectly selected another warehouse's cart revision; corrected new native setup uses separate carts/quotes. Typed validated configuration construction replaced an unsafe cast; explicit service return typing corrected widened union inference. No production revision/dispatch/recovery check was weakened.

## Limits

No browser source changed. This checkpoint builds the production UI and exercises backend/configuration/native/runtime behavior; it does not claim a new browser journey or rerun prior browser receipts. Runtime startup keeps provider processing default-disabled.

All carrier effects, origins and documents are synthetic. Test declaration/acknowledgment does not prove credential class because the existing client uses a shared gateway. Actual Canada Post account/contract/service/geography/fees, residency and credential rotation authority need qualification. This adds trusted startup configuration, not a production switch or browser secret editor. Other carrier clients retain their existing configuration/qualification limits.

Native fulfillment remains separate from carrier booking and requires confirmed manifest membership. Removed registrations or changed non-secret configuration cannot automatically remap uncertain groups. Physical warehouse/operator acceptance, actual printed labels, production workload/security, infrastructure residency, disaster recovery and agreed RPO/RTO remain unverified. No schema, dependency, license or workflow change. See [the configuration runbook](../CARRIER-BOOKINGS.md#canada-post-configuration-for-multiple-warehouses).
