# Integration original cancellation owner task — 2026-10-03

This adds an internal same-writer Integration composition for the existing structural private task `integration.quickbooks-original-cancelled.import`, version 1. It cancels one already unknown original through the existing StockJournalDelivery owner, then records exactly one Platform offline task receipt. No Application route, provider operation, schema, common coordinator, command preimage or qualification mechanism is added.

Excluded baseline: `a0b555e27b7412077afd22dee064687ae763f181`, exact reconstructed Git commit and tree `1aa3a4f6739db4af24098cdab13b8100cce4f734`, from public `SJS1001/Distributor` branch `codex/local-distributor-checkpoint`. Reconstruction used public connector Git objects with verified blob/tree/commit hashes because direct Git access was unavailable. The later parent checkpoint was not imported. Only the new source, test and this report are owned by this delivery. The closing commit and exact file/patch identities are in the delivery manifest; a document cannot embed its own final commit hash.

Requested model/effort: `gpt-6-astra/high` under the owner's integrity-boundary rule. Effective runtime model/effort are unexposed and unverified. No nested agent/session was launched.

## Exact API and required root inputs

[IntegrationOfflineOriginalCancellation](../src/server/integration-offline-original-cancellation.ts) takes actual `Database`, `Identity`, `Platform`, and `StockJournalDelivery` instances from ONE Application. Constructor checks reject proxy/substitute prototypes; trusted composition remains responsible for supplying the same actual owners. There are no executable ports, caller SQL, table selectors or callbacks.

```ts
new IntegrationOfflineOriginalCancellation(database, identity, platform, journals);

applyInTransaction(
  evidenceActor,       // exact inert { id, orgId }, NOT a full Actor object
  cancellationActor,   // exact inert { id, orgId }, distinct current principal
  envelope,           // exact existing fixed OfflineTaskEnvelopeV1
  capturedOriginal,   // actual process-issued CapturedOfflineOriginalEvidence
  reason,             // exact bounded string, equal to signed attestation.evidence
): OfflineOriginalCancellationResult;

recoverInTransaction(
  evidenceActor,       // both original principals must still be current staff
  cancellationActor,
  exactEnvelope,
  retainedRecord,     // exact returned OfflineOriginalCancellationRecord preimage
): OfflineOriginalCancellationResult;
```

Both calls require the caller's existing actual Database writer transaction. No nested transaction or savepoint is opened. Every exception must escape that outer writer. Root must independently bind authenticated approvals to the two locators; fresh IAM lookup verifies native permissions, not possession of the named principal's session or signing key. Finance/admin, organization membership, active status, absence of account scope, password requirements and actual raw restore hold are checked repeatedly, including after the task receipt write.

**Reason restriction:** existing private task v1 signs `canonical({version:1, source, candidate, providerClaims})`. It has no independent reason field. Therefore the explicit fifth argument must equal `capturedOriginal.claim.attestation.evidence` exactly. This is a deliberately narrower supported profile of the native cancellation operation. An independently worded reason is refused; it requires a root-owned signed payload-contract revision, not an unsigned argument or a change to the existing hash domain.

**Required durable recovery input:** Platform stores the result hash, not the result-record preimage. Root must durably retain the returned `record` and exact signed envelope/private evidence as part of its separately implemented commit composition, before allowing the native transaction to commit. If a process dies after COMMIT and that record is unavailable, this operation cannot recover its missing preimage from just the two observation hashes. It refuses instead of manufacturing it. Native cancellation observations alone cannot prove this offline task executed. The process-issued evidence WeakSet is never used as persistent provenance.

Recovery intentionally requires both original current principals and the exact record containing the retained evidence/cancellation hashes, rather than a single current actor plus two hashes. This stricter explicit-input contract is necessary to check the committed result preimage. Record absence, changed authority or later incompatible complete native history is a blocker; no receipt miss or stale result authorizes replay.

## Binding and native ordering

1. Capture strict inert locators, fixed envelope, primitive reason and issued evidence identity without invoking getters, coercion or proxy traps. Normal and revoked proxies, hidden/symbol/extra fields and custom prototypes refuse. No supplied Actor grants are trusted.
2. Bind fixed task owner/name/version, subject and organization, zero site IDs, null prior claim, expected last native observation revision and `expectedStateHash === captured.native.hash`. Recompute the complete original evidence-input hash exactly as the existing private parser does. The envelope's preparer/executor IDs must equal the distinct evidence/cancellation principals. This preserves the existing private-parser contract; expectedStateHash is **not** silently changed to the native-join hash.
3. Use [RestoreOfflineNativePhase](../src/server/restore-offline-native-phase.ts) for actual current open phase, raw generation, candidate identity/digest and retained release history before writes. Retain its exact storage head. Use [RestoreOfflineOriginalNativeJoin](../src/server/restore-offline-original-native-join.ts) to recapture complete native intent/source/plan/permission/attempt/observation/reference facts and their complete Platform observation-audit join. Capture identity or matching caller hashes never replaces these owner reads.
4. Refresh both principals, then call the existing `StockJournalDelivery.applyOfflineOriginalCancellationInTransaction`. That owner alone writes the ordinary original-cancellation-evidence observation followed by the distinct-author cancelled-unposted observation and its exact state transition. Its permanent reservations, snapshots, observation chains, audits, retry behavior, closed-period and source checks remain unchanged.
5. Read the resulting complete native cancellation proof and complete organization observation audits through their fixed native readers. Join every retained attempt observation to exactly one correctly authored/hash-bound audit with increasing sequence and no extras. Refresh both principals again. Require the Platform offline storage head/state to remain byte-canonically unchanged from the pinned pre-write state.
6. Form the fixed result record, hash its **entire** canonical representation, and pass exactly one `record-task` transition to `Platform.offline.transitionInTransaction` using the retained generation/anchor. The receipt binds existing task owner/name/org/request, full envelope binding, payload hash, original candidate hash and new result hash. No Platform.command receipt is fabricated; the ordinary recovery hold is never bypassed or cleared.
7. Before returning, run the same retained recovery path, including both current principals after the final write. Any failure rolls back the two observations, native state update, native audit/order/clock writes and Platform task receipt/journal/head together when root propagates it through the enclosing writer.

The new module contains **no SQL**. Cross-owner access uses actual task-shaped owners only. Existing owner SQL preflight and complete-history refusal remain intact.

## Result and bounded retained recovery

Exported `OfflineOriginalCancellationRecord` is a flat, versioned, frozen exact record with purpose `distributor-integration-offline-original-cancellation-result-v1` and status `native-owner-only`. It includes request/org/journal and both author IDs, envelope binding, payload hash, pre-native hash, captured-evidence hash, native-join hash, native-phase consistency hash, reason, exact native evidence/cancellation hashes, complete post-native-proof hash and complete post-observation-audit hash. These are native consistency commitments; none is an independent root authority hash or invented signer.

`OfflineOriginalCancellationResult` returns frozen `{version, status, record, resultHash, receipt, proof}`. Application status is `native-owner-application-only`; readback status is `native-owner-recovery-consistency-only`. The result hash is SHA-256 of the full canonical fixed record. The complete returned native proof is bound through its existing full canonical owner hash. Receipt identity, signed envelope and root evidence/source/trust hashes are bound by the existing envelope binding. No old purpose or hash definition changes.

The fixed record has exactly 19 fields: version/purpose/status/reason, ten lowercase 64-hex hashes and five bounded ASCII identifiers. Identifiers use `[A-Za-z0-9_-]{1,160}` (including the request ID; other envelope request-ID spellings are conservatively unsupported here). Reason is at most 2,000 well-formed UTF-8 bytes, without NUL or surrounding whitespace. Record canonical bytes are additionally capped at 16,384 after bounded primitive capture. No nested caller data is admitted into the record. Arrays/arbitrary JSON are not recovery inputs.

The existing native capture admits two complete 8,000,000-byte original projections within its 16,016,384-byte input profile. Those bounds are retained rather than copied from the much smaller refund profile. The journal reader retains its per-table/aggregate rows, UTF-8/blob and JSON limits before materialization; the cancellation proof remains bounded by its native profile. Platform observation review retains SQL preflight of at most 1,000 organization rows, 65,536 bytes per row and 8 MiB total before text selection/JSON parsing. Platform offline storage and phase readers retain their own fixed preflights and schema checks. After bounded reads the join never truncates or pages history.

Readback parses a new detached fixed record, recomputes its whole canonical hash and requires the exact Platform receipt via `RestoreOfflineCommitRecoveryReader`. It rereads native cancellation using the two exact retained observation hashes, verifies full proof hash, authors, exact consecutive revisions relative to the signed envelope and both retained reason copies. It rejoins every native observation and compares the complete post-audit hash. Reopening does not require or pretend to resurrect a process-issued evidence capture. Detached recovery output cannot be changed by mutating the caller's retained record.

This deliberately conservative readback refuses changed complete native facts or any changed organization observation-audit projection, even an unrelated later original-journal observation. Root must resolve such later history through a separately qualified design; the reader cannot filter it away or infer replay authorization.

## Remaining root prerequisites

The existing observation reader does not supply original Platform command request preimages or independently verified complete command lineage. The separately owned full original-command reader was not present in this exact baseline and was neither guessed nor imported. Root must join that reader before enabling common composition.

Current independent signatures/trust/revocation/clock, human approval/session authority, private evidence qualification, provider authenticity/finality/completeness, source/candidate qualification, operations authority and fences held through actual COMMIT remain mandatory root responsibilities. Expired synthetic envelope times and assertion booleans in tests are not qualified external evidence. The native phase and retained receipt readers are consistency primitives, not authority grants. This operation cannot supply QuickBooks posting/nonposting truth, retry/release permission or an operational route. No product gate or provider qualification is verified.

## Foreground verification and preserved failures

Environment: Node v24.19.0, Linux x64, SQLite 3.53.3, TypeScript 7.0.2, Prettier 3.9.9. Existing installed dependencies were reused through a temporary symlink; no package/dependency changes or installation. Synthetic file-backed Application/Database fixtures only. No provider IO, CI/workflow/runner, push/PR/merge, deployment or background executor.

Original receipts remain in scratch, with hashes recorded here so failures are not silently replaced:

| Receipt                           | Actual outcome                                                                                                         | SHA-256                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `original-task-tests-initial.log` | tsx launcher failed before tests: EPERM on local IPC pipe; command wrapper's final cat returned 0, child launch failed | `75c3c1a6cc77725c2930f93d4452d783fe0f15f6b971e8705383cfeafd393415` |
| `original-task-tests-second.log`  | 14/16 pass, exit 1; test used nonexistent session.receipts instead of actual history receipt entries                   | `bdd7335b80602d24ad12970cfdfcafed2a5d0009b3eff186b8b4413d1ff4bacb` |
| `original-task-tests-third.log`   | 55/56 pass, exit 1; audit fault matcher used column-list SQL while actual owner uses VALUES                            | `7399711e489a2f8850300d9e0ac13caadeec6700dff30433d8a3929fa9b06bf0` |
| `original-task-tsc-third.log`     | exit 1; readonly cloned test value and generic SQL-read spy type errors                                                | `f5ff5010f87fd7b11997809de45eac1d64d36297effa333fc3dc9ff35ddc9197` |

The corrected fault assertion still requires a real write to occur before the injected failure; assertions were not weakened. Test type fixes only make the mutable caller-copy explicit and preserve the Store.all generic return type. No production failure was suppressed. Runtime launch uses `node --import tsx --test` to avoid tsx CLI's denied IPC listener.

Affected foreground command (exit 0, **448/448 pass**, no failures/skips/cancellations/todos, 103134.088141 ms):

```sh
node --import tsx --test --test-concurrency=1 \
  tests/integration-offline-original-cancellation.test.ts \
  tests/stock-journal-offline-original-application.test.ts \
  tests/stock-journal-offline-original-review.test.ts \
  tests/stock-journal-offline-original-evidence.test.ts \
  tests/stock-journal-original-retry.test.ts \
  tests/stock-journal-reconciliation.test.ts \
  tests/restore-offline-original-native-join.test.ts \
  tests/restore-offline-private-original-parser.test.ts \
  tests/restore-offline-native-phase.test.ts \
  tests/restore-offline-commit-recovery.test.ts \
  tests/integration-offline-failed-refund.test.ts
```

Affected receipt SHA-256: `570bd0a7f859bbb84aaeebcb3ff8c79f4ae4052f331e62e9ad4a0aaae6a587fe`. Full TypeScript (`tsc --noEmit`) then passed after the two test-only typing fixes. Dedicated final replay, owned formatting and whitespace results are recorded below. No full product-suite/gate claim is made.

Coverage includes CA/CAD and US/USD independent native preparation/approval/unknown lease/cancelled ancestors, conservation/permanent references, exact two observations and one receipt, detached/frozen readback after reopen, expected-state/payload/revision/subject/claim/author joins, reason binding, current role/org/active/account/password/hold loss, normal and revoked proxies/accessors/symbol/hidden fields with zero traps, stale complete facts and audit corruption, record corruption/resource refusal, UTF-8 preflight before audit text materialization, actual request collision after native writes, native/audit/receipt faults, post-receipt principal revocation and full outer rollback. Existing CA/USD native refusal remains passing in the affected suites.

Final dedicated replay after the typing fixes: `node --import tsx --test --test-concurrency=1 tests/integration-offline-original-cancellation.test.ts`, exit 0, **79/79 pass**, zero failures/skips/cancellations/todos, 21960.329266 ms. Receipt SHA-256: `503e322e46a1225f137325fce7e00db4de284562061bee98c3df6e5486073ad8` (7,349 bytes). Production source is identical to the 448-test affected run; the subsequent test edits only fix static types/explicit mutable caller-copy representation. Complete `tsc --noEmit` passes, exit 0. Owned-path Prettier check, relative-link existence and `git diff --check` pass. The delivery contains no changes to baseline tests or any shared/other-lane file.
