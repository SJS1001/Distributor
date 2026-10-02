# Local synthetic load/recovery engineering receipt — 2026-10-02

Partial D-036/D-039 and CH-10 engineering evidence. All 44 tasks and 10 product gates remain NOT VERIFIED. Actual reviewer: Codex, automated engineering review. No human/operator acceptance or production qualification is claimed.

Candidate starts from published parent `c7d1913d27e069a47d00bf59e13d8c078e7bd16d`. Exact tested source/test/configuration hashes and private artifact hashes are recorded in the [machine receipt](LOCAL-LOAD-RECOVERY-2026-10-02.json). Environment: macOS arm64, Node v24.16.0, installed repository dependencies. No new dependencies, schema, product runtime or workflow changes.

Fresh direct workstation commands:

- `npm run typecheck` and `npm run format:check`: PASS.
- `npm test`: 1,907/1,907 PASS, zero skipped/cancelled tests. This is native workstation verification, not a product acceptance or CI claim.
- `tsx --test tests/load-recovery.test.ts`: 3/3 PASS. Invalid workload/store options, per-SKU/site stock insufficiency, misleading inherited database/preload configuration, untouched existing-store sentinel, private artifact modes, real HTTP/writer overlap and terminated children are exercised.
- `npm run verify:load-recovery`: PASS in CA and US, 8.254 seconds total with the default workload. Each region seeds 800 units and completes eighty paid shipments while four authenticated readers make 240 requests. Forty sales exist at the backup cutoff; forty later sales are excluded by restore. The pending order completes once after restore, yielding 41 invoices, and exact shipment/payment replays preserve totals. Copied sessions are refused and restored providers remain held.

| Measurement | CA | US |
| --- | ---: | ---: |
| HTTP requests overlapping a native writer interval | 240 | 124 |
| HTTP p95 duration | 67.783 ms | 15.089 ms |
| Native sale p95 duration | 110.329 ms | 197.591 ms |
| Encrypted backup duration | 33.216 ms | 33.518 ms |
| Restore operation duration | 41.718 ms | 41.852 ms |

Expected quantities, original costs, per-product/site balances, exact retained serial identity, invoice/customer/order links, fixture prices/taxes and paid totals are calculated independently of the native reconciliation controls. Live reconciliation reports no stock, billing or sales issues. Timing values include this workstation's contention and are observations, not accepted targets or benchmarks for another environment.

Original small-run failure is retained: the harness initially expected native order state `accepted`; the actual accepted, unfulfilled order state is `open`. The corrected small run passed before later oracle/configuration/format changes. It is historical evidence, not a substitute for the final default run. Original logs and private receipt references/hashes are preserved in the machine receipt. Temporary synthetic databases, backup archives, logs, credentials and full timing/receipt artifacts remain outside git. Backup keys are erased and the retained archives cannot be reopened.

The [runbook](../LOAD-RECOVERY.md) describes reproduction, resource caps and limitations. Production peak/latency/availability/RPO/RTO targets remain unapproved. CA/US here are logical stores on one workstation. No HTTP-write, browser, physical device, real provider, network outage, simultaneous-commit backup, Windows, operational scheduling, provisioning, operator/cutover or physical residency acceptance is claimed. There is no fresh browser/build/runtime-install qualification for this script-only change. No CI runner, cloud session, PR, merge or deployment is started. The owner authorized publication of current source/tests/docs on the existing codex branch.
