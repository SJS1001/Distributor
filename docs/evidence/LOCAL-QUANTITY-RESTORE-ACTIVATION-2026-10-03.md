# Local quantity and restore activation integration — 2026-10-03

This receipt covers uncommitted schema-17 source on parent `4d0c45a275fd26a3cdb1362182f7c4eea3881110`, branch `codex/local-distributor-checkpoint`, tested directly on macOS arm64 with Node 24.16.0 and disposable synthetic CA/US stores. [Machine-readable evidence](LOCAL-QUANTITY-RESTORE-ACTIVATION-2026-10-03.json) binds 593 source/test/configuration inputs and private evidence hashes. Publication follows review; this receipt does not itself identify a resulting commit or verify a product gate.

## Implemented behavior

[Bulk quantity corrections](../INVENTORY-QUANTITY-CORRECTIONS.md) retain exact source, cost, reservation and policy evidence. A different current finance principal approves each effect; rejected and ready records remain readable. Accounting checks the retained complete movement history, including effects behind a cursor. Original acquisition cost remains retained.

[Durable restore activation](../RESTORE-ACTIVATION.md) retains release intent, independent signed authority, current trust, fencing/routing observations and interruption/rollback history. Each process defaults disabled until explicitly qualified. The offline coordinator exposes no HTTP or ambient startup bypass. Shared schema integration preserves both frozen version-16 fingerprints and requires fresh-file upgrades.

Cloud restore commit `32d6cd3ceaf6e5ce68d2816bca202ba9cefb83a3` was transferred as ten individually verified chunks. The reconstructed 84,781-byte patch has SHA-256 `d27a175b6c521bb3e93c246913739b62b5096f984497ae70c57957f94b19781c`. The core applied cleanly; root manually combined shared schema changes with concurrent quantity work. Cloud-reported 72 restore and 118 schema/recovery checks remain separate from the combined local results. Requested Astra/High settings cannot be verified through available cloud controls.

## Local verification

| Check | Actual result |
| --- | --- |
| Combined quantity/valuation/restore/schema/recovery tests | 225/225, zero failures/skips/cancellations, 16,783.603208 ms |
| Complete native regression, `npm test` | 2,549/2,549, zero failures/skips/cancellations, 136,176.160292 ms |
| Current quantity-focused checks | 18/18, zero failures/skips/cancellations, 2,743.649416 ms |
| TypeScript and formatting | Pass; later test-only recovery additions formatted separately |
| Production build | Pass; existing large-bundle warning remains |
| Complete production Chromium regression | 326/326, 6.0 minutes |
| Isolated production runtime | CA/US pass; two startup cycles each, PDF/ZPL output and encrypted recovery; 300 copied inputs match, 69 development-only packages absent, 41 command outcomes |

Four quantity recovery scenarios were added after the complete native run. Only `tests/inventory-quantity-corrections.test.ts` changed; the current focused run passes all 18 scenarios and TypeScript passes again. The earlier complete run must not be described as 2,553 tests. Production inputs remained unchanged across browser/build/runtime verification. Recovery coverage includes CA/US with reporting enabled/disabled, retained approved/rejected/ready records at cutoff and refusal of cached writes under the restored hold.

Initial combined verification passed 223/225: two version-16 fixtures incorrectly retained the concurrent quantity table, producing SCHEMA_DRIFT. Fixture repair preceded the 225/225 pass. The first browser launch exceeded the existing 30-second fixture-server startup timeout before starting any tests while native/runtime verification was active. An unchanged recheck after those runs passed 326/326. The startup failure's cause remains undetermined. Both original failures remain retained privately with hashes in the JSON receipt.

Root reviewed current authority, retained record shape/hash/effects, original cost/date/source binding, complete cost-window integrity, release authority domains, interruption/rollback state and combined historical schema conservation. This is source review plus synthetic verification, not external qualification.

## Limitations

Cloud quantity interface coding and the completed accounting review patch are not integrated in this receipt. Existing browser regression therefore does not verify the new quantity interface. Actual source fencing, routing, infrastructure residency, provider/device/finance/security/load/operator acceptance and post-cutoff owning-module reconciliation remain unqualified. The bundle warning and prior React static findings remain unresolved; no clean static result is claimed.

All 44 tasks and ten product gates remain NOT VERIFIED. No CI jobs/workflows, provider requests, deployments, PRs or merges were started. Private raw logs, transfer files, runtime stores and preview credentials remain excluded from publication.
