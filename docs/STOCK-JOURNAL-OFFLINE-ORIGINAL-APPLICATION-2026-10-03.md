# Native offline original-journal cancellation and retained proof

This implements an internal D024/D025/D039 owning operation for one restored UNKNOWN ORIGINAL leaf to become `cancelled-unposted`, plus a fixed complete bounded read-back of that native outcome. It does not qualify provider evidence, source completeness, signatures, current external authority, independent signed approvals or fencing through COMMIT. There is no Application/HTTP/CLI wiring, runtime enablement, provider request or new schema/provenance table.

Excluded published baseline: `56cf9630cca401b9bdb4295229bf1af6719d6918` (source checkpoint `a1fab3bad3beed21fbcffddf2f442869e6adbe46`), tree `2e48c5714d82cfa2dc6a9bc8ff759c63bfdc9374`. Exclusive changes are [stock-journal-delivery.ts](../src/server/stock-journal-delivery.ts), the new [native tests](../tests/stock-journal-offline-original-application.test.ts), and this report. No extra helper file was needed. The existing comparator, private evidence parser, Platform, Integration, Application, schemas, earlier reports and earlier tests remain byte-identical to this baseline. Prior failure receipts are preserved.

Requested model/effort: `gpt-6-astra/high`; effective settings are unavailable in this runtime and remain unverified. No nested delegation or additional coding session was started. The exact public commit was reconstructed through the established GitHub read connector because direct GitHub fetch is blocked in this environment. Missing blobs, the complete tree and commit object all matched their Git object identities before an isolated detached worktree was created; previous worktrees were retained.

## Fixed owner APIs

The existing StockJournalDelivery instance already has the actual Database, Identity, Platform and IntegrationCosts owners. No arbitrary SQL, source/authority/parser callback, caller-selected state profile or provider transport is accepted.

```ts
applyOfflineOriginalCancellationInTransaction(
  evidenceActor: Actor,
  cancellationActor: Actor,
  captured: CapturedOfflineOriginalEvidence,
  reason: string,
): OfflineOriginalCancellationProof

readOfflineOriginalCancellationInTransaction(
  actor: Actor,
  journalId: string,
  evidenceHash: string,
  cancellationHash: string,
): OfflineOriginalCancellationProof
```

Both require the caller's actual existing Database writer and an actual bounded raw recovery hold. They never begin, join, commit or release a transaction or hold. **The caller must propagate every error through the outer Database transaction.** Catching an error after partial writes and committing is outside this internal contract; root must keep its complete guard/provenance composition atomic. Database does not expose a general business savepoint facility, and this change does not add one.

Application checks process-issued comparator identity before traversing captured fields or invoking native hooks. Copied, JSON-rebuilt, forged, proxy and revoked-proxy captures refuse. Strict actor data descriptors and primitive identities are captured without invoking getters/coercion; nested supplied sites must also be inert dense data. Caller role/account/site claims are discarded. Two distinct freshly resolved native finance/admin staff principals in the same organization are required, with neither account scope nor forced password change. This verifies current native permissions for those locators, not possession of their login/session or a signed human approval; root supplies that independent authority.

The comparator is reconstructed only from the actual existing owners. It recaptures the complete unknown original in the same writer and rechecks the captured native/source/candidate projection, cancellation snapshot, immutable intent, source bytes, dates, money, realm, binding, historical permission sequence, exact request reference and every retained attempt/observation/reference. The complete fresh comparator result must equal the issued result. Matching hashes or copied assertions cannot replace this recapture. The reason is an exact nonempty, untrimmed, well-formed string, at most 2,000 UTF-8 bytes, without NUL.

Application refuses any retained descendant targeting the selected leaf, including otherwise unclassified cross-scope descendants, using an existence-only query after global owning preflight. The current source, policy, period and one-owner/date constraints remain those of the existing native projection. Historical permission changes invalidate old captures; permission replacement is never inferred or performed.

## Exact native transition

The method reuses the existing `observe` implementation and `originalCancellationSnapshot` / `originalCancellationEvidence` validators. It appends exactly these existing bodies, with consecutive native revisions and the native recorded timestamp/hash algorithm:

1. Evidence author's observation: `{ kind: "original-cancellation-evidence", input, snapshot }`, where input is the exact comparator attestation and snapshot is the actual native cancellation snapshot.
2. Different cancellation author's observation: `{ outcome: "cancelled-unposted", evidenceHash, reason, requestRef }`.

Each observation retains its existing `accounting.journal.observed` Platform audit through the actual `Platform.audit` owner API. No Platform table is queried or written directly, and no Platform command/event/cache receipt is fabricated. `Platform.command` is never invoked. Ordinary command exclusion and provider/recovery gates are unchanged.

A same-writer CAS then changes only `state` from `unknown` to `cancelled`, conditioned on organization/id/review hash and null external/lease fields. It preserves the ordinary `clear` field semantics: lease id/actor/time/mode and external id remain null; `dispatched`, immutable plan, approvals, cost packet, balances and permanent references/reservations remain unchanged. The two finance principals are refreshed after the evidence audit and again before returning, and the raw hold remains exact.

After writing, the complete bounded cancellation reader validates the exact outcome. Application independently constructs the only admitted before/after differences and compares the full returned facts: selected state plus exactly the two observations. Any other retained plan, policy, source, approval, history, reference, permission, other-date attempt or hold change causes refusal and must roll back with the enclosing transaction. This also detects apparently valid extra changes introduced by a failing/corrupt audit hook in the synthetic tests.

There is no replay inference. A second application call fails the unknown-only native recapture, including after a lost response. Root must retain the input/provenance and the returned exact hashes atomically, then invoke the fixed recovery reader.

## Complete retained cancellation reader

The public UNKNOWN reader retains its original fields, purpose, hash and refusal semantics. Its existing body now lives in one private fixed validator with only the target-state comparison parameterized as `unknown` or `cancelled`; public callers cannot select the profile. The new recovery reader removes the internal common digest/purpose and emits the distinct purpose `distributor-stock-journal-offline-original-cancellation-v1` with its own full canonical SHA-256.

The exported `OfflineOriginalCancellationProof` retains all current complete owner facts: raw hold, source packet/file and hashes, source reservations, current and historical policy rows, dates/totals, immutable plans, original lineage, every scoped attempt, raw and parsed observations, permanent references and historical permission reviews. It additionally contains the existing `originalCancelledProof` evidence, terminal observation, complete snapshot and retry predecessor stamp. Everything is detached and deeply frozen.

The reader requires **both exact supplied hashes** to equal the retained evidence and terminal cancellation. It does not return a newest-row guess or treat an absent receipt as permission to retry. It checks the complete history and final adjacent independently authored evidence/cancellation pair using existing native validators. Active leases, external posted identity, malformed/rehashed inconsistent history, missing/duplicate history, contradictory scope, orphan observations/references, competing date ownership or any descendant of the selected cancelled leaf conservatively refuse. A later legitimate retry is also outside this first read-back profile rather than silently ignored. One fresh current finance staff reader is required; historical authors remain historical identities and are not converted into current grants.

All SQL byte/type/count/JSON preflights from the original reader are shared intact, before materializing or parsing native text: 128 rows per fixed Integration table, 512 total rows, 2MB per field, 4MB per row and 8MB aggregate; fixed JSON punctuation/container complexity and separately bounded decoded embedded source. Application reserves two observation slots before writing. The final read-back rechecks the complete post-write bounds, including the added observations; a post-write limit failure must roll back. Final canonical proof including its hash is limited to 8MB. No pagination/truncation or foreign-table reader is introduced. Successful read-back leaves `total_changes()` unchanged.

Root provenance must distinguish this operation from ordinary native cancellation. The two native observations intentionally use ordinary formats and do **not** persist the comparator hash, source interval, candidate generation, approval signatures or root request identity. This reader proves the exact retained native outcome, not that it was made by a qualified offline coordinator. Audit/command provenance must be obtained separately through Platform-owned operations; native outcome hashes alone do not prove complete Platform history.

## Boundaries that remain explicit

- CA/CAD and US/USD are supported native fixture profiles. Actual CA/USD source creation still reaches the unchanged QuickBooks preparation refusal (`JOURNAL_SOURCE`); no fabricated journal bypasses it.
- The owner revalidates current native finance/password/organization scope and complete journal permission history. Actual current QuickBooks authority/provider-choice qualification remains a root prerequisite. The current native `OrganizationResidency.currentPermissionInTransaction` reaches `capturePermission` and `Platform.assertProviderAccess`, so it deliberately refuses under this hold. This code neither bypasses that gate nor relabels historical permission as current external authority. Root must supply independently qualified current authority and approved source/private bytes through COMMIT.
- Existing native source/policy constraints remain conservative: no accepted/superseded source, unsupported posted/running histories, closed/changed policy or extra descendant is silently reconciled. Changing source/end/candidate facts needs a separately qualified profile.
- Fresh actor locators and process-local capture identity are not independent approval signatures. Boolean final-cancellation assertions, prose, case references and self-hashes do not establish provider authenticity, exhaustive enumeration, external finality or prevention of later posting.
- Existing ordinary local evidence/cancellation behavior is preserved, including historical operations already permitted while isolated. Provider dispatch, claim and retry preparation remain blocked by the hold. No broader command denial or enablement is introduced.
- No new schema, durable root receipt, private-byte qualification, common approval/phase integration, actual commit fence, Application/HTTP/CLI route or transport binding is supplied. Product gates remain NOT VERIFIED.

At the final source layout, application starts at line 1380, recovery at 1526, the unchanged-purpose UNKNOWN entry at 938 and shared private validator at 947. Existing native observation helper starts at 2317, cancelled proof at 2648 and cancellation facts at 2891. These line references describe the delivered source, not the excluded baseline.

## Foreground evidence

Environment: Linux x64, Node `v24.19.0`, SQLite `3.53.3`, existing installed dependencies. No dependency/lockfile/configuration changes. Runtime source/test hashes below match the tested bytes committed in the delivery; the exact closing commit ID and all three final file identities are in the transfer manifest.

| Run                           | Actual result                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Initial TypeScript            | Exit 1; TS2551 on array descriptor `length` inference. Fixed the local descriptor type, without changing runtime checks or configuration. |
| Initial new native suite      | 36/36 pass, exit 0, 7,339.628714ms.                                                                                                       |
| Expanded ten-suite regression | 319/320 pass, exit 1, 16,909.771344ms. The deliberate orphan fixture hit SQLite FK enforcement before the intended reader assertion.      |
| Final ten-suite regression    | **320/320 pass**, including **44 new cases**, zero failures/cancellations/skips/todos, exit 0, **15,123.240108ms**.                       |
| Complete TypeScript           | Exit 0, empty error log.                                                                                                                  |

The original failed orphan-reader assertion remains unchanged. The fixture now creates damaged retained rows through a separate synthetic SQLite connection with FK enforcement disabled only on that connection, then exercises the actual native recovery reader and restores the fixture. Production FK/schema/validators were not weakened. Two additional SQL trigger fault fixtures deliberately abort the second observation or terminal state update; their triggers are removed in `finally`. They prove complete native observation/audit/state rollback on the real outer writer. No ordinary native prepare/approve/claim/cancel helper is bypassed to create the supported success cases.

Coverage includes actual independent cancellation ancestors, exact observation hashes/revisions/authors, permanent reference/source/balance conservation, native retry contract, fresh roles/active/org/account/password, process-issued capture/copy/proxy/getter/primitive limits, later observations/permissions, matching rehashed same-author rejection, global orphan/foreign rows, exact hash selection, per-field/aggregate/count/JSON preflight with zero Integration text materialization, read-only frozen proof, rollback and reopen. All previous comparator/projection/refusal tests remain unchanged.

```sh
node --import tsx --test tests/stock-journal-offline-original-application.test.ts tests/stock-journal-offline-original-evidence.test.ts tests/stock-journal-offline-original-review.test.ts tests/stock-journal-original-cancellation.test.ts tests/stock-journal-original-retry.test.ts tests/stock-journal-reconciliation.test.ts tests/stock-journal-permissions.test.ts tests/stock-journal-delivery.test.ts tests/stock-journal-preparation.test.ts tests/stock-journal-transport.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/prettier/bin/prettier.cjs --check src/server/stock-journal-delivery.ts tests/stock-journal-offline-original-application.test.ts docs/STOCK-JOURNAL-OFFLINE-ORIGINAL-APPLICATION-2026-10-03.md
git diff --cached --check
```

Final source SHA-256: `6ca10e64acafeb1ec556901a1919b07c2f344eaa94d4ebfc2636babb492d25aa`. Final test SHA-256: `fb10f91bfa4ac58ecfe102354f26fabb19350ce334f36b82ecdc5b431f2c990b`. Owned formatting, report-link resolution, whitespace and exact exclusive-path checks run before local commit; the manifest verifies committed bytes and the deterministic compressed-patch round trip.

Retained scratch receipts (not published runtime data): initial TypeScript SHA-256 `3e8cb13a9cc7b11ff2cd25e6cff40ba1ef7af6abb8d3ac0f5eb366a2cd819a36`; initial 36-test log `29b72ca748e871657570e49c8427dda44807fb06a827a23ad80cd0301da4e6b7`; 319/320 failure log `08124d42d1d6342a9babbb8568ab80f15ec7c5e001f2d20eefbdede48f420e0f`; final 320-test log `16c91061393c441a6e6a8f38b8010f05e300e7fbb4f4138aca4c3917fa840e66`; final empty TypeScript log `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

No full-product replay or provider qualification is claimed. No CI, workflow, runner, live data/provider IO, PR, push, merge, deployment, nested agent, background test, automation or reminder was started. Root retains integration, qualified composition, durable provenance, actual commit fencing, independent replay and publication.
