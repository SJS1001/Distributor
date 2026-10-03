# Local maintenance and refund boundary repairs — 2026-10-03

Parent: `ea2f5790c0f1a62e20be7cf6dd00139868ea22e5`. Direct workstation environment: `{"node":"v24.16.0","openssl":"3.5.6","sqlite":"3.53.0","platform":"darwin","arch":"arm64"}`. Focused synthetic verification only; all 44 tasks and ten gates remain NOT VERIFIED.

## Changes and retained evidence

The [maintenance delivery](../RESTORE-NATIVE-MAINTENANCE-AUTHORITY-BOUNDARY-2026-10-03.md) adds strict bounded data capture, canonical Ed25519 nonidentity prime-subgroup checks, full-roster preflight, fresh post-observation trust and current native IAM checks. Root reviewed the exact four-file delta `d29ae4e4a690c27e8b2155b7e51b0e022d49d728`, raw 100,779 bytes SHA256 `b44a8ebbb73df41441dbca253abe24e8c4570c82bead606574ddf9a145246850`. All encoded/decoded/compressed/raw identities and applicability were checked. Original test and report byte prefixes remain intact. The original Darwin 52/72 passing, twenty-failure receipt remains private: `native-authority-local-red.log`, SHA256 `98339029d4d0c8c8dfbcbbdddb0b213b64c4238b1e6a4d77cb444924ae7c92e7`. Cloud Linux final comparators retained three candidate-capture environmental failures; the current root affected set passes separately below. No real deployment authority is configured.

The [Integration repair](../INTEGRATION-OFFLINE-REFUND-REVIEW-BOUNDARY-2026-10-03.md) preflights every returned column's UTF-8 byte length, per-row and remaining aggregate limits in fixed owning-module SQL before that set's variable-width materialization. Postfetch structural/canonical bounds remain. Root reviewed exact three-file delta `c50d5d632f13107abdc097ca27ab9aa08ddeddcc`, raw 29,684 bytes SHA256 `c5760983b4f6db74f515ce55b3fb74ace8dd851780096fd4e97e2455b4cfbdb5`; compressed/decoded/raw identities, ownership and applicability were verified. Original test prefix and historical report content remain intact. A root report-prefix assertion failed because the patch inserts updated status below the title; inspection confirmed original content remains unchanged, so no source/test assertion was altered.

The [Platform boundary delivery](../PLATFORM-OFFLINE-REFUND-REVIEW-BOUNDARY-2026-10-03.md) supplies twelve independent native tests, with no confirmed production defect. Exact two-new-file delta `7ae9f0f3c0697d29bcbf49f2a91e1450eba17941`, raw 32,387 bytes SHA256 `71c6a951f2f39dc26c9ff4ca1419ed9c79b72f723a3cb7de4532ce505207a0ef`, was checked against every encoded/decoded/compressed/raw identity, owned path and applicability. Setup failures remain in the delivery report.

## Current workstation verification

Maintenance dedicated and affected command:

```text
node --import tsx --test tests/restore-native-maintenance-authority-boundary.test.ts tests/restore-native-dispositions.test.ts tests/restore-boundary.test.ts tests/restore-activation.test.ts tests/restore-review.test.ts tests/restore-offline-approvals.test.ts tests/restore-offline-envelope.test.ts
```

Exit 0, 238/238 pass, zero failure/cancellation/skip/todo, 8,891.635625ms. Private `maintenance-repair-local.log` SHA256 `fa51b2f369ef0a92ed1428bdbe40c44300382fcdb51981b6734fbb9034ffd443`.

Integration/Platform dedicated and selected affected command:

```text
node --import tsx --test tests/integration-offline-refund-review-boundary.test.ts tests/integration-offline-refund-review.test.ts tests/integration-restore-dispositions.test.ts tests/platform-offline-refund-review-boundary.test.ts tests/platform-offline-refund-review.test.ts tests/refund-claim-review.test.ts tests/provider-config.test.ts tests/webhook-lifecycle.test.ts
```

Exit 0, 115/115 pass, zero failure/cancellation/skip/todo, 2,995.512166ms. Private `integration-platform-final.log` SHA256 `0d0e77c8da51c3b431fa9eb9886baed9f5e44f0db9a06feee9bb4ee154a80dea`.

Wider affected command:

```text
node --import tsx --test tests/integration.test.ts tests/integration-authority.test.ts tests/integration-operations.test.ts tests/refunds.test.ts tests/refund-callbacks.test.ts tests/accounting-refunds.test.ts tests/accounting-credit-applications.test.ts tests/accounting-balances.test.ts tests/checkout-renewal.test.ts tests/checkout-observations.test.ts tests/integration-offline-refund-evidence.test.ts tests/platform-offline-refund-review.test.ts tests/platform-offline-refund-review-boundary.test.ts tests/billing-offline-refund-review.test.ts tests/platform-restore-disposition-receipts.test.ts
```

Exit 0, 257/257 pass, zero failure/cancellation/skip/todo, 10,232.275417ms. Private `integration-platform-affected-final.log` SHA256 `19e71f6774610a818da280aaac969d8c8047ee2c38c19d1590193c6aa33db8bb`. These overlapping sets are not summed as unique tests. Complete TypeScript and assigned-file formatting passed on the combined implementation. Final document/whitespace checks precede publication.

## Tested increment bytes and limits

| File                                                          | SHA256                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/server/restore-activation.ts`                            | `4aed4564e0d30ad00fe348b0402928d3213b34ebd653b0a9e5b61253cfdf8234` |
| `src/server/restore-native-maintenance-verifier.ts`           | `5f26354966fe87dea7eaf447571c26d68583001735dc1b84489d7040dddc1559` |
| `tests/restore-native-maintenance-authority-boundary.test.ts` | `52c5b8ad2508f4134befc06130a016b45d6a6d06be233f48122e31a31c3d9212` |
| `src/server/integration-offline-refund-review.ts`             | `3d119665674da36732e09183e2d797533858bc1d988df29335585a4618826111` |
| `tests/integration-offline-refund-review-boundary.test.ts`    | `c6ac7e9e033a6bd81bed8aed4b020553581ef420850e7e90a35a50820d383fee` |
| `tests/platform-offline-refund-review-boundary.test.ts`       | `359852b1b73dcf169c7214c9eb5ecdc4570f021c288f7cbfa268d789937aaa24` |

Listed increment bytes stayed unchanged through the reported final runs. This receipt does not bind every transitive file or claim a new full native/browser run, production runtime qualification, provider truth, live fencing, current external registry or product acceptance. Requested delegated Astra/High remains unverified because the cloud launcher exposes neither setting.

Self-review checked strict data/resource limits before variable allocation, native writer and ownership, original assertions/history, exact signature purpose and native verification, fresh trust/current IAM, no stale association reuse, immutable redacted facts and rollback/conservation. No schema, dependency, third-party license, workflow, provider transport or recovery-release qualification change. Private logs, transfer patches, runtime/signin files and credentials remain excluded. The qualified offline mutation coordinator, external authority/source fencing and actual provider/device/infrastructure/operator qualification remain incomplete. No CI runners, PRs, merges, deployment or provider IO were started.
