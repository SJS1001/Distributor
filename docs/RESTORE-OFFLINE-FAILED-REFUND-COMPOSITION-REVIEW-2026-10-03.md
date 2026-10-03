# Static first-failed-refund composition review — 2026-10-03

**Conclusion:** the static coordinator can be implemented, but cannot safely be
enabled by simply chaining the current prerequisites. The compared private
input cannot yet be joined completely to native command/history facts; the
Integration mutation/provenance operation and postcommit exact recovery APIs
are absent at this baseline. Independent current authority and commit-spanning
fencing remain deployment prerequisites, not facts established by the code.

Reviewed public `SJS1001/Distributor` commit
`072086fe84588f7a6b59aed23296ad22c9f9f4bb`, tree
`412d5ff5056254f11cd88552fb572e96f80185b4`, fetched through the existing HTTPS Git
remote and checked out in an isolated worktree. This report is the only change.
No private artifact, concurrent lane output or later revision was used. Read
AGENTS, README, PLAN, DECISIONS and current HANDOFF. The owner's current full-scope
continuation supersedes HANDOFF's historical batch-stop instruction; it does not
waive authority/qualification holds. No delegation was launched. Astra/high was
requested, but effective model/effort and launcher controls are unavailable;
the owner's macOS canonical-rule file is not present in this cloud filesystem.

This slice serves D-008 authority/account boundaries, D-010 atomic effect/replay,
D-024 refund uncertainty and D-039 isolated recovery. These IDs are tasks in
`docs/TASKS.md:23,25,54,89`, not decision-register entries. Accepted continuation
in `docs/DECISIONS.md:5` supplies direction, not real keys, provider truth or
passed gates. HANDOFF records 3,799 prior native passes; this read-only review
does not repeat or independently claim that result.

## Existing surfaces at the exact baseline

All source locations below are under `src/server/`; line numbers refer only to
the excluded baseline.

| Existing surface                                                                | What it actually provides / limit                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `restore-offline-commit-guard.ts:133,150` — `RestoreOfflineCommitGuard.execute` | Host absent means disabled. Captures one configured task/adapter/operation; wraps actual top-level `Database.transaction`. Requires one exact Platform task receipt, final phase successor, native generation/file and empty complete release history. Final `assertHeld` occurs before native COMMIT. Returns only envelope/result hashes and committed classification. No signature/IAM/evidence qualification or recovery dispatcher. |
| `database.ts:271` — `transaction`                                               | `BEGIN IMMEDIATE`, synchronous body, COMMIT, rollback on caught failure while still in a transaction. Initialization has a separate savepoint branch; guard refuses an existing writer before adapter entry. Do not wrap guard execution in another transaction.                                                                                                                                                                         |
| `restore-offline-native-phase.ts:67` — `reviewInTransaction`                    | Same writer; exact OPEN generation/session/revision/lineage and complete candidate logical hash; safe bigint file identity and Database pin. All retained native releases refuse, including terminal releases. Consistency only.                                                                                                                                                                                                         |
| `restore-offline-storage.ts:225,399,462`                                        | `readInTransaction`, explicit generation creation, exact CAS transition; bounded complete replay validates retained generations/journal/receipt provenance. Read returns the current state/head, not a public historical request lookup. No current external authority.                                                                                                                                                                  |
| `restore-offline-envelope.ts:208,413`; `restore-offline-approvals.ts:289`       | Strict detached envelope and binding; `verifyOfflineTaskApprovals` verifies two Ed25519 signatures over that binding using supplied roster/associations. It does not load current trust or read the clock.                                                                                                                                                                                                                               |
| `restore-offline-private-evidence.ts:179,286,326`                               | `readOfflinePrivateEvidence` returns an opaque handle. `complete()` performs final private identity/byte-set checks; `compareFailedRefund(reference)` consumes one captured canonical JSON input once, always disposes/zeros capture, and returns consistency facts. No byte getter, parser callback, second path read or evidence qualification.                                                                                        |
| `integration-offline-refund-evidence.ts:129,444,541`                            | Fixed comparator requires equal source/candidate native and empty-history structures, exact refund/payment/provider profile and request bodies. Result includes native tuple, provider binding, outcome and `inputHash`; it omits original request and compared history. Profile is **test/direct-account/failed-refund-v1**, not live Stripe.                                                                                           |
| `billing-refunds.ts:345,462,910` via `app.billing.refunds`                      | Complete bounded first-unknown review, then `applyOfflineFailedRefundInTransaction(actor, refundId, expectedFactsHash, failedTuple)`. Revalidates current finance identity and first unobserved unknown refund; produces rejected Billing state, sole applied observation/provider mapping and failed notice. Returns exact observation/notice identities. Requires caller's writer and propagation of every failure.                    |
| `integration.ts:209`; `integration-offline-refund-review.ts:112,260,732`        | Bounded owner review through `app.integration.reviewOfflineFailedRefundInTransaction`. Current native finance worker; account/direct-subject-linked facts, claims, callbacks and existing import rows. Explicit completeness blockers remain. No offline apply operation in this base.                                                                                                                                                   |
| `platform-offline-refund-review.ts:115`                                         | `app.platformOfflineRefundReview.getInTransaction(actor, refundId, effectId)` validates native original request/queue receipts and linked audit provenance. Current scoped finance authority. Returns complete bounded arrays, exact stored hashes/results and audits. It does not supply the original Billing request payload or the new offline task receipt.                                                                          |
| `integration-offline-refund-schema.ts:4`                                        | Schema 19 immutable `integration_offline_failed_refunds`: effect primary key, unique binding and `(org_id,request_id)`, bounded canonical-record storage plus hash, UPDATE/DELETE guards. Storage alone has no approved record schema or application/recovery operation.                                                                                                                                                                 |
| `restore-activation.ts:239,351,478,630,844,1051`; `platform.ts:148`             | Private current maintenance actor mapping/signature challenge for existing disposition targets; complete release history; ordinary-command/release exclusion from active maintenance. Cached command returns are gated too. Standalone external controls use native preflight/postflight so safety rollback can retain its history. These are not offline refund authority or grant APIs.                                                |
| `application.ts:105,130`                                                        | Composes actual Database/Platform/native phase and owner readers; exposes existing disposition configuration. Does not compose a failed-refund coordinator, commit guard, qualified refund host or exact recovery method.                                                                                                                                                                                                                |

## Blocking internal gaps and minimum changes

These are source-established composition gaps, not newly executed failing tests
or an assertion that existing prerequisite APIs violated their advertised scope.

1. **The private comparison loses the fields needed for the native join.**
   `OfflineFailedRefundComparison` omits `refundRequest.reason`, both original
   receipt identities/hashes/timestamps and the candidate poll retry tuple.
   `compareFailedRefund` only checks task family; it does not bind its result's
   `inputHash`, subject, organization or provider account to envelope claims.
   Root can enforce `task.payloadHash === comparison.inputHash` with that exact
   domain-separated hash convention, but cannot reconstruct omitted private
   fields from a digest. Add a narrowly fixed, bounded comparison projection
   containing the original request and candidate-history tuple, or a fixed
   same-read native-history comparison method accepting strictly captured data.
   Do not expose bytes, reopen the report, add a parser callback or guess the
   original reason. Extend the fixed parser/comparator contract, not a generic
   payload interpretation registry. Audits are absent from its input schema:
   native Platform validates their receipt links; if source audit identity is a
   required reconciliation claim, add a signed schema field and fixed comparison
   rather than pretending the current report attests it.
2. **Candidate history completeness is still unresolved.** Integration always
   reports `BILLING_COMPLETE_HISTORY_REQUIRED`,
   `PLATFORM_RECEIPT_HISTORY_REQUIRED`, and
   `INBOX_UNATTRIBUTED_HISTORY_UNAVAILABLE` (`:732`). The first two can be
   discharged by exact fresh owner joins; never clear them by string filtering.
   The last is not solved by those joins. `:384` reads inbox only for event IDs
   already associated with selected callbacks; absence of those callbacks is
   not evidence that no orphan/unattributed inbox fact exists. Add a bounded
   Integration-owned negative-history prerequisite. A conservative initial
   profile may refuse if any relevant unclassified Stripe inbox/callback fact
   cannot be ruled out; an organizationless inbox may require a wider negative
   scan and fail-closed refusal. Do not assign an orphan to a convenient tenant
   or substitute provider completeness for native absence. Coordinate this
   requirement with the separately assigned Integration owner; its delivery is
   not assumed here.
3. **No Integration offline application/provenance API yet.** Root needs a
   native same-writer operation validating exact first-unknown effect/poll/claim
   state, result/body/provider reference and immutable import record. It must
   neither call ordinary worker/provider paths nor write Billing tables. The
   table exists; its current reader only checks bounded canonical JSON/hash and
   row identities (`integration-offline-refund-review.ts:268`), not a versioned
   full import-receipt schema. Define that schema and cross-owner receipt
   bindings before persisting it. Review the other owner's actual proposed API
   before implementation; do not infer its order, result or coverage.
4. **Postcommit recovery cannot use first-application review.** Billing's
   bounded review explicitly requires `row.state === "unknown"` (`:462`), so
   it cannot reconstruct a successful rejected result. Its ordinary
   `history.page/observations` (`billing-refund-history.ts:30,58`) start their own
   transactions and page results; they are not complete same-writer recovery
   proofs. Integration's bounded reader exposes import rows but does not fully
   validate the proposed receipt semantics. Platform's original receipt reader
   knows only the original two commands. `offline.readInTransaction()` validates
   archived generations yet returns only the current generation's state; after
   rotation, it does not expose an old task receipt by key. Add fixed bounded
   Billing applied-result, Integration import-result and Platform historical
   task-receipt readers, with exact cross-bindings and no mutation. For the
   current generation only, existing storage history can locate a receipt
   without new SQL, but that is not a complete restoration/restart API.
   **Coordination received during review:** root is implementing
   `restore-offline-commit-recovery.ts` and dedicated tests as an actual
   Database/Platform, fresh-native-IAM, consistency-only exact receipt reader.
   These files are absent from this reviewed public base and were not inspected;
   they are not assigned here. Review that concrete delivery before adding
   overlapping lookup work. Its intended envelope/request/binding/session/
   generation and pinned-identity checks appropriately avoid the obsolete
   precommit logical hash/revision. Historical task-receipt consistency still
   does not validate the surviving Billing/Integration result or supply current
   external execution/release authority. Those separate joins remain necessary.
5. **Current authority composition is missing.** Supplied approval rosters and
   signed bytes are not current trust. Existing verifier permits preparer and
   executor to be the same person (`restore-offline-approvals.ts:305`); this
   assignment's required separation therefore needs an explicit stricter
   coordinator predicate on both IDs and independent person associations.
   Operations must differ from both, and finance/security from all duties and
   each other (IDs, people, keys as appropriate). Bind an independently current
   scoped executor association to native IAM, not `preparedBy` or any signed ID
   cast to an Actor. The private activation mapping only supports its existing
   disposition targets. Add a dedicated host-owned refund mapping and current
   trust/qualification loader contract; do not expose `nativeAuthority` as a
   generic bypass or use cross-organization ambient administrator rights.

## Minimal static host/type flow for root

Proposed names below are **new contracts**, not existing APIs or the Integration
lane's expected output. Install once in trusted Application composition, absent
by default; reject unknown configuration keys/proxies/accessors before any
reflection or callback access. Use independently configured candidate/evidence
roots, provider mapping and native principal, not operator paths as authority.

```text
FailedRefundInput = strict { envelope, financeApproval, securityApproval,
                            evidenceManifest, refundReference }
ConfiguredHost = fixed qualified commit adapter + fixed current trust/person/
                 executor mapping + fixed evidence/source qualification profile
applyFirstFailedRefund(input) -> bounded committed outcome
recoverFirstFailedRefund(exactRequest) -> scoped historical result only
```

There is one supported task literal:
`integration.stripe-refund-failed.import`, owner `integration`, version 1.
Define `task.subjectId = effectId`, `task.payloadHash = comparison.inputHash`,
and a versioned expected-state-hash commitment over the three pre-mutation
owner reviews; define the expected revision/claim convention explicitly. Do
not improvise those meanings from generic envelope field names. The first
profile requires no active poll/generic lease and no competing retained claim.

1. Strictly capture all operator data once with byte/count/depth limits, rejecting
   normal/revoked proxies before reflection and accessors without executing
   them. Verify basic current host read authority before opening private files.
   Parse the fixed envelope, task/version and two signatures; host-load current
   trust and independently anchored person/executor associations. Compare actual
   roster/association commitments under a defined registry-hash convention and
   exact authority/revision, not a guessed equality between unrelated digests.
   Enforce trusted nondecreasing clock and all expiries. No operator executable
   callback, roster, `allowed` flag or environment permission is accepted.
2. After qualified pre-read authorization, call `readOfflinePrivateEvidence`
   once with exactly the configured refund reference selected for bounded
   capture. Keep the opaque handle local and dispose in `finally`. Do not pass
   a caller-supplied lookalike handle. Existing limits include one selected
   refund input at most 64 KiB for the fixed parser; total/file/capture bounds
   remain unchanged. Expensive byte reads can precede the writer; `complete()`
   performs final pin checks inside the guarded operation before consumption.
3. Invoke a locally constructed, fixed `RestoreOfflineCommitGuard` with the
   same Application instances. Its trusted static closure captures only this
   detached attempt and opaque handle; it is not a caller callback port. The
   qualified adapter acquires current authority/revocation and both source and
   candidate interlocks for the exact envelope before calling into the guard,
   and keeps them through actual COMMIT. Two observations do not implement
   this. Host qualification must bind the evidence set/qualification hash,
   source interval, external instance anchor, test Stripe account and runtime
   binding; private byte identity proves none of that truth.
4. Inside the guard's writer, let its native phase review run first. Resolve
   current scoped finance executor through IAM; refresh signatures, duty
   associations, time and evidence qualification under the held authority.
   `complete()` must return the same envelope/set binding. Call the fixed
   `compareFailedRefund` exactly once; it consumes captured bytes. Enforce its
   new fixed native-history join and envelope/profile bindings before mutation.
5. Load all three native reviews in this writer. Join organization/region/
   currency/account, invoice/payment/refund intent and exact complete Integration
   effect/payload. Match empty subject Billing mappings/observations/proofs/
   notice lineage and relevant Integration claims/callback/accounting history;
   prove the missing inbox condition. Require exactly one Platform request and
   queue, their entire compared receipt tuples including original actor/key/
   time/hash/result, and actual audit linkage. Recompute request hash from the
   captured exact original request (including reason); queue hash uses exact
   `{refundId}`. Require first queue `pending`, not any state the general
   Platform reader can represent. Validate audit ordering/provenance rather
   than merely requiring nonempty arrays. Whole-review hashes bind all retained
   columns while the fixed projection maps only the comparator's declared
   fields; no lossy stringify of a convenient subset establishes completeness.
6. Complete every pre-mutation Integration prerequisite **before Billing changes
   unknown to rejected**. Capture fresh Billing `factsHash`. Call
   `billing.refunds.applyOfflineFailedRefundInTransaction` with the normalized
   failed tuple and qualified external reference. Then call the reviewed
   Integration writer to validate that exact Billing result, settle the native
   effect according to established semantics, finalize the permitted poll state
   and append immutable import provenance. A failed provider refund can mean a
   completed reconciliation effect with a failed outcome; do not guess that it
   means effect rejection. The Integration API must explicitly support this
   order: it cannot rerun Billing's first-unknown reader after the Billing write.
   If it requires that reader, split its native preflight from its application
   or let it coordinate Billing through the owning method, never foreign SQL.
7. Persist a versioned normalized result containing exact Billing observation/
   notice identities and Integration effect/import identity, plus envelope,
   comparison, before-state, source/qualification/authority commitments needed
   for recovery. Hash this defined result for one Platform `record-task`
   receipt. Use `platform.offline.transitionInTransaction` with the exact
   pre-operation generation/head CAS; preserve all histories and raw hold.
   Existing Platform ordinary `command` opens a transaction and is excluded
   during maintenance: it is not a shortcut for new audit/idempotency storage.
   If a separate common audit is mandatory, add a fixed same-writer Platform
   operation; the task journal alone must not be labelled an ordinary audit.
8. Before returning the static operation, revalidate current IAM/security,
   qualification and expiry under the same interlock; check exact owner result
   and preserved invariants. The guard checks one exact phase successor,
   complete native release history, pinned candidate/raw generation and final
   held authority. Propagate every error through `Database.transaction`:
   swallowing a late Billing/Integration/receipt error risks partial writes.
   Guard returns only hashes after COMMIT; dispose capture on every exit.

The native writer excludes competing database commits during this body.
Independent revocation/source failover requires external serialization, not a
SQLite lock or revision comparison. Keep the root's repaired activation
preflight/postflight behavior: do not hold a new writer across external control
I/O and block a safety rollback. The qualified offline adapter itself performs
no provider I/O and cannot mutate native state from its final `assertHeld`.

## Exact restart / lost-response recovery

Use a distinct read-only operation; do **not** call guard execution, Billing
application or `compareFailedRefund` again. Evidence consumption is single-use;
an already committed result is established by durable native provenance and
current read authority, not by reparsing the original report. No second private
file opening is necessary or desirable for that recovery path.

Root's newly assigned exact-receipt reader is the intended first seam for this
branch once reviewed and integrated. Its current native IAM check authorizes
the scoped native read; a historical consistency result must not be promoted
to an independently current external maintenance association, owner-result
proof or write permit. Keep those qualifications explicit in root composition.

Strictly bind request ID, task/org, generation/instance/session and original
envelope/payload binding. Under current scoped executor/read authorization and
the current raw-hold/release-history policy, load the exact immutable task
receipt and Integration import record, then validate the corresponding Billing
applied observation/provider mapping and notice lineage. Reconstruct the
versioned normalized result and compare `resultHash`. Later legitimate notice
acknowledgement must be represented as later history, not mistaken for an
unchanged revision-1 current notice or permission to rewrite it. Missing,
multiple, mismatched or orphaned records refuse; never select `MAX(id)` or the
newest row. Bound bytes/counts before materialization, including archived data.

Current authority is required for this historical disclosure; expired original
write signatures do not authorize another effect and need not be treated as a
reason to import again. A changed post-write candidate logical hash/session
revision is expected, so it must not be compared to the pre-write hash as new
write eligibility. A changed restore instance or retained release requires
its separately qualified historical-access procedure; absent that, refuse.
Copied receipt bytes do not establish that an instance is current. A receipt
missing from a restored older backup also does not prove no external/previous
commit happened: independent source/instance anchors decide, never auto-retry.

`committed-recovery-required` means SQL already committed despite adapter
cleanup/protocol failure. Preserve its exact key/hashes and recover; no new
request. A process crash/uncertain COMMIT error may return nothing. A genuine
precommit rollback leaves no partial owner result/task reservation; a later
authorized fresh attempt may acquire a new evidence handle, but that is not
postcommit recovery or reuse of a consumed handle/approval permit.

## Minimum adversarial acceptance for the composition

1. Private canonical input with plausible but substituted request reason,
   original actor/key/time, poll retry or receipt hash must fail the same-read
   native join before any owner write; a valid unrelated comparison/hash cannot
   substitute for the signed task/subject. Count evidence opens/consumption.
2. Same preparer/executor person under aliased IDs, finance/security key/person
   reuse, copied roster, current revocation, inactive/foreign/buyer/password-
   change-required native principal, expiry or clock rollback must fail closed.
3. Orphan inbox/callback, unlinked used provider reference, accounting descendant,
   nonempty claim and misleading coverage flags must not have blockers erased
   by supplying clean Billing/Platform summaries.
4. CA/US file-backed transactions: unknown-to-failed Billing plus exact Integration
   provenance and one Platform task receipt; correct money/capacity/notice
   conservation, no provider calls and retained recovery hold.
5. Fault after Billing, after Integration update, during provenance/audit/receipt,
   final IAM/qualification check and final guard check rolls back every owner.
   Ensure no caught exception permits outer COMMIT. Thenable/reentry/deferred
   callback abuse retains original guard assertions.
6. Separate connections/processes race identical and conflicting permanent keys,
   phase CAS, native revocation and release intent. Exactly one allowed commit;
   safety rollback history remains retainable. Synthetic revocation interlock
   ordering is engineering evidence only, not infrastructure qualification.
7. Replace candidate/evidence identity during preparation, change complete native
   facts before writer entry, rotate generation, append terminal release or
   mutate caller/proxy/accessor input; refuse without executing traps or writing.
8. Crash/lost response after actual COMMIT, postcommit adapter exception, restart,
   later notice updates and archived-generation lookup: reproduce the exact
   bounded result from durable records with **zero owner writes and zero evidence
   reopens**. Damaged/missing provenance, second binding and restored older backup
   must refuse rather than silently reimport.

## Accountable dependencies and exact wake inputs

| Owner                                                                      | Work / exact input that unblocks it                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root backend/composition                                                   | Implement fixed parser/native join and input/state/result schemas, stricter duty/current-IAM mapping, default-disabled static composition and bounded historical receipt readers; wake with reviewed Integration lane API and the above adversarial native receipts. No unspecified lane output is assumed.                                                                  |
| Integration owner                                                          | Reviewed same-writer preflight/application/provenance and unattributed-inbox handling contract, including supported Billing-first ordering and restart record shape. Wake root with exact commit, owned API signature, preserved failures and focused native results.                                                                                                        |
| Independent security/operations authority                                  | Authenticated current registry, revocation/person/native-executor associations, rollback-resistant clock/instance anchor, and a qualified local interlock that holds authority plus both fences through actual COMMIT, including stalls/expiry/failover. Wake with independently reviewed contract and failure/lease evidence; no synthetic `allowed` assertion substitutes. |
| Finance + independent security reviewers; provider/recovery evidence owner | Actual separated approvers and scoped keys; qualified complete source interval/all-organization context, Stripe test/direct-account mapping and failed-outcome evidence bound to the exact private set. Wake with authenticated qualification inputs and account/residency/source-fence evidence. No provider calls/accounts/secrets are provisioned by this report.         |
| QA/operators with root                                                     | Exact combined-build adversarial crash/restart/concurrency evidence and eventual accepted load/RPO/RTO rehearsal inputs. Existing passes do not complete D-008/D-010/D-024/D-039 or qualify live provider behavior.                                                                                                                                                          |

Validation for this assignment is source inspection, assigned-document formatting,
whitespace and exact one-file scope/digest checks. No production/test source was
edited, no tests or full suite rerun, and no runtime defect reproduction is
claimed. The report preserves historical guard documentation and assertions;
all actual authority and provider qualification holds remain in force.
