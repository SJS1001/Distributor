# Captured failed-refund native projections — 2026-10-03

## Baseline and ownership

Repository: `SJS1001/Distributor`; published source ref:
`codex/local-distributor-checkpoint`; exact excluded baseline:
`e8829bb778e4fe9a9b0ee9752afa5e0d0fae7c40`.
Work ran in the expressly requested isolated checkout
`/workspace/Distributor-refund-native-projection`, branch
`codex/cloud-refund-native-projection`, preserving previous work.
The final commit and all three final file hashes are recorded in the accompanying
transfer manifest; that commit has this exact baseline as its parent.

Owned changes are limited to `src/server/integration-offline-refund-evidence.ts`,
new `tests/restore-offline-refund-native-projection.test.ts`, and this document.
All pre-existing tests and reports remain byte-for-byte unchanged. The new test
uses the repository's synthetic fixture and private filesystem conventions.
Requested Astra/high cannot be verified: this launcher does not expose effective
model or reasoning settings. No further delegation occurred.

## Reproduced gap and minimal change

The comparator previously verified the original refund request and the equal
source/candidate history but omitted those fields from its result. A later exact
native join could not recover the full reason, original receipt identities and
timestamps, or poll retry tuple from that result without another input surface.

`OfflineFailedRefundComparison` now additionally returns:

- `refundRequest: OfflineFailedRefundEvidenceInput["refundRequest"]`: original
  `invoiceId`, `paymentId`, `amount`, `reference`, and full `reason`.
- `candidateHistory: OfflineRefundEmptyHistory`: original subject identifiers,
  existing coverage assertion, complete poll tuple, every compared bounded empty
  history collection, and both original request/queue receipts including
  organization, actor, command, key, request hash, result, and creation timestamp.

The five added source lines expose the existing `request` and `h` locals from the
strict detached capture. They run through the existing recursive output freeze.
No caller objects or read buffers escape. No new parser, callback, reopening,
registry, flag, or evidence schema is introduced. Existing source/candidate
equality, bounded capture, request hash and provider validation remain in place.
The existing `coverage` strings remain unqualified assertions, not completeness
proof or authority.

The opaque private handle's fixed `compareFailedRefund` already returns this
exact comparator type. Thus both fields travel through the original single
captured read and one-shot compare without any private-reader/parser change.
Tests remove the original file after successful completion, then compare from
the exact captured allocation with no further opens/reads; buffers are erased,
repeated compare/completion refuse, and only the detached frozen result remains.
This is historical captured-byte consistency, not a claim that a removed path
remains current or usable as a native candidate.

## Verification

Environment: Node `v24.19.0`, Linux cloud workspace, existing installed locked
dependencies; the checkout lockfile matches the previously installed checkout.
No dependency/configuration changes or additional services were needed. All
commands ran directly in the foreground, using synthetic CA/CAD, CA/USD and
US/USD fixtures and private temporary files; no provider calls occurred.

Before the production edit, this command exited **1**:

```sh
node --import tsx --test tests/restore-offline-refund-native-projection.test.ts
```

The baseline run executed **26 tests: 18 passed, 8 failed**, zero skips,
cancellations or todos (368.245376 ms). All eight positive projection tests
failed on missing `refundRequest`; the 18 refusal tests already passed. Those
failures were retained without weakening assertions. Private original log:
`/workspace/distributor-refund-native-projection-audit/baseline-red.log`, SHA-256
`6a0f692db156146db243fc0fbe4c1f7780ba9ab62c97c78a9398244e2f806d92`.

After the five-line source change, this command exited **0**:

```sh
node --import tsx --test \
  tests/restore-offline-refund-native-projection.test.ts \
  tests/integration-offline-refund-evidence.test.ts \
  tests/restore-offline-private-refund-parser.test.ts \
  tests/restore-offline-private-evidence.test.ts \
  tests/restore-private-evidence.test.ts
```

**203/203 tests passed**, zero failures, skips, cancellations or todos
(1306.019183 ms). Private `focused.log` SHA-256:
`0eda5ba79f605925842872beec55e01404eb239464cc56586dcf21b5741e9f91`.
The 26 new tests exercise both entry points, full Unicode reason and supported
reason bound, exact original receipt/poll values, recursive freezing and caller
mutation, source/candidate mismatch, one-shot disposal/zeroing, same allocation
decoding, no reopened file, normal/revoked proxies and accessors without executed
traps, unsupported extra flags, malformed identities/results, and unsafe retry
integers. The existing four suites retain their original refusal assertions.

The fixed original synthetic fixture was recorded against the unmodified
baseline comparator. Its unchanged comparison digest is
`da9b6af63558e198f110ad1b9a53c79b7eb1d778ea2ddb25f5f86dac742580f9`;
its unchanged canonical provider body hash is
`5d24997a5726c7f6177f1679a51e49bd30a2404fd65a1aa6744db8f7808be2a2`.
The new golden assertion also checks exact body bytes, idempotency key and
outcome. The input-hash domain remains
`distributor-offline-failed-refund-comparison-v1`.

`npm run typecheck` exited **0** for complete TypeScript checking. Private
`typecheck.log` SHA-256:
`8a702e6f87c8a6ca129035a44568229aa0a0ce49ce48d85c056ac1c3a87c0c57`.
Assigned-file Prettier checking and `git diff --check` are recorded in the
transfer receipt. No full-suite or product gate claim follows from these checks.

## Remaining root responsibilities

These fields are local consistency projections only. They do not grant commands,
execution, retry, release, native write authority, source truth or provider
qualification. Root must still join all required current native owner facts,
original request/queue/audits and exact results, and enforce current IAM,
independent signatures/trust/revocation, evidence qualification, complete native
history, generation/session/candidate binding and the qualified external fence
through commit. Durable exact restart recovery remains separate from current
execution authorization and must not repeat an owner write or reopen consumed
evidence to reimport it.

This task does not select owner mutation ordering. The historical composition
report is unchanged; its Billing-first proposal remains unresolved against
Integration's first-unknown native review. No coordinator, Application, schema,
private-reader, owner-write or recovery behavior was changed. Full-system and
product gates remain **NOT VERIFIED**; root independently integrates and replays
the patch before publication. No CI, runner, workflow, push, PR, merge, deployment,
account/credential/settings change or background automation was used.
