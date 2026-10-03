# Local offline approval and carrier increment — 2026-10-03

Parent: `48f94e6ff1b31d02a5ed74483eb11df2c36859e7`. Direct workstation environment: Darwin/arm64, Node v24.16.0, SQLite 3.53.0. These are focused synthetic results; all 44 tasks and 10 gates remain NOT VERIFIED.

## Approval repair

The previous small-order check accepted mixed-torsion curve points. Two new unchanged regression cases fail before repair: a roster public key was accepted, and a signature R reached a deliberately permissive mocked host verifier. Seven independent vectors use Python affine Edwards addition B+[i]T for i=1..7, with standard base point B and order-eight T `c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a`; independent generation checked [L]B=identity, [8]T=identity, [4]T!=identity and both [8]P and [L]P nonidentity for all seven vectors. Existing assertions remain intact. No actual forged mixed-point signature or native-host vulnerability is claimed.

The repair enforces the explicit local nonidentity prime-subgroup policy with [L]P=identity for public key A and signature R. Canonical curve decoding and scalar validation remain; native crypto still verifies the complete signature equation. Addition uses the complete extended-coordinate formulas in [RFC 8032 section 5.1.4](https://www.rfc-editor.org/rfc/rfc8032#section-5.1.4). This is a stricter local recovery policy, not a claim that RFC 8032 requires this policy. It grants no current registry, independent identity, operations authority or recovery permission.

Final command after source formatting:

```text
node --import tsx --test tests/restore-offline-approvals.test.ts tests/restore-offline-envelope.test.ts
```

Exit 0: 36/36 pass, zero failures/cancellations/skips/todo, 1,168.706834 ms. Retained private `offline-prime-subgroup-final.log` SHA-256 `f68082fa3efc846a466029f6fa55c816d60b30a24f388bf027b8e8b9eb02e99c`. Original red: exit 1, 19/21 pass, two failures, 452.156167 ms; `offline-prime-subgroup-red.log` SHA-256 `a6b9e7e9c8761010deeda69527417f0c5e9174e564c5a0101fb7b5ea79d1d343`. Earlier passing replay is retained separately.

## Carrier integration

Cloud commit `62c26145f255a4234a618a86819774c5a9df5af7`, excluded base `1207c8193fc56b79408ebb232b38580f6f3b3db8`, supplied exactly four owned files. Root verified all six encoded/decoded chunk identities, compressed 19,869 bytes SHA-256 `098e37d6c066ca86c0768cbc988f95ad079e9fdb56b0aa09fd3deabe9ad18025`, raw 73,118 bytes SHA-256 `5cd61660f5143830e5e87b18299098c01013140e4b35981d7b928c8f72e43f6b`, exact file ownership and applicability. Original cloud failures and limitations remain in the [delivery report](../CARRIER-OFFLINE-MEMBER-REVIEW-2026-10-03.md).

Root composed the actual fixed reader as `Application.carrierOfflineMemberReview`; dedicated fixtures now exercise this property. The new Platform raw-hold accessor and carrier reader check their owning SQL count/type/UTF-8/per-row/aggregate limits before variable materialization. The carrier review remains read-only and deeply frozen, with unresolved provenance/current Fulfillment custody/provider-account/qualified evidence/source-fence/current independent authority blockers retained. A raw historical hold is not a qualified current fence. No dispatcher, claim retirement, owner mutation or provider access is supplied.

Final workstation command after composition/formatting:

```text
node --import tsx --test tests/carrier-offline-member-review.test.ts tests/carrier-restore-dispositions.test.ts tests/canada-post-groups.test.ts tests/canada-post-creation.test.ts tests/canada-post-manifest.test.ts tests/carrier-claim-review.test.ts tests/carrier-bookings.test.ts tests/canada-post-evidence.test.ts
```

Exit 0: 467/467 pass, zero failures/cancellations/skips/todo, 6,605.800333 ms. Private `carrier-review-local.log` SHA-256 `849a8dbb6f84eeef5cf443214d1a8120e3700768e3bfbaf0338ae9ed36f05212`. Cloud Linux 467/467 is separate environment evidence. Requested delegated Astra/High remains unverified because the cloud launcher exposes neither effective setting.

## Tested increment bytes and limits

| File | SHA-256 |
| --- | --- |
| `src/server/restore-offline-approvals.ts` | `92f82b3facd072e43167cc9b8d579920245876f9ba3046d405f1e27cfa96b0d2` |
| `tests/restore-offline-approvals.test.ts` | `29a56fa171fd9b51ec93ab719e50e1944609d0784e330be74c6d26fd9da0c90d` |
| `src/server/restore-offline-envelope.ts` | `be2aedadba2f2d4186b6c13ac7c7a899dbb7699def463a2909de7b8b1f7fc64b` |
| `tests/restore-offline-envelope.test.ts` | `8186623a400c36b3ff5569e8f71b22a96aebc19bc960c6eac36c996844b2cbe9` |
| `src/server/platform.ts` | `c6950016168d2beada440a03269f33f951d2850554ed795c958c156550cf7328` |
| `src/server/application.ts` | `bb410a4cd987050ffb9e51da309e76ab5dc0625eaa1c8800e48de7657d6a9d74` |
| `src/server/carrier-offline-member-review.ts` | `912c93ed71045cb365de6238dcae835415696ba36e4b06381e7e4c56123977de` |
| `tests/carrier-offline-member-review.test.ts` | `03b668aa65d166d607cdc61a20333d5016711a829415f76d00bbb603d4f86905` |

Complete TypeScript, assigned formatting and whitespace checks exit 0. Planning structure passes; this verifies document structure only. These hashes bind the listed increment and selected tests, not every transitive file, a fresh full-system run, production-only runtime or operating qualification. The pending native maintenance authority red test/report remain uncommitted until their separate repair is reviewed and replayed. No existing behavior was qualified by their presence.

Self-review checked fixed owner SQL, current IAM/site/password authority, required writer transaction, detached immutable facts, original assertions, no mutation/provider IO, cryptographic purpose and native signature verification, canonical bytes, full native history refusal and conservative bounds. No schema, dependency, license, workflow or ordinary transport gate change. Private transfer/log/signin/runtime files remain excluded. No CI, PR, merge, deployment, provider call or product gate claim.
