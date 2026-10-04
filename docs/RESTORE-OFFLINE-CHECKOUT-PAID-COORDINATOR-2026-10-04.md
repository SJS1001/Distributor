# Signed fixed paid-checkout coordinator

## Baseline and scope

Assigned excluded public base: `120f92cfaa47d9812d35fc5776fa9dcbd2d4747d` on
`SJS1001/Distributor` / `codex/local-distributor-checkpoint`. Only this report,
`src/server/restore-offline-checkout-paid-coordinator.ts` and
`tests/restore-offline-checkout-paid-coordinator.test.ts` belong to this delta.
No Application route/default host, schema, shared parser, paid task owner,
private reader or provider adapter is changed. Requested Astra/high; effective
model/effort are not exposed and remain unverified. Shared root phase prerequisites
were subsequently advanced read-only to published
`b332eca786107022f22af21fd4ddfb99e3a71c6e`; those parents and changed shared
paths are excluded from this three-file delta. No additional executor or
nested delegate was started.

The actual paid owner was retrieved read-only from the authorized Billing
thread and all four encoded/decoded chunk hashes, gzip/raw patch, three final
file hashes and unchanged schema were verified before applying. It is retained
as a separate excluded prerequisite commit
`5a549b417bf7af14bab26f4e79d71ea502d8645c`, parent `b332eca`. Its source
SHA-256 is `cf73b9ad3dc5e5d2246962be3a2105cf1f0c9260b3c8c86252fbda7048b4e404`.
Donor tested `ffdf59435341a8d68963b3092e4bca4b9d0c730f`, closing
`eeea0241079175bd54bb1faa3bc9522987ad50b8`. No donor parent or owner file is
included in this coordinator transfer.

## Exact static composition

`RestoreOfflineCheckoutPaidCoordinator(database, identity, platform, billing,
checkouts, host?)` requires the real same-application native graph. An omitted
host is disabled. Actual instance links/stores and complete callable helper
prototype descriptors are checked before any host callbacks and around every
callback, application and recovery boundary. This includes Platform offline
storage, RestoreActivation, private capture, both native/reference joins, native
readers, commit guard/recovery and the fixed paid owner. The host is a trusted
static object, not an envelope port, task registry or environment flag.

`execute(preparer, executor, envelope, approvals, manifest)` owns the actual
outer native transaction through `RestoreOfflineCommitGuard`. Callers cannot
supply a captured comparison or operation. Both locators, envelope, approvals
and manifest are copied with bounded data-only descriptor traversal before host
hooks. Proxies, revoked proxies, accessors and asynchronous/thenable payloads
are refused without executing their traps. Distinct current finance principals,
current password policy, organization scope and raw recovery hold are checked
around qualification callbacks. Host callback writes incrementing native
`total_changes()` refuse and roll back the outer writer, even for logically
identical SQL updates.

The fixed host `OfflineCheckoutPaidHost` contains `adapter` and synchronous
`readCurrent(request)`. Its qualification purpose is
`distributor-offline-current-checkout-paid-qualification-v1`. Complete current
roster/revocation and independent preparer/executor/operations associations bind
separate finance/security signatures. Clock values must be canonical, monotonic
and inside the signed lifetime. Qualified evidence binds the exact signed set,
qualification and **raw payload** hashes, enhanced reference-join hash, actual
comparison hash, subject and Stripe test account/runtime binding. Comparator
`inputHash` is a distinct domain and cannot replace the raw payload digest.

Within the same guarded writer, the coordinator opens one fixed private reader,
completes its pinned lifecycle and consumes its application handle once. It
checks real WeakSet brands and all exact capture bindings, qualifies the newly
captured comparison, recaptures the enhanced reference join with the actual
executor, checks current independent principals, then calls exactly
`IntegrationOfflineCheckoutPaid.applyInTransaction(executor, preparer,
envelope, capture)`. No evidence pathname is reopened for parsing or recovery.
The reader's cleanup erases/disposes the raw captured allocation on success or
refusal; the coordinator disposes the handle in `finally` too.

The applied response has the fixed owner contract: version/status,
org/account/invoice/effect/payment identities, payment/session references,
amount/lowercase `cad|usd` currency, binding, referenceJoinHash, captureHash and resultHash. The
coordinator validates the complete bounded response against the actual capture,
then independently uses the owner's retained recovery and the complete native
Platform receipt reader. Matching a returned hash alone is insufficient. The
shared guard verifies exactly one retained record-task transition, the signed
candidate generation and current empty release history before COMMIT. No
foreign-table reads/writes or caller SQL are added.

Qualified checks repeat after tentative owner writes and immediately before
COMMIT through the shared guard. Same-Database reentry poisons an attempt even
when an early nested refusal is swallowed. A post-COMMIT exception or callback
misuse produces `committed-recovery-required`; it must never be described as a
rollback or justify retrying the owner.

`recoverRetainedInTransaction(executor, preparer, envelope)` requires the
caller's actual writer and fresh native principals/hold, reads exact original
owner provenance and the independently checked Platform receipt, and conserves
`total_changes()`. It makes **zero host qualification calls**, needs no private
file and never reapplies the owner. It returns historical native consistency,
not renewed execution authority. It does not reuse the obsolete pre-write
candidate logical hash as current state after commit.

## Qualification remains external

The host must independently serialize current authority/revocation and both
source/candidate fences through actual COMMIT return, including signed lifetime
and provider/source/evidence qualification. Two reads, unchanged hashes,
self-attested booleans, sampled clocks or a lease that might expire during
commit cannot implement this guarantee. These tests' synthetic held-host
fixtures are not qualified infrastructure. The boundary is not a sandbox against
arbitrary privileged host code that can mutate SQLite or the JS runtime outside
the guarded transaction. Host code must not write, retain/invoke callbacks later,
perform provider transport or return asynchronous work. Defaults remain closed;
no product gate, live import, release or provider truth is claimed.

## Verification receipt

Initial direct test failed
before any testcase because the assigned baseline lacks
`src/server/integration-offline-checkout-paid.ts` (`ERR_MODULE_NOT_FOUND`).
Initial full TypeScript reported only that missing module in the two new source
and test imports. These failures remain in private audit logs, not erased or
relabelled as successful scaffolding. The coordinator uses the actual fixed
static import; no stub owner or generic injected operation substitutes for it.

The first actual-owner coordinator run retained 31/70 passes and 39 failures
(116830.094595 ms, exit 1). Reading the actual owner exposed an executor-bound
reference/capture contract; the draft and signing fixture had used the
preparer. The coordinator now captures and freshly joins as the executor while
separately requiring the preparer and distinct current finance duties. No
assertion or owner requirement was relaxed. Initial owner TypeScript also
identified three nullable receipt accesses; explicit receipt presence guards
fixed them.

The second run retained 68/70 passes and two fixture failures (118087.270811 ms,
exit 1): the restart helper copied the original fixture object, leaving teardown
pointed at a closed app; a revocation query used nonexistent `roles` instead of
actual `role`. The fixture now preserves its original identity across reopen
and performs actual `role='support'` revocation, including the late rollback
case. Prior logs remain untouched.

Initial coordinator source/test commit: `03031f6b8c6c41b8c6f46d4e10b3394ea861ebe7`.
The closing commit adds only this report. Linux x64, Node `v24.19.0`, embedded
SQLite `3.53.3`, existing locked dependencies reused without installation or
manifest changes. No full all-repository suite was run in this assignment.

The corrected focused command:

```sh
node --import tsx --test --test-name-pattern='restart recovery|role|retained recovery requires|retained recovery checks|signed private paid checkout' tests/restore-offline-checkout-paid-coordinator.test.ts
```

passed **11/11**, exit 0, 25411.368808 ms. This includes all six profiles,
actual role loss, exact original-envelope/principal ordering, and real reopen
with zero recovery host calls. `coordinator-fixture-fixes.log` SHA-256:
`784cd68dc3719148a90c6467e45536468aa8ed577169e41ae5008446f80e9ee1`.

The final committed affected command:

```sh
node --import tsx --test --test-concurrency=2 tests/restore-offline-checkout-paid-coordinator.test.ts tests/integration-offline-checkout-paid.test.ts tests/restore-offline-checkout-private-evidence.test.ts tests/restore-offline-checkout-reference-join.test.ts tests/restore-offline-native-phase.test.ts tests/restore-offline-commit-guard.test.ts tests/restore-offline-commit-recovery.test.ts tests/restore-offline-approvals.test.ts
```

passed **405/405**, including all **72 new coordinator cases**, zero failures,
skips, cancellations or todo; exit 0, 153353.017899 ms.
`affected-committed.log` SHA-256:
`5b2056d0ed894e6d423db97b985637370bf31fd516c404d48f5c4bb9b04fae8e`.
The six success fixtures also verify through an independent SQLite connection
that the committed owner provenance is visible while the synthetic host still
holds its lease, after the native writer has ended; exactly one Platform task
receipt matches the result. This is a synthetic interlock test, not independent
infrastructure qualification.

```sh
npm run typecheck
./node_modules/.bin/prettier --check src/server/restore-offline-checkout-paid-coordinator.ts tests/restore-offline-checkout-paid-coordinator.test.ts docs/RESTORE-OFFLINE-CHECKOUT-PAID-COORDINATOR-2026-10-04.md
git diff --check
```

Full TypeScript, all three owned-file formatting checks, and whitespace checks
exit 0. Native/owner source and shared schema hashes are unchanged from the
verified imported prerequisite. Tests preserve exact refusal assertions;
post-COMMIT errors recover the existing result without a second owning write.

Private logs and transfer artifacts remain at
`/workspace/distributor-checkout-paid-coordinator-audit`. Retained red receipts:

| Log                         | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `initial-missing-owner.log` | `939f6ba077bac1a67b20aac4954d7cef0f0b3eda876dcd920af3a7282150ff28` |
| `typecheck-initial.log`     | `1d67c936cd1dd7dd999662f3b45b11579920e80ed46417011f3e03a59c9dc10d` |
| `coordinator-initial.log`   | `f377de9904be1569e12719c5d745098955af3f03702e92974e342d3ba81cd2e1` |
| `typecheck-owner.log`       | `f49d0518b52ff97bf45aa08dba9089ef13142bced073ca742cfaef246d8763ce` |
| `coordinator-second.log`    | `2247c3102c39639077ead770f9c6e2b297925b5680ebac1774dc8b8151e78aa9` |

The final manifest identifies assigned base, public prerequisite, excluded
combined prerequisite, tested/closing commits, exact three-file identities, raw
patch/gzip hashes, and each independent encoded/decoded chunk. All chunks are
returned in full. There is no remote push, PR, merge, CI/runner, provider IO,
account/settings change, deployment, background routine or reminder.

## Published owner repair and final replay

The root's published paid-owner callback repair was incorporated from exact
`c42967824f730fa19231b9085cf7dbf3fb9fd85f`, changing only the excluded
`src/server/integration-offline-checkout-paid.ts` prerequisite. Its final
SHA-256 is `eff4fc12cedd106e76579931df5c41c6032d0c097e5c776d432e5ef28f2706ed`.
It adds the module-bound strict phase call and current graph/principal checks
after candidate filesystem callbacks, including retained owner recovery. No
coordinator source/test change was necessary. This prerequisite is committed
separately as `020cce0a9f97b3fd33b1e921d14d79becde7e2d1`, which is the **final
tested combined code SHA**. The closing commit updates only this report.

The same eight-suite affected command above was repeated against that exact
combined code: **405/405**, including all **72 coordinator cases**, no failures,
skips, cancellations or todo, exit 0, **169207.298472 ms**. Full TypeScript again
exited 0 (`typecheck-repaired-owner.log`). Assigned formatting and whitespace
checks exit 0. `affected-repaired-owner.log` SHA-256:
`bd70bcccb2ac24ea7347c17a579bae6356bbbd7cfcda7a26b9327f10798e7dba`.

Root retains responsibility for the separate strict shared receipt-reader entry
`getCapturedCheckoutInTransaction` and its eventual wiring. This coordinator
pins the complete helper graph before and after calls; it currently uses the
existing bounded native `getInTransaction` receipt API. A check after return
cannot replace a guard inside a shared method that must refuse an injected
filesystem callback before its hook runs. These synthetic checks do not claim
that separate shared repair or independent infrastructure qualification is
complete. No default host/Application route is installed, and no product gate
is marked verified.


## Root integration follow-up

Root imported only the final three coordinator paths after verifying raw patch SHA-256 `29130acd85f28f37e4789623cafb313fefaca9ec921bdd3ea509984aaa41002a`, deterministic gzip and chunk hashes, exact allowed paths and final file bytes. The older mismatched chunk transfer was rejected before applying. The local prerequisite is published `43ee855a72e00226ee9c3ff49ac25ee1792dfe1d`, including the fixed strict shared recovery entry and post-phase Billing helper refresh.

Actual coordinator receipt-reader filesystem regression tests reproduced four early callback gaps out of eight cases against the imported source. Persistent substituted offline-storage methods ran before refusal; self-removing hooks escaped refusal. Both the application validation and retained recovery receipt reads now bind `getCapturedCheckoutInTransaction` at module load. Eight early/final persistent/self-removing filesystem tests require zero substituted method calls and unchanged native rows; two additional strict-method substitution cases refuse before their hook. The original failed logs and fixture status correction are retained privately. Root local coordinator/paid-owner/shared-recovery/private-capture/phase/restore-activation replay passes417/417 with zero failed/cancelled/skipped/todo in48639.99225ms, exit0. Complete TypeScript, runtime formatting and plan checks pass. Independent review and full frozen replay remain pending; the cloud 405-pass result remains its own versioned receipt. No default host, route or external qualification is added.


## Root independent coordinator review repairs

Independent exact-version review at `182f35428324d98c0441e1222af6691cbfa2e095` found two gaps: the commit guard used the legacy phase reader, and constructor owner descriptors were inspected before proxy rejection. Root reproduced four early/final persistent/self-removing commit-phase filesystem failures and two Billing documents/delivery proxy trap failures. The constructor now validates each nested actual owner before reflection. A fixed `executeCapturedCheckout` entry binds the strict captured phase review at module load, restricts the exact Integration paid-checkout task and shares the existing guard transaction/reentry logic. The coordinator binds this entry too; generic legacy guard behavior remains available.

The refined filesystem locator captures full stack depth and excludes private/paid-owner phase calls. Controlled legacy-phase replay fails0/4 and restores source byte-exactly; repaired focused checks pass8/8, including two new strict-guard method replacement cases. A separate wrong-task check refuses before host hold. Actual affected coordinator/paid/recovery/commit-guard/private/phase/activation replay passes478/478, zero failed/cancelled/skipped/todo in46809.602833ms, exit0. Complete TypeScript, runtime formatting, plan and whitespace checks pass. Initial task-name and test readonly-assignment mistakes and their failed logs are retained privately; they are not successful repair evidence. Full frozen replay and independent closure review remain pending.
