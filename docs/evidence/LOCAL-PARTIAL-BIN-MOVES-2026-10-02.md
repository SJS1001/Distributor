# Local partial bulk-bin moves — 2026-10-02

Partial warehouse engineering; all 44 tasks and 10 product gates remain **NOT VERIFIED**.

Candidate: parent `7060f3f6568dbcbfc00405fc83b732e676995b32` plus the input SHA-256 hashes in [the machine receipt](LOCAL-PARTIAL-BIN-MOVES-2026-10-02.json). Environment: macOS arm64, Node v24.16.0, synthetic CA/US SQLite and local production-build Chromium. Commands run directly on the workstation.

A six-unit quarantined lot at 125 regional cents splits into four original-bin units and two destination-bin units. Repeated splits retain original supplier receipt lineage and organization value of 18,750 cents including fixture serialized stock. Paired signed custody movements have zero organization value delta. Tests check restart/exact retries, invalid quantities, stale count approval, reserved-stock refusal, late-audit rollback, HTTP payload and current-authority enforcement, and competing independent processes. The phone browser keeps the default whole quantity, moves two units and recovers one committed result after a lost response without creating another lot.

| Fresh check | Outcome |
| --- | --- |
| Complete native suite (`npm test`) | 1,947 passed, zero failed/skipped, exit 0 |
| Focused native suite | 15 passed, zero failed, exit 0 |
| Production Chromium bin-move journeys | 3 passed, zero failed, exit 0 |
| TypeScript and formatting | Exit 0 |
| Production build | Exit 0; existing large-bundle warning |
| Changed-file React Doctor | Exit 0; existing App complexity warning |

The complete browser suite was not rerun for this candidate. Initial red feature checks and intermediate TypeScript failures are preserved privately alongside final logs in `/tmp/distributor-partial-bin-checkpoint`; log hashes are in the machine receipt. Public metadata contains no runtime databases, credentials or raw private artifacts.

Self-review checked inventory-owned writes, authority before cached receipts, serial/quantity constraints, atomic source/destination and movement persistence, original cost/condition, recursive purchase lineage, stale source revisions and unchanged whole-record payload compatibility. No schema, dependency, license or workflow change. Downstream transfer/supplier handover after splits, physical custody/devices, bin directory/capacity, production load/residency and operator procedures remain to qualify. Generic submitted dialogs still do not restore payloads after reload/navigation. No CI runner, provider request, PR, merge or deployment was started.
