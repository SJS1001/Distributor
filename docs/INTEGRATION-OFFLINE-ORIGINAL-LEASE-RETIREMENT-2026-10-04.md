# Internal original lease retirement task and retained provenance

Root integration at `6fb26b52dec2c1cbc443a469e8c9aa1040953ac8` repairs the exact cost-command/audit join. Actual workstation native-task61/61, command-reader75/75 and affected290/290 checks pass, with zero other outcomes; TypeScript passes. Historical cloud failures below remain preserved. The [signed root coordinator](RESTORE-OFFLINE-ORIGINAL-LEASE-RETIREMENT-COORDINATOR-2026-10-04.md) composes this task under the outer guard; external qualifications remain unresolved.

Excluded base: `46b2d0e443af1f8206dbb4f2cf80c51fc4fd32d8`. This isolated branch preserves the previous original-lease command review and copied-lease primitive. Only the four assigned new files change. The exact closing commit, tested source/test bytes and transfer hashes are in the delivery manifest.

**Historical cloud result, superseded by root integration:** Native task execution on that cloud snapshot was conservatively blocked by an owning source-command join. Schema22 is now integrated at exact prerequisite `e35781a15bc39a6c64c6e289e20f0cb895b6518e`; the historical schema19 refusal is preserved below. The actual running lease command reader reports `COMMAND_PREIMAGE_NOT_OWNER_JOINED` for required ordinary cost prepare/decide receipts. Root owns that missing join. This task does not filter the blocker, and the original success/restart/late-fault assertions remain red. No successful composed owner mutation, restart recovery or late-write rollback is claimed.

AGENTS, README, PLAN, DECISIONS and current HANDOFF were read. Owner continuation overrides historical stop text. The canonical rule supplied in the assignment requests **gpt-6-astra/high** for this boundary; effective model/effort is unexposed and **unverified**. No additional session/agent, CI, provider call, PR, push, merge or deployment was used. Filename dating follows the assigned report name.

## Fixed internal API

[IntegrationOfflineOriginalLeaseRetirement](../src/server/integration-offline-original-lease-retirement.ts) exports:

```ts
new IntegrationOfflineOriginalLeaseRetirement(
  database: Database,
  identity: Identity,
  platform: Platform,
  journals: StockJournalDelivery,
)

applyInTransaction(preparerLocator, executorLocator, envelope, payload)
recoverRetainedInTransaction(preparerLocator, executorLocator, envelope)
```

Both locators are **exactly** `{id, orgId}`. Supplied Actor roles, account assertions or extra fields refuse. Both actual current native principals must be distinct finance/admin staff, same organization, active, not account-bound and not forced to change passwords. Actual Database writer and raw retained hold are mandatory. The actual owner graph, reciprocal Costs/Journal references, stores and absence of per-instance method replacements are checked before hooks and during final recovery. Reentry refuses.

The fixed task is `integration.original-lease.retire`, version 1, owner `integration`, with no site scope. The detached `OriginalLeaseRetirementPayload` contains exactly the native thirteen primitive fields:

`journalId`, `orgId`, `leaseId`, `leaseActor`, `leaseStarted`, `leaseMode`, `dispatched`, `requestRef`, `sourceId`, `sourceHash`, `attemptId`, `reviewHash`, `expectedFactsHash`.

It retains native `DJ-<18 lowercase hex>` request references, safe lease millisecond arithmetic, write/lookup mode, 0/1 dispatch and exact lowercase hashes. Empty attempt ID denotes the first original. Normal/revoked proxies, getters, symbols, hidden/custom/extra properties, malformed values and oversized strings refuse before native hooks. No SQL, evidence parser, callback, source port, arbitrary JSON or authority flag is accepted.

Envelope subject/org/state/payload must match that actual complete native projection. Expected revision is the selected original's last observation revision, or zero for none. The fixed prior claim is exactly:

```ts
{
  operationId: payload.journalId,
  tokenHash: digest(payload.leaseId),
  revision: envelope.task.expectedRevision,
  stateHash: payload.expectedFactsHash,
}
```

Payload hash is `digest(canonical(payload))`; envelope binding uses the existing `offlineTaskBinding` and its exact envelope canonicalization. These are local consistency bindings, not evidence qualification or signatures.

## Owning transaction ordering

The operation captures both locators, envelope and payload before native hooks, then:

1. Requires the actual enclosing writer, owner graph, both current principals and raw hold.
2. Uses the actual native phase reader to pin candidate file/logical identity, current generation, open session and durable head. It never implements a substitute schema/candidate checker.
3. Preflights complete global Integration provenance and performs reverse closure against all corresponding current-generation Platform task receipts. Existing journal, request or binding refuses; no cached/newest-row replay inference is used.
4. Obtains the complete current running projection through `readOfflineLeaseRetirementInTransaction` and the actual `PlatformOfflineOriginalLeaseCommandReviewReader`. Every native payload field joins exactly. The exact fixed unresolved qualification profile remains retained; any extra unjoined command/history/preimage blocker refuses.
5. Refreshes both principals/head, then invokes **only** `StockJournalDelivery.retireOfflineOriginalLeaseInTransaction` for journal mutation. It supplies the exact native thirteen-field CAS input. Native state changes only running to unknown, appends the existing `restore-interrupted` observation/audit and clears lease bookkeeping. Permanent references, dispatch marker, predecessor history, source/plan/policies, stock and money remain native-owned and conserved.
6. Obtains the existing bounded unknown-original Platform command review after mutation. Stores the exact canonical envelope and result preimage in its Integration table, including full native before projection, payload, observation and before/after/command/phase hashes.
7. Refreshes both principals/head and appends exactly one owning Platform task receipt. This exact base has **no** `recordTaskInTransaction`; its existing equivalent is `platform.offline.transitionInTransaction(generation, anchor, {kind: "record-task", receipt}, [])`. No foreign Platform SQL is used.
8. Performs retained recovery/readback after the final receipt, including both current principals. Exceptions escape to the root-owned outer transaction. There is no nested transaction, savepoint, constructor DDL or partial-error success result.

Application returns deeply frozen `OriginalLeaseRetirementResult` with status `native-owner-application-provisional`, `record`, `resultHash`, exact Platform `receipt`, full native unknown `after`, and `requiredChecks`. Recovery status is `native-owner-recovery-consistency-only`. The record purpose is `distributor-integration-offline-original-lease-retirement-v1`, version 1, status `native-owner-only`. Result hash covers the complete canonical record. The native observation hash uses the existing journal/org/revision/body/author/time domain.

**No returned application is committed merely because the method returned.** Root's qualified guard owns the actual outer COMMIT and outcome. Both application and recovery are trusted internal prerequisites only; there is no Application/HTTP/CLI registration.

## Durable storage and root wiring

[The schema module](../src/server/integration-offline-original-lease-schema.ts) exports `INTEGRATION_OFFLINE_ORIGINAL_LEASE_SCHEMA`, `INTEGRATION_OFFLINE_ORIGINAL_LEASE_DDL`, `INTEGRATION_OFFLINE_ORIGINAL_LEASE_INITIALIZE_DDL`, and `ORIGINAL_LEASE_PROVENANCE_TABLE`.

The root-published `integration_offline_original_leases` table is STRICT, with native journal foreign key, one row per journal, unique binding and `(org_id, request_id)`, exact envelope/result preimages, generation hash, record hash and fixed before/after/observation hashes. UPDATE/DELETE triggers reject changes; Database's existing recursive triggers also protect REPLACE. Empty installation is not backfill or legacy evidence. One provenance row per journal deliberately refuses a later second retirement of the same journal; a future repeated-generation subtype requires separate design, not overwriting this history.

Root published these exact schema objects and schema22 initialization/upgrade in e35781a15bc39a6c64c6e289e20f0cb895b6518e (tree 63bf7a3b5ac3e4f033d3f61ee75c5e1b55ef9734). This task was moved to that exact prerequisite in the same checkout, preserving original commits 1fa3199be7b7a700fcd817d3fb8253735735b2a0 and 7fc72edfd66afd15322d2dcde92dd7e0723e060f. The published schema declaration and shared wiring remain byte-identical. Tests still explicitly install the exported idempotent DDL; on schema22 this leaves the already initialized schema unchanged. No fake profile is installed.

Complete global storage preflight checks fixed-column storage types, literal NUL, row count, per-row/aggregate UTF-8/blob lengths and separate envelope/record budgets **before returning variable fields**. SQL conservative punctuation/container limits precede JSON validity and parsing. Blob reads use fatal UTF-8 and byte round-trip checks; canonical exact JSON rejects duplicate/noncanonical representations, escaped NUL, lone surrogates, unsafe numbers and oversized structures. No LIMIT/pagination establishes completeness.

| Bound                           |                  Value |
| ------------------------------- | ---------------------: |
| Global provenance rows          |                    128 |
| Envelope / record bytes         | 1,048,576 / 16,777,216 |
| Row / global aggregate bytes    |        18 MiB / 64 MiB |
| JSON nodes / containers / depth |    65,536 / 8,192 / 64 |

The larger record bound accommodates the actual native reader's bounded source/plan history; it does not copy the unrelated refund 64 KiB limit. Existing native and Platform owning preflights remain in force.

## Recovery proof and limitations

`recoverRetainedInTransaction` needs both exact current principal locators and the exact original envelope, **not** a caller-supplied record, private file, fake command preimage or process-local WeakSet identity. It reads the stored original record, recomputes its hashes, validates exact payload/envelope/native identities, and reverse-matches every current-generation task receipt with Integration provenance. Missing, ambiguous, mismatched or orphan records/receipts refuse. Rehashed preimages cannot replace the receipt's original result hash.

It uses the existing pinned receipt recovery reader for actual candidate file/generation/session identity. The actual unknown-native review must match the retained after hash. Complete before/after conservation is checked by allowing only the exact native interrupted observation and lease-clear transition from the stored before projection. This comparison uses the retained preimage; it does not claim independently recovered provider/source truth. All current retained original command/observation/audit facts must match the stored post-mutation command review hash. Both principals, native state, raw hold, complete provenance closure and `total_changes()` are rechecked. Recovery writes nothing and never reexecutes the original retirement. The retained post-mutation Platform hash covers complete current-org history: even later unrelated audit changes conservatively invalidate this exact recovery profile. That refusal is not authorization to reexecute.

The required checks always retain `CLAIM_START_TIMESTAMP_NOT_IN_PLATFORM_AUDIT`, `SOURCE_PROVIDER_AND_CURRENT_COMMIT_AUTHORITY_NOT_QUALIFIED`, `HISTORICAL_RECEIPTS_ARE_NOT_EXTERNAL_PROVENANCE`, `SOURCE_COMPLETENESS_UNQUALIFIED`, `CURRENT_EXTERNAL_AUTHORITY_REQUIRED`, and `RECOVERY_HOLD_RETAINED`. Native claim-start coincidence does not discharge the first limitation. This internal method does not itself prove stopped-source fencing, source interval/candidate completeness, external authority, approvals, provider nonposting, safe resend, or qualified trust through COMMIT. Root must separately qualify those obligations before exposing execution. Hashes and strings grant no authority.

Existing native exclusions remain: correction journals, CA/USD originals, write leases with permission observation history, expiry-only lookup history without the existing exact-request unknown proof, competing posting owners and contradictory source/permission chains. Ordinary provider/recovery gates are unchanged.

## Foreground verification and preserved failures

Linux x64, Node `v24.19.0`, SQLite `3.53.3`, TypeScript `7.0.2`, Prettier `3.9.9`. Unowned files/tests remain byte-identical to the integrated prerequisite e35781a15bc39a6c64c6e289e20f0cb895b6518e; the published schema declaration is unchanged. Synthetic fixtures use actual cost/source preparation, independent journal approval, write/lookup claims, dispatch and unresolved operations with no provider transport.

Preserved initial receipts outside the patch:

- First new test run: 40 tests, 0 pass/40 fail, exit 1. SQLite organization result objects needed explicit plain-record capture for the existing generation parser. Fixed the fixture mapping, not the parser.
- Second run: 40 tests, 24 pass/16 fail, exit 1. All sixteen intended successful regional/reporting/dispatch/mode combinations now reached the actual task and failed at unchanged `RESTORE_OFFLINE_NATIVE_PHASE` because the new table is not in the frozen schema19 profile.
- Expanded run: 55 tests, 28 pass/27 fail, exit 1. Sixteen success/restart cases, five assertions requiring actual late owner-write fault reachability, four post-phase native binding checks, and two retained-preimage tamper scenarios remain blocked at phase validation. Their expectations were not weakened to accept that early refusal.
- Expanded TypeScript initially failed on a test mutation of a readonly envelope. Fixed by constructing a detached changed envelope. Complete TypeScript subsequently passed.

Passing new cases establish current authority/password/account/org and writer/hold refusal, hostile input zero-trap capture, actual copied native lease refusal, STRICT append-only schema behavior, bounded malformed/UTF-8/NUL/count/aggregate provenance refusal, orphan Platform receipt rejection, graph substitutions and reentry. They do not exercise the blocked successful mutation path. The late-fault tests explicitly require their fault hook to be reached, so an early schema refusal cannot masquerade as successful rollback testing.

Final commands:

```sh
node --import tsx --test --test-reporter=tap --test-concurrency=1 \
  tests/integration-offline-original-lease-retirement.test.ts \
  tests/platform-offline-original-lease-command-review.test.ts \
  tests/stock-journal-offline-lease-retirement.test.ts \
  tests/integration-offline-original-cancellation.test.ts \
  tests/restore-offline-storage.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/prettier --check \
  src/server/integration-offline-original-lease-retirement.ts \
  src/server/integration-offline-original-lease-schema.ts \
  tests/integration-offline-original-lease-retirement.test.ts \
  docs/INTEGRATION-OFFLINE-ORIGINAL-LEASE-RETIREMENT-2026-10-04.md
git diff --check
```

Historical excluded-base affected run: **283 tests, 256 pass, 27 fail**, exit 1, zero skips/cancellations/todos, 60,362.469496 ms. All **228 existing affected tests pass**; the new file has **28 pass / 27 preserved schema-blocked failures**. Complete TypeScript, owned formatting, relative links and whitespace checks pass. A final fixture refinement supplied a valid envelope to malformed-record checks so envelope rejection could not mask record parsing; the final results above include that change. Final source/test bytes are bound by the manifest; only this report was completed afterward. That historical run required shared schema wiring. Root subsequently published schema22; the current additional owning join and its preserved assertions are described below. No product gate, transport permission, provider qualification or successful operational recovery is claimed.

## Schema22 replay and exact remaining owning contract gap

The integration prerequisite is **e35781a15bc39a6c64c6e289e20f0cb895b6518e**; original excluded task base remains **46b2d0e443af1f8206dbb4f2cf80c51fc4fd32d8**. The final four-path delivery against the original base includes the schema declaration already published unchanged by root. No shared checkpoint changes are included. Root should preserve its existing identical schema file when applying the three unpublished paths. Exact tested/closing commits and all file hashes accompany the transfer manifest.

The public GitHub connector supplied the commit, complete tree and missing blobs. Local Git object hashes independently reproduced the exact commit, tree and all 1,401 blob identities. The requested HTTPS fetch remote was installed, but direct fetch was blocked by runtime network policy; no remote writes occurred.

Schema22 first dedicated replay: **61 tests, 31 pass / 30 fail**, exit 1, 15,135.233259 ms. The phase guard now passes. The failures expose an additional required native-source command closure, not an installation failure. A diagnostic assertion preserves the exact expected blocker profile before the successful-flow assertion. The isolated first matrix case reports the additional **COMMAND_PREIMAGE_NOT_OWNER_JOINED**. Schema22 affected replay: **290 tests, 260 pass / 30 fail**, exit 1, 63,379.219579 ms; all **229 existing affected tests pass**, with zero skips/cancellations/todos. The additional existing test versus the old base is part of the published prerequisite.

The actual [running lease command reader](../src/server/platform-offline-original-lease-command-review.ts) includes `nativeSourceId` in `nativeIdentities` (lines 597–604). Its complete command scan then classifies non-journal commands touching that identity as unjoined (lines 1107–1113). Actual required native `accounting.cost.prepare` and `accounting.cost.decide` receipts both return the source packet identity. Those are created by [IntegrationCosts.prepare/decide](../src/server/integration-costs.ts), not arbitrary fixture SQL. The reader retains their aggregate command/history hash but does not expose an exact source-command preimage join. The existing command-reader tests assert the six fixed qualifications individually, rather than requiring absence of this extra blocker; therefore their passing status did not establish a mutation-ready source-command closure.

The task requires the exact six fixed limitations and refuses every extra blocker. **No blocker filtering, source-command omission, deleting native command history, alternate reader callback or guard weakening was added.** Root acknowledged ownership of the required bounded `accounting.cost.prepare/decide` join on 2026-10-04. That join must preserve full global preflights, exact original request/result/audit preimages, independent current source/native bindings and unrelated-command refusal. This return does not edit that reader or anticipate a verified output from the future repair.

The successful mutation/restart/lost-response and five genuinely late-fault cases remain red, including their original reachability assertions. Consequently this task has **not** verified successful retirement plus provenance/receipt, restart recovery or late atomic rollback on the actual composed path. It has verified the earlier conservative refusals and complete TypeScript. Six added success-dependent adversarial cases cover changed native lease/dispatch/review fields, audit corruption, removed provenance/orphan receipt and loss of original mutable payload; they remain meaningful blocked assertions. Shared schema22 changed the literal version type, producing one initial TypeScript TS2367 on the historical schema19 diagnostic branch; explicit numeric comparison preserves both assertions and complete TypeScript then passes. All initial failed logs are retained outside the patch.

Requested model gpt-6-astra/high; effective runtime model/effort is not exposed and remains unverified. No product gate, operational authorization, external/source/provider qualification or COMMIT fencing is established. Root must repair the owning source-command join and replay every preserved success and late-fault assertion before composing operational execution.

Closing verification: tested commit **e411324d0eb232dcceaff2eedf4d02f9243debec**. Final dedicated rerun: **61 tests, 31 pass / 30 fail**, exit 1, 14,494.279948 ms, zero cancelled/skipped/todo. Complete TypeScript exits 0; owned formatting, relative links and whitespace pass. Source/test/schema bytes are identical to that tested commit; the closing commit changes only this report. All verification processes completed in the foreground. Root explicitly requested this preserved-failure transfer pending its source-command join.

## Root integration replay (2026-10-04T01:46:45.681392+00:00)

The historical cloud schema22 failure receipts above are retained. Root repaired the existing running-lease command reader to reconstruct the original cost packet prepare and approval request preimages and complete results from the native owner projection, then match exact command and semantic audit objects, actors, request hashes and audit order. Only those matched objects are discharged from the unjoined-history blockers. Historical claim-start provenance remains explicitly unqualified.

The direct macOS workstation replay now passes all 61 dedicated tests (8,460.747375 ms), including actual mutation, retained restart recovery and reached late fault rollback, and all 290 affected tests (9,725.250875 ms), with zero failures, cancellations, skips or todos. TypeScript exits zero. These tests cover the current integrated working inputs, including the root reader repair; the frozen full-suite receipt from the previous checkpoint does not cover these changes. This internal task remains unwired pending the signed coordinator and independently qualified host. Synthetic fixtures confer no infrastructure or provider qualification and pass no product gate.
