# Offline commit-spanning host guard — 2026-10-03

Excluded base: `2d1b7e140ef1002898b58a9e7c8ca5962d3a956a`, published in
`SJS1001/Distributor` on `codex/local-distributor-checkpoint`. This change adds
only `restore-offline-commit-guard.ts`, its dedicated tests and this document.
It does not change Database, Platform, schema, native phase, maintenance
authority, Application wiring or any existing assertion. Production integration
and all product gates remain **NOT VERIFIED**.

## Actual boundary and API

`new RestoreOfflineCommitGuard(database, platform, host?)` binds the actual
fixed instances from the same Application and captures the native
`Database.prototype.transaction` implementation. Without `host`, it is
disabled; there is no runtime switch, configuration setter, HTTP/CLI route or
environment variable. The constructor performs no SQL or external I/O.

`execute(envelopeInput: unknown): OfflineCommitOutcome` owns one synchronous
top-level native transaction. It cannot be called within an existing writer,
including Database schema initialization, which otherwise uses a savepoint.
The guard does not expose SQL, a transaction callback, a dynamic procedure name
or any reusable authorization object to its caller.

The host configuration is a strict descriptor-only object with exactly:

```ts
{
  adapter: { identity, hold(request, commit), assertHeld(request) },
  task: { owner, name, version },
  operation(envelope, nativePhaseReview)
}
```

The one operation is statically selected in trusted root composition. The
envelope must match that exact owner/name/version and configured adapter
identity. There is no generic owner registry or CRUD dispatch. Configuration
data and function references are captured once; subsequent replacement of the
caller's fields does not replace them. Proxies, accessors, unknown fields,
asynchronous functions and generator functions are refused. Functions must use
their trusted lexical state, not depend on the original configuration object's
mutable `this`. Function closures remain trusted executable code.

The strict existing envelope parser detaches and deeply freezes input before
adapter entry. The adapter receives a frozen `OfflineCommitRequest` containing
the fixed purpose `distributor-offline-commit-v1`, exact envelope binding hash
and parsed envelope. That full request binds source interval, candidate file
and logical identity, generation/instance, session lineage, trust revision,
operations observation, evidence and task claims. It is **requested scope**,
not proof those claims are true. The helper adds no operator callback or path.

## Qualified adapter contract: a held interlock, not two observations

`hold(request, commit): void` must independently acquire all of the following
for that exact request **before** invoking `commit()`:

- Current independently controlled external trust/authority and revocation
  serialization, including applicable expiry/clock rules.
- Qualified source fencing over the claimed source instance and interval.
- Qualified candidate fencing over the native host's exact candidate instance
  and file. An operator-supplied inode/hash is not the candidate registration.

The adapter invokes the callback exactly once, synchronously, with no arguments,
while holding all protections. They must remain held until the callback returns
**after the real SQLite COMMIT**. The callback returns no value or authority.
The adapter releases its protections only afterward, including safe cleanup on
failure. `assertHeld(request): void` must throw if any protection is lost or
unavailable and must guarantee that successful final checking cannot be
invalidated before the guarded callback returns. Both methods are bounded and
read-only with respect to the candidate and do not call providers or schedule
asynchronous completion work.

An implementable deployment needs an independently qualified local authority
interlock that serializes revocation and source/candidate ownership transfers
against this entire critical section. A revocation either wins before entry/
final authorization and causes rollback, or waits until commit completes; it
does not retroactively delete committed facts. The interlock must also account
for independent lease expiry, process stalls and failover. If expiry or lease
loss can occur independently while SQLite is committing, a JavaScript
precommit check cannot prevent that COMMIT. Such an adapter **cannot implement
this contract and must remain unconfigured** until an external mechanism makes
the guarantee real. No database hook or remote call is fabricated here.

Two reads, matching revisions, hashes, signatures, `enabled: true` or a boolean
response do not establish this linearization. No qualification flag is accepted.
Only trusted root composition may install an independently qualified adapter;
this module cannot certify its implementation or infrastructure. All adapters
in these tests are explicitly synthetic and are unsuitable for enabling actual
offline imports.

## Actual call order and atomic result

1. Refuse reentry on this Database, even through another guard instance. A
   nested attempt poisons the active attempt even if its exception is caught.
   Refuse missing host configuration and an existing native writer.
2. Strictly parse/detach the envelope; check the statically configured task and
   adapter identity; build the frozen exact request.
3. Enter host `hold`. Its single callback wraps the **entire** native
   `Database.transaction`, not just the transaction's body.
4. In that writer, call `assertHeld`, then the fixed native
   `RestoreOfflineNativePhase.reviewInTransaction`. Verify its envelope binding
   matches the guard request. Read the actual retained offline starting state.
5. Invoke the fixed synchronous root operation with the frozen envelope and
   consistency-only native review. Root must complete current signature,
   independent finance/security/operations, native IAM, evidence qualification,
   owner history/claim and payload checks before its first mutation. External
   signer IDs cannot be substituted for configured current native principals.
6. Root's operation must persist its own native result and exactly one matching
   Platform `record-task` receipt in this same transaction. The guard itself
   performs no writes. Its final read compares owner, organization, task,
   request, envelope binding, payload and before-candidate hash. It validates
   that the entire retained phase is precisely the one-step pure `record-task`
   successor and that the durable anchor increased once. Missing/wrong/extra
   receipts, phase draining/rotation and lineage changes refuse the transaction.
7. Read **complete** native release history again, including terminal records;
   any release still refuses. Capture the actual same-writer candidate again
   using Database's private opened-file pin. Raw hold, schema, region and
   organization bindings must remain exact. The post-operation logical hash is
   deliberately not compared with the pre-operation hash: the real receipt and
   owner writes necessarily change it.
8. Call `assertHeld` immediately before returning the transaction body. No more
   host calls occur between that return and native COMMIT. Database commits
   synchronously; only its successful return marks this attempt committed.
   The guard callback then returns, allowing host lease cleanup.

The result is detached and frozen, with exactly:

```text
version: 1
status: "committed" | "committed-recovery-required"
envelopeBinding: 64-character hash
resultHash: 64-character hash from the exact durable task receipt
```

It is a bounded transaction outcome, not proof of owner-result truth, authority,
evidence qualification or provider effects. Raw paths, IDs, reports, signatures
and errors are neither returned nor logged. Precommit failures use one fixed
redacted `RESTORE_OFFLINE_COMMIT_GUARD` error without chained private causes.

## Invocation abuse, postcommit errors and recovery

Adapter and operation functions must return exactly `undefined`; promises,
thenables, truthy flags and other values are rejected without reading `then`.
Zero callback calls, arguments, recursive calls, reentry and swallowed callback
errors fail closed. Precommit violations throw inside the native transaction,
which rolls back the actual journal, head, receipts and owner writes. A captured
callback invoked after its lifetime always refuses before opening a transaction.
It cannot become a permit during a later attempt.

There is an unavoidable distinction: a second callback, adapter exception or
invalid adapter return **after** the first callback committed cannot roll back
that commit. The guard returns `committed-recovery-required` with the same
bounded receipt hashes. It never reports a no-effect outcome in that case.
Callers must stop new mutation and recover the original immutable owner/task
receipt under current scoped history authority. A late callback after the guard
has already returned throws without effects; it cannot retroactively change
the previously returned outcome or launch another transaction.

A process crash or uncertain native COMMIT failure may prevent a result from
being returned at all. The fixed error intentionally does not promise absence
of effects. Recovery is an exact durable request/binding lookup and validation
of the surviving native owner result, never a blind retry/new request key.
This helper does not implement that read-only recovery dispatcher. Expired or
revoked authority cannot be reused for a second effect.

## Limits and root composition requirements

- Platform's private Database identity is not publicly exposed. Trusted root
  must pair instances from the same Application; native transaction checks
  still refuse ordinary mismatched connections. Deliberate trusted-process
  monkeypatching, independent cloned writers or arbitrary host JavaScript
  are outside this boundary's threat model.
- Rejecting a normal function's promise return cannot cancel arbitrary work
  that trusted code has already scheduled. The captured guard callback is
  closed immediately and a deferred invocation cannot write, but this is not
  a sandbox for arbitrary closures that already possess database access.
  Such adapters/operations are unsupported and must never be configured.
- The final `assertHeld` must be read-only. A trusted adapter that mutates the
  database after native checks violates the contract. Fencing and current
  authority must actually remain held through COMMIT, not be inferred from
  checks before and after it.
- Root must provide one native task operation, current scoped actor resolution,
  complete qualification checks, owner invariants, audit/result persistence
  and the exact Platform receipt in one writer. The guard checks receipt
  consistency; a synthetic receipt does not establish actual owner effects.
  Ordinary command/activation exclusion and independent connection fencing
  remain separate prerequisites owned by root and the other lanes.
- Native candidate capture, release/storage limits, pin behavior and schema
  profiles are unchanged. This code adds no schema, generic SQL route,
  provider transport, task approval or Application runtime enablement.

## Verification

Node `v24.19.0`, native SQLite, synthetic CA/US file-backed Application fixtures
with both event-report modes. Existing locked dependencies were reused after
the exact lockfiles matched; no installation/configuration change was needed.
The requested Astra/high model setting is not exposed by this launcher and
remains unverified. The canonical rule at the owner's local macOS path is not
available in this cloud filesystem; no nested delegation was launched.

The first run is preserved privately: 42/46 passed and four failed because the
new test called nonexistent `recoveryStatus()` rather than existing
`recoveryHold()`. The first TypeScript check reported the same fixture error.
The corrected suite, plus two new lifetime/initialization cases, passed 48/48;
two further native terminal-release cases are included in the final combined
receipt. Existing tests and assertions were not modified.

Final foreground regression: **228/228 passed**, including all **50** new guard
tests, with zero failures, cancellations, skips or todos (24,944.225077 ms).
Full `npm run typecheck` passed. The regression includes the guard, native phase,
strict envelope, pure phase, storage and storage boundary, native history
boundary, candidate snapshot and signed approval suites at this exact base.

The tests demonstrate native receipt visibility through a separate SQLite
connection while the synthetic authority/source/candidate interlock is still
held, deferred revocation ordering, exact rollback and conservation on all
precommit refusals, restart and postcommit receipt recovery, malformed data and
callback protocols, stale phase and changed candidate/file identity. Test-only
owner-scoped SQL creates historical/corruption fixtures; there is no production
SQL escape hatch. The deferred-callback test awaits completion in the foreground.

The delivery receipt records exact final commands, outcomes and private log
hashes for focused tests, full TypeScript, assigned-file Prettier and whitespace
checks. No provider/infrastructure qualification, full product/browser gate,
CI job, push, merge, deployment or Application enablement is claimed.
