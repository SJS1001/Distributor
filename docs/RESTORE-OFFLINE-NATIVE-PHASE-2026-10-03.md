# Native offline phase consistency prerequisite — 2026-10-03

Implemented against excluded baseline `48f94e6ff1b31d02a5ed74483eb11df2c36859e7`
in `SJS1001/Distributor`, using a separate local worktree. This change contains
only the new native phase module, its tests, and this document. Existing schema
18, Database, Platform, activation, Application composition, and historical
assertions are unchanged. Product gates remain **NOT VERIFIED**.

## Actual API and trusted composition

`new RestoreOfflineNativePhase(database, platform)` takes the actual fixed
`Database` and `Platform` instances from the same `Application`. It rejects
proxies, structural substitutes and subclasses, retains these references and
the Database's path, and performs no initialization or I/O in its constructor.
Trusted composition must pair the instances correctly: the public Platform API
does not expose its private Database identity for an independent equality
check. Ordinary mismatched connections fail their native transaction checks;
this module does not claim to defend against trusted process code replacing
methods or deliberately composing separately transacting cloned applications.
No pairing port, callback, operator path or caller-provided history is accepted.

`reviewInTransaction(envelopeInput: unknown): OfflineNativePhaseReview` is
synchronous. Its caller must already hold the native writer transaction. It
does not start a transaction, open a connection, execute SQL directly, initialize
offline state, record a task, or dispatch an owner mutation. Actual call order:

1. Require `database.requireTransaction()`. Missing transactions and foreign
   owner scopes retain the native `TRANSACTION` refusal.
2. Parse and detach the complete input with `parseOfflineTaskEnvelope`, using
   its existing default strict policy. No release dossier or envelope rules are
   relaxed.
3. Require the captured Database path to be absolute and unchanged. Read its
   regular-file identity with bigint `lstatSync`; reject negative or unsafe
   `dev`/`ino` values before number conversion, then compare the envelope's exact
   identity. Establish an outer `pinRestoreCandidateFiles` check.
4. Load `platform.offline.readInTransaction()` and the **complete**
   `platform.restore.offlineReleaseHistoryInTransaction()`. Require an existing
   durable state, empty stored and actual release histories, and the native
   `no-recorded-release` classification with zero releases.
5. Require the latest retained session to be `open`, with the envelope's exact
   session ID, revision and lineage hash. Compare the entire parsed recovery
   binding to the retained generation and require the current schema version.
6. Capture `database.captureRestoreCandidateInTransaction()`. Compare all its
   raw hold bindings (snapshot hash, source cutoff, restored date, schema hash,
   region and exact organization/currency set) to the generation, and compare
   the envelope's logical hash to the complete native candidate hash. The
   independent instance ID must match the retained generation; local equality
   does not authenticate an external instance anchor.
7. Read complete native release history and durable offline state again and
   require exact canonical equality to their earlier captures. Recheck the
   Database path and the outer pinned file/sidecar identities through final
   completion. Only then construct the detached, deeply frozen result.

Every parse, filesystem, retained state, release history or candidate failure
inside the review is replaced with the fixed `RESTORE_OFFLINE_NATIVE_PHASE`
error and message, without chaining private errors. Paths, raw rows and
envelope contents are not returned or logged.

## Conservative release and filesystem boundaries

Any retained release requires a separately qualified recovery procedure that
this module does not supply. Prepared releases are blocked before control
intent; fencing, held, superseded and rolled-back releases remain blocked.
Neither a terminal state nor `current() === null` retires their history. The
module never calls `current()`. The explicit native history check is necessary
because the existing candidate logical hash excludes release records.

The Database supplies the only path and independently checks against its
private opened-file identity during its existing candidate capture. The outer
pin extends checks across the native reads before and after that capture. It
uses the existing main/WAL/SHM/journal pin semantics, including the existing
SHM read-mark exception; it does not replace or weaken native pinning. Memory,
uninitialized, relative-path, missing, replaced, symlinked or unrepresentable
file identities cannot produce a consistency result. There is no new path
traversal or reopen-to-parse evidence interface.

Filesystem calls are a fixed synchronous sequence. Native retained history
and offline replay retain their existing byte/row limits; complete candidate
capture retains its existing streaming and schema inclusion rules. This change
does not introduce or claim a new overall candidate-size/time budget, a
filesystem snapshot lock, private evidence qualification, or infrastructure
fencing. External activity outside these pinned observations is not proven
absent. Trusted configuration and a qualified source/candidate fence remain
mandatory before an eventual mutation.

## Result means consistency only

The result has exactly these fields:

```text
version: 1
status: "native-phase-consistency-only"
envelopeBinding: parsed envelope binding hash
candidateHash: complete native candidate logical hash
storage: { revision, generationHash, stateHash, journalHash }
session: { revision, lineageHash }
requiredChecks: immutable list of unresolved coordinator checks
```

It contains no path, file identity, raw recovery/session/organization IDs,
task name, evidence reference, report, signature, credential or authority flag.
Strings and scalar hashes are detached; nested objects and the check list are
frozen. It is an observation within this writer scope, not a persisted permit
and not reusable authorization after that scope ends.

The following remain mandatory future coordinator work:

- Current signatures, clock validity, trust and revocation checks.
- Current scoped native IAM, including deliberately configured native actors;
  signed external identities do not create native principals.
- Independent external authority, instance anchors and separation of duties.
- Qualified source and candidate fencing and isolated reconciliation.
- Qualified evidence and provider truth, including unknown external outcomes.
- Static owner/task payload and claim validation and exact native writer
  integration. Structurally parsed generic task names grant no task authority.

No clock is read here. Tests deliberately use structurally valid historical
envelope windows and an unregistered task name to demonstrate that returning
consistency neither validates freshness nor broadens authority. No provider is
called, recovery hold released, approval granted or mutation dispatched. Root
must supply and verify the default-disabled qualified coordinator and actual
Application integration separately.

## Verification receipt and limits

Runtime: Node `v24.19.0`, native SQLite in the managed Linux coding environment.
The worktree reused the existing locked dependency installation after matching
lockfiles; no dependency or configuration changes were made. Astra/high was
requested, but this launcher exposes neither control nor effective runtime
model/effort, so those settings are **unverified**. The owner's local canonical
delegation-rule path is unavailable in this cloud filesystem; no nested
delegation was used.

The new suite has **42 passing tests** using actual Application, Database and
Platform fixtures, synthetic CA/US organizations, both event-report modes and
private temporary SQLite files. It covers restart and a second connection,
missing/non-open state, stale revisions and lineage, generation replay and raw
hold changes, organization/schema/candidate/file mismatches, full native
terminal release retention, late history/session changes, corrupted retained
history, unsafe bigint identities, proxy/accessor refusal and caller mutation.
Controlled synchronous capture hooks test interruption boundaries; they are
test-only modifications of real instances, not injected production ports.

Success and refusal paths check exact logical table fingerprints and native
`total_changes()` conservation. Deliberate fixture writes are distinguished
from review writes and rolled back where applicable. SQLite read-side shared
memory bookkeeping is not represented as a logical data write. Real rename/
replacement tests restore their files in cleanup. No live data, provider or
external service is involved.

Passed foreground commands:

```sh
node --import tsx --test tests/restore-offline-native-phase.test.ts tests/restore-offline-envelope.test.ts tests/restore-offline-phase.test.ts tests/restore-offline-storage.test.ts tests/restore-offline-storage-boundary.test.ts tests/restore-offline-native-history-boundary.test.ts tests/restore-candidate-snapshot.test.ts
# 157/157 pass; zero failures, cancellations, skips or todos
npm run typecheck
# exit 0
```

Assigned-file Prettier and whitespace checks accompany the delivery receipt.
The first authored suite run was preserved: 33 passed and six failed because
the new fixture incorrectly read `.id` from an already-string warehouse ID;
the initial TypeScript check identified the same fixture mistake. Correcting
that fixture yielded 39/39, then three additional adversarial cases yielded
42/42 within the final 157-test run. These were test-authoring failures, not a
baseline production defect or weakened assertion. Logs remain private outside
tracked source. No full product, browser, infrastructure or provider gate was
run or claimed. No CI, publication or deployment was performed.

## Subsequent root Application composition

Root composes `Application.restoreOfflineNativePhase` from the actual Database and Platform pair. The primary fixture uses this property. [The separate local receipt](evidence/LOCAL-OFFLINE-NATIVE-PHASE-COMPOSITION-2026-10-03.md) records the exact increment, 157 current focused passes and unresolved qualification. Original cloud scope, failures and environmental limits above remain historical evidence. No authority or mutation permit is established.
