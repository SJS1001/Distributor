# Canada Post member original provenance — schema 21

This implements the durable original-preimage prerequisite for the existing fixed
`integration.canada-post-member.import` v1 operation. It does not qualify a
provider response, source fence, current independent authority, or external
COMMIT interlock. Application/coordinator composition remains root-owned. No
provider operation, production enablement, release, retry, booking promotion, or
manifest transmission is added.

## Baseline and ownership

Public `SJS1001/Distributor`, `codex/local-distributor-checkpoint`, excluded base
`f1583c3ae343e3bd1ea265a98b77bb2134507085`, fetched by public HTTPS and verified
against the remote ref. Work uses an isolated worktree; previous deliveries and
other owners' files are preserved. The only changes are the nine assigned paths:

- `src/server/integration-offline-canada-post-member.ts`
- `src/server/integration-offline-canada-post-schema.ts`
- `src/server/schema.ts`
- `src/server/schema-upgrade.ts`
- `src/server/integration.ts` (import and initializer only)
- `tests/schema-upgrade.test.ts`
- `tests/integration-offline-canada-post-member.test.ts`
- `tests/integration-offline-canada-post-provenance.test.ts`
- this report

Requested Astra/high is **unverified**: this runtime exposes no effective model
or reasoning configuration. The owner's local canonical delegated model rule is
not available at its macOS path in this cloud environment. No further delegation
was used. Existing repository instructions and native schema-20 original
cancellation storage/recovery patterns were inspected.

## Durable data and exact ordering

`integration_offline_canada_post_members` is an Integration-owned STRICT table.
Its primary key is the original booking ID, with a booking foreign key and a
composite `(group_id, booking_id)` foreign key to the native member. The org and
request pair and envelope binding are unique. It stores the complete canonical
original envelope, its SHA-256, the unchanged original returned `record`, and its
SHA-256. UPDATE and DELETE triggers are immutable; the existing mandatory
recursive-trigger connection setting also refuses REPLACE deletion. No new
Database setting or authorizer exception was introduced.

`Integration` initializes table definitions only. Creating an instance neither
invents a receipt nor backfills a preimage. Platform data is accessed through
`platform.offline.readInTransaction()`, never Integration foreign-table SQL or a
cross-owner foreign key. That owning reader validates its complete retained
journal and generation history. The fixed join matches exactly one session
record-task step, including previous lineage, original session revision plus
one, org, task owner/name, request, envelope binding, payload, before-candidate
hash and unchanged result hash. Every Canada Post task receipt in the returned
session history must have exactly one matching Integration row, and every
Integration row must match; missing/extra/orphan/cross-org identities refuse.

The existing caller-held Database writer encloses:

1. Bounded global provenance integrity preflight, before private capture use.
2. Existing one-shot private capture/current native join and owning Carrier
   unknown-to-created effect, original audit/event and full conservation checks.
3. Canonical original envelope and result-record insertion into Integration.
4. The sole Platform `record-task` transition referencing that result hash.
5. Existing current candidate pin, current native actor/hold and exact native
   result recovery checks, plus complete stored original correspondence.

Every exception must escape the caller's outer transaction. This wrapper does
not start/commit a transaction or make external adapter/COMMIT qualifications.
Tests inject faults both at provenance insertion and after the Platform receipt;
all owning effects, audit/event, provenance and Platform changes roll back.
Existing capture erasure/lifetime/claim checks are unchanged.

## Read-only APIs and limits

`recoverRetainedInTransaction(actorLocator, envelopeInput)` requires the actual
outer writer for a consistent native read. The actor locator is exactly
`{id, orgId}`. The caller supplies the original envelope to identify the exact
request; it supplies **no result-record preimage, capture, private report, host
port, or evidence bytes**. The envelope must equal the canonical stored original.
The method loads that original record, delegates to the existing exact current
native recovery, and returns its deeply frozen consistency-only result plus the
unchanged deeply frozen `record`. The result remains redacted: no label bytes,
private report, file path, token or reusable permission is returned.

`recoverInTransaction(actorLocator, envelopeInput, originalResult)` remains the
explicit recovery operation. Its original input/output shape is unchanged; it
now additionally requires exact equality with durable original storage. Supplying
an internally rehashed alternate actor, result, comparison or evidence identity
cannot manufacture the original. Absence is a refusal, never permission to
reapply. Application success output is unchanged.

Both paths require current native finance/password/site policy, active raw hold,
original generation and file pin, exact retained Platform history, and current
Carrier/Platform/Fulfillment result correspondence. They do not reuse an obsolete
pre-application candidate logical hash as a current-state assertion. Recovery
works after native close/reopen and session drain/close without rereading private
evidence. Recovery does not invoke an owner mutation, add a receipt or alter
`total_changes()`.

The globally complete table is refused above 1,024 rows or 16 MiB summed stored
UTF-8 bytes. Each envelope and record is capped at 65,536 UTF-8 bytes. SQL scalar
preflights check count, bytes, storage types, NULs, identifier/hash grammar,
JSON/container complexity and complete Integration FK/identity joins before
fetching blobs. No partial pages or selected-org truncation imply completeness.
JSON is then decoded with fatal UTF-8, checked against bounded strict inert data
(maximum depth 16 / 8,000 copied nodes), reparsed through the existing envelope
parser, canonicalized and hashed. Fixed result keys, versions, purposes,
identifiers, hashes and bounded distinct matching custody/Platform member lists
are checked. Input proxies are rejected before reflection; accessors, prototypes,
cycles, sparse/extended arrays, symbols and invalid surrogates refuse. Temporary
fetched envelope/record byte arrays are erased in `finally`.

The Platform public snapshot exposes current-generation sessions, with complete
retained global validation underneath; it does not provide historical global
journal revision locators for arbitrary past generations. This code does not
invent them. A retained Integration row that cannot join the returned generation
and exact session history causes conservative refusal. Rotating/replacing a
recovery generation while retaining such rows needs separately designed qualified
recovery; copied old rows do not become current authority. Malicious coherent
rewriting of the entire store cannot be externally authenticated by local hashes.

## Exact schema evolution

Version 21 adds only this table and its two immutable triggers. Frozen schema
versions 1–20, legacy profiles and both eventReports modes retain their exact
identities. Frozen schema-20 literals independently recorded at the public base:

- enabled: `7fd45cbd7a88edbdf10b3f2b1daa220706d9eb5af20f32cfad99291b5e0a3ed5`
- disabled: `f1f0d63fb11f4f56c4ec7941f234dadbabac18ff5e3686e5282cf6ed125b1162`

Stale schema-20 startup refuses without changing source bytes. Explicit fresh-file
upgrade supports prior/legacy profiles and creates an **empty** provenance table;
it never reconstructs old original records from current native rows or receipt
hashes. Old imports lacking retained proof continue to refuse. Existing schema
receipt and destination guards stay intact. The existing candidate snapshot
reader already includes this table and schema in its complete logical digest;
no candidate hashing code changed.

Native CA/US tests cover fresh startup and current encrypted backup/restore in
both eventReports modes. Independent authenticated frozen-v20 archives refuse
implicit restore/backup conversion to v21 without source/archive mutation or a
published destination. Historic root-owned recovery/activation/refund fixtures
outside the assigned paths are not rewritten by this change.

## Verification receipt

Environment: Linux x64, Node v24.19.0, native SQLite 3.53.3. Locked dependencies
were reused from the existing installed workspace; no dependency files or
installation/runtime configuration changed. All fixtures are synthetic.

Initial evidence retained outside tracked source at
`/workspace/distributor-canada-post-provenance-audit`:

- `schema-initial.log`: exit 0, 107/107 before four additional encrypted-v20 cases.
- `native-initial.log`: exit 0, original 36/36 import tests.
- `typecheck-initial.log`, `typecheck-tests-initial.log`: exit 0.
- `provenance-initial.log`: exit 1, 38/40. Two newly added orphan tests used the
  normal candidate snapshot after deliberate FK corruption; that helper refused
  with `SCHEMA_INTEGRITY` before the recovery assertion. The tests now compare
  complete raw Integration/Platform owned-table snapshots for those intentionally
  corrupt fixtures. Recovery refusal and zero-write assertions remain intact.
- `provenance-second.log`: exit 0, 44/44, including additional global budgets and
  insertion-failure tests. Original old assertions/timeouts remain unchanged.

Tested source commit: `0172847a3e1edb2618f33f72969f2d58face1974`. The test
run used exactly these source/test contents; this report is the only later change.
Closing commit and patch transfer hashes are in the external delivery manifest.

Final checks:

```sh
node --import tsx --test tests/integration-offline-canada-post-member.test.ts tests/integration-offline-canada-post-provenance.test.ts tests/schema-upgrade.test.ts tests/integration-offline-original-provenance.test.ts tests/restore-offline-canada-post-private-native.test.ts tests/restore-offline-commit-recovery.test.ts tests/restore-offline-storage.test.ts tests/restore-offline-storage-boundary.test.ts tests/database-streaming.test.ts tests/canada-post-creation.test.ts tests/canada-post-groups.test.ts tests/canada-post-manifest.test.ts
npm run typecheck
npx --no-install prettier --check src/server/integration-offline-canada-post-member.ts src/server/integration-offline-canada-post-schema.ts src/server/schema.ts src/server/schema-upgrade.ts src/server/integration.ts tests/schema-upgrade.test.ts tests/integration-offline-canada-post-member.test.ts tests/integration-offline-canada-post-provenance.test.ts docs/INTEGRATION-OFFLINE-CANADA-POST-PROVENANCE-2026-10-04.md
git diff --check
```

- Affected native checks: exit 0, **471/471**, zero skipped/cancelled, 96.357 s.
  Includes 44 new provenance cases, all original 36 import cases and 111 schema
  upgrade cases. This is an affected run, not the complete product suite.
- Complete TypeScript: exit 0.
- Assigned-path Prettier and whitespace checks: exit 0.
- Initial failed test log SHA-256:
  `f5ac1035914d07c7488325ac0098bbd870fda6e4d934b018c41039770fdbc2f1`.
- Final affected log SHA-256:
  `d737ab821574a02eb73670426f70c81ff4283bb306355a993a8def85d147b070`.

These checks do not verify product gates,
independent infrastructure, provider outcome truth, current external revocation,
source/candidate fencing, or production qualification. The native import remains
unwired/default blocked pending root's independently qualified composition.
