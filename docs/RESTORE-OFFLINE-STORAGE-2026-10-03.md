# Durable offline storage prerequisite — 2026-10-03

Baseline: `d6f8818a34626caf164769d196ecd9b27abb5799`, SJS1001/Distributor,
`codex/local-distributor-checkpoint`. This change implements Platform-owned storage
and schema 18 only. It does not implement the qualified offline coordinator,
owner imports, isolation, fencing, current IAM/external authority, approval
verification, source completeness, or provider access. Product gates remain NOT
VERIFIED. Requested Astra/High; effective model/reasoning is not runtime-exposed.

## Native API and ordering

`Platform.offline` is a `RestoreOfflineStorage`. Its constructor creates table
and trigger definitions only. It never creates a generation/session or backfills
an authority assertion. Every method below first requires
`Database.requireTransaction()`: the caller must already be in the native
`Database.transaction` writer scope, outside another owner's execution scope.
There is no HTTP/CLI dispatch, arbitrary SQL argument, executable payload,
callback, operator proof boolean, or trust-roster argument.

1. `readInTransaction(): OfflineStorageSnapshot | null` verifies and replays all
   retained journal rows, generation records and task reservations, then compares
   the exact head. `null` means all four tables have no retained state. A snapshot
   has `{status: "retained-offline-state", anchor, state}`. It is detached and
   frozen. Reading historical state does **not** assert its generation is current.
2. `createGenerationInTransaction(generationInput, expectedHead,
retainedReleases): OfflineStorageSnapshot` explicitly starts a generation.
   `expectedHead` must be `null` for empty storage or the exact current anchor.
   The trusted native caller must mint a fresh independent 64-hex instance ID and
   supply the strict pure-phase generation. A fixed same-writer candidate capture
   compares its raw hold snapshot, restoration/source dates, exact schema
   version/hash, region and organization/currency set. Reusing an instance ID is
   refused. Later creation additionally requires a changed raw hold tuple; merely
   choosing another ID cannot discard an existing generation. Prior generations,
   sessions and receipts remain in the journal. Retained release prefixes cannot
   disappear, regress, change binding, or lose a forward-recovery marker.
3. `transitionInTransaction(generationInput, expectedHead, transitionInput,
observedReleases): OfflineStorageSnapshot` requires both the exact retained
   generation and its current native binding, verifies the exact anchor, runs the
   existing strict pure-phase evaluator, and appends the detached proposal.
   Supported task-shaped transitions are `isolate(sessionId)`, `open`,
   `record-task(receipt)`, `drain`, `close`, and `invalidate(reason)`, using the
   exact object shapes in `restore-offline-phase.ts`. No new transition semantics
   or qualification is added. Normal/revoked proxies, accessors, unknown fields
   and malformed nested data are refused by the strict parsers without invoking
   input traps.

An anchor is exactly `{instanceId, revision, stateHash, journalHash}`. Revision is
positive, safe and contiguous across **all** generations; every transition is a
hash/revision compare-and-swap against the entire anchor. The journal links each
record to the previous journal hash and resulting pure state hash. Pure session
revision/lineage and receipt fingerprints retain their existing semantics.
`record-task` also reserves `(owner, orgId, taskName, requestId)` and `binding`
globally across every retained session/generation. Reservation records bind the
exact session, journal revision, complete receipt and its hash. They are
provenance, not permission or proof that an owner mutation happened.

The future coordinator must, within the **same writer transaction**, qualify the
current generation/isolation, independently qualified source fence, exact native
IAM actor, separate current finance/security/operations duties, revocation and
freshness, current native release history, task evidence, and owner-specific
binding. It must call only the exact native owning-module operation and append
its resulting receipt atomically with that operation. Signer IDs and
`RestoreDossier.preparedBy` do not identify native IAM actors. No signature can be
converted into an ambient cross-organization administrator. Any error must escape
that outer `Database.transaction` so all native writes roll back; these low-level
methods do not open nested transactions or poison an outer transaction whose
caller deliberately catches an error and then commits.

The root's later `RestoreActivation.offlineReleaseHistoryInTransaction()`
projection is not part of this baseline/delta and is not wired here. Supplied
release histories receive pure validation and retained-prefix checks only;
storage cannot infer that an omitted, never-observed release does not exist.
The future trusted coordinator must obtain complete native history on every
operation. Prepared releases already block opening by default. Terminal
held/superseded/rolled-back histories retain earlier control intent and do not
provide retirement authority. Post-intent mutation requires the separately
qualified stop/supersede/review procedure, still outside this change.

## Persistent integrity and limits

Four STRICT tables are owned by Platform:

- `platform_offline_generations`: immutable generation and first revision.
- `platform_offline_journal`: immutable, contiguous operation journal.
- `platform_offline_receipts`: immutable globally unique task reservations.
- `platform_offline_head`: the one current snapshot, advanced by exact CAS.

The first three tables have update/delete refusal triggers. Native owner SQL
isolation prevents another owner from writing them. Reads replay rather than
trusting plausible head JSON, detecting missing/reordered history, altered
hashes/revisions/generations, omitted or changed receipts, and orphaned records.
SQLite `BEGIN IMMEDIATE` serializes writers; stale copies from another connection
are refused. A failure after journal/receipt insertion but before head CAS rolls
back those writes and earlier business/audit writes when propagated to the
native transaction. Successful state survives close/reopen.

Limits are 64 generations, 1,000 total journal rows, 1,000 receipt rows, one head,
4 MiB per canonical record/text field and 64 MiB total retained text. SQL byte
preflight runs before fetching durable text; journal replay streams one record at
a time. Appends check a conservative capacity estimate including the old head
and replacement bytes before writing. Capacity exhaustion refuses; no history is
pruned. These bounded initial limits require an explicitly reviewed future
archival/migration procedure to grow.

Hashes/triggers are local integrity checks, not signatures, anti-rollback
hardware, infrastructure proof, or a defense against an adversary able to replace
an entire database and its expected external anchor consistently. A copied
instance ID is never authority: the trusted coordinator must independently bind
its current instance, expected anchor and qualification outside the copied file.
Storage refuses a supplied generation that differs from its retained head or the
actual raw hold/schema/organization tuple; it cannot discover an indistinguishable
whole-file clone from the clone's bytes alone. Native candidate logical hashes
are not self-attested as qualification here. No raw private evidence is stored.

## Exact schema 18 and upgrade

`SCHEMA_VERSION` is 18. The historical schema-17 profiles are preserved exactly:

- Event reports enabled: `d5b701319d5933f2357392e90a0ce48dedf0f78540237fd473de4e05d1206f41`.
- Event reports disabled: `338cd156fd11a564935dae8c1f7afb34ee0cbb2547f1f98a97e37c91fb020d1c`.

The schema-upgrade tests freeze independent literal schema-17 additions and both
hashes at the published baseline, rather than recomputing expected historical
DDL from the new implementation. Ordinary schema-17 startup refuses before
mutating the file. Only the existing explicit fresh-file upgrade procedure
accepts all supported older/legacy profiles, preserving native business records,
receipts and retained recovery data, while adding **empty** offline tables.
There is no automatic startup upgrade, live upgrade or current-session backfill.

Candidate inclusion rules are unchanged: the existing fixed candidate snapshot
includes these ordinary Platform tables; release-record exclusions remain as
implemented in the baseline. Root owns any subsequent schema-18 candidate
qualification integration. Nothing here suppresses offline provenance from
candidate hashing or releases the durable provider hold.

## Verification scope

Foreground native SQLite tests cover CA/US in both event-report modes, actual
close/reopen, two connections with stale CAS, late head-write rollback including
an earlier audit, cross-owner/no-transaction refusal, global task reuse across
sessions and generations, changed/copied bindings, retained release intent,
mutation detachment, proxy/accessor traps, oversized storage and durable
head/journal/generation/receipt corruption. The existing upgrade matrix includes
schema 17 in both modes and regions, byte-unchanged startup refusal and retained
native data. Existing phase/recovery/candidate/release regression suites remain
unaltered. Exact command results are delivered in the private verification
receipt with this patch. Initial failed fixture/typechecking runs are retained;
this document does not claim full product, browser, infrastructure or provider
gates passed.

Observed integration follow-up (outside this lane's permitted files): the broader
177-test recovery run passed 154 and failed 23. In
`tests/recovery-profiles.test.ts`, four profile tests and the CLI test still expect
version 17 (lines 241 and 670); sixteen older-profile construction tests leave the
new offline tables in their hand-built historical files (near line 575), so their
frozen hashes correctly differ. In `tests/restore-activation.test.ts`, the two
v16 fixtures similarly retain new tables while removing v17 tables (near line
535), and their eventual upgraded-version expectation remains 17. Root must
update those current-version expectations and historical fixture construction,
retain the frozen old hashes, and rerun combined regression. These 23 failures are
retained and are not counted as passes. This patch changes none of those files.
