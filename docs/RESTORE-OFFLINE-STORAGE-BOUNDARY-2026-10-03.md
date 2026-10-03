# Offline storage adversarial boundary review — 2026-10-03

Reviewed production baseline: `cffc9413f93bbee7fd1ab140edc3a42f22ba5dd3`,
SJS1001/Distributor. This delivery contains only the new boundary test and this
report; it excludes the earlier eight-file storage/schema delivery and all newer
root integration/phase repairs. No production, schema, old test, dependency or
shared report changes. Requested Astra/high; effective runtime model/effort is
not exposed. The canonical local rule path supplied by the coordinator is not
present in this cloud filesystem, and no matching rule file was found in the
available workspace rule locations. No delegation or extra executor was used.

## Reproduced defect: replacement bypasses append-only SQL guards

Four ordinary, unskipped tests remain **RED** against the excluded baseline:

1. `append-only guard must refuse native INSERT OR REPLACE of platform_offline_generations`.
2. The corresponding test for `platform_offline_journal`.
3. The corresponding test for `platform_offline_receipts`.
4. `receipt binding uniqueness cannot be used by REPLACE to evict another task's reservation`.

All valid provenance is first created with real native storage operations in a
private file-backed SQLite application. The attack then uses the ordinary
Platform-owned Store inside its existing native writer transaction. There is no
raw connection, removed trigger, PRAGMA change, disabled foreign-key guard,
monkey-patched production behavior or forged authority in these four tests.

The first three substitute a different hash while retaining the original row's
identity and valid SQL references. `INSERT OR REPLACE` succeeds instead of
throwing the expected append-only error. The fourth starts with two native task
receipts, then replaces the second while supplying the first's globally unique
binding. SQLite accepts the statement that replaces both conflicting receipt
reservations with one row. The assertion throws after the statement unexpectedly
succeeds, so the enclosing test transaction rolls back. This keeps the test's
fixture isolated; it does not mean SQLite refused the replacement.

The current schema has `BEFORE UPDATE` and `BEFORE DELETE` refusal triggers, but
no conflicting-insert guards. SQLite's implicit deletions for REPLACE do not run
delete triggers unless recursive triggers are enabled; the native Database
constructor does not enable that setting. Ordinary UPDATE/DELETE refusals were
already covered by the unchanged original storage suite, and continue to pass.

Scope of the finding: this violates the storage layer's declared append-only SQL
provenance guarantee. It does **not** demonstrate an operator-facing route to
execute arbitrary SQL, a foreign-owner authorizer bypass, provider access, or
current external authority. The current task-shaped storage methods use INSERT,
not REPLACE, and full replay rejects inconsistent retained evidence. Those
controls do not make a successful destructive Platform SQL statement append-only.
The new test deliberately asserts refusal at the write boundary, rather than
accepting later detection as an equivalent guarantee.

Root should review insert-time conflict guards covering every immutable unique
identity: generation instance/creation revision, journal revision, and receipt
scoped request tuple/binding/revision. Preserve ordinary first insertions and
whole-transaction rollback. Any DDL repair must follow root's exact schema and
frozen-profile policy; this review does not silently alter a published profile or
recommend changing global SQLite behavior without broader evaluation. Rerun
these four unchanged assertions plus original storage/schema/recovery checks
when integrating the repair.

## Additional passing coverage

Fifteen new tests pass on the baseline:

- CA and US use two actual native connections. Each individual expected anchor
  field (instance, revision, state hash and journal hash) is necessary. After one
  receipt wins, a stale competitor cannot append; refreshing the head does not
  make the same scoped request a new task.
- Reads validate archived generation, journal and receipt evidence after a newer
  generation becomes current. Even a byte-authentic older head cannot override
  newer retained journal history. A subsequent transition refuses damaged
  history, and the provider hold remains closed.
- Terminal invalidation, close/reopen and changed raw recovery generation retain
  global request/binding reservations. Historical state can still be read; a
  stale generation cannot write against the new native hold. Different owner
  labels do not make a reserved binding reusable. A genuinely different scoped
  task and binding is only a storage fact, not proof its named module ran.
- A returned frozen snapshot from an outer transaction that subsequently fails
  is not a commit receipt. Restart shows unchanged durable state, the rolled-back
  anchor is stale, and exact task retry commits one reservation. An interrupted
  first journal insert also rolls back its generation reservation and permits
  exact generation retry after restart.
- Inventory, Billing and Integration SQL scopes cannot read or rewrite Platform
  provenance, including CTE/select paths; a nested storage call cannot escape the
  native transaction-scope requirement.
- Oversized generation/journal row counts are refused before any retained payload
  SELECT/iteration. UTF-8 byte size is checked rather than JavaScript character
  length. Aggregate bytes across individually legal-sized cells refuse before
  generation/journal JSON is loaded. Spies record attempted payload materialization
  and assert zero calls; no memory exhaustion or unbounded workload is required.

Damaged historical-cell tests explicitly use a separate synthetic fixture
mutation that temporarily removes and restores the exact trigger DDL. This models
a corrupted file and tests replay detection; it is not used to create successful
business behavior or to bypass the four failing SQL-guard assertions. The
bounded malformed row/byte fixtures are likewise synthetic evidence for the
preflight boundary, not accepted imports. No live data or credentials are used.

## Checks and limits

Runtime: Linux cloud, Node `v24.19.0`, repository's already installed locked
dependencies. New focused file: 19 tests, 15 pass, 4 genuine guard failures, no
skips/todos. New plus unchanged original storage suite: 44 tests, 40 pass, same
4 failures, no cancellations/skips. The first run also contained a test diagnostic
mismatch: SQLite's authorizer correctly said `access ... is prohibited` rather
than `not authorized`; the matcher now recognizes both refusal forms. That first
log and all real RED results remain in the private audit directory. No failing
production assertion was weakened or marked as an expected-failure todo.

Foreground commands:

- `node --import tsx --test tests/restore-offline-storage-boundary.test.ts tests/restore-offline-storage.test.ts`
- Final combined replay adds `tests/restore-offline-phase.test.ts` to those files.
- `npm run typecheck`
- `npx --no-install prettier --check tests/restore-offline-storage-boundary.test.ts docs/RESTORE-OFFLINE-STORAGE-BOUNDARY-2026-10-03.md`
- `git diff --check cffc9413f93bbee7fd1ab140edc3a42f22ba5dd3 HEAD`

Exact final results, commit and hashes accompany the transfer receipt. Full
schema/recovery regression is root-owned; known unowned schema-17 fixture repairs
from the original storage delivery are not repeated here. No full product,
browser, infrastructure, or provider qualification is claimed. Low-level state,
receipt hashes and an intact raw hold do not prove independently qualified source
fencing, current external authority, native IAM identity or permission to mutate
an owning module. Whole-file cloning cannot establish independent instance
identity. The qualified default-disabled coordinator remains separate root work.
All product gates remain **NOT VERIFIED**. No push, PR, CI, provider I/O,
background jobs, reminders or infrastructure changes were made.

## Production repair follow-up — 2026-10-03

The four RED results above describe excluded commit
`44f33adc84917db830b94f161126e151b0639ae4` and remain retained historical evidence.
The root independently reproduced the four failures; its reported private log
SHA-256 is `d1e789fef8e1a0a70cb939e933f9752df6e86ce0a43b96efe91a40f0ff509497`.
This follow-up implements the subsequently authorized connection-level repair in
`src/server/database.ts`, appends two tests to the same boundary file, and updates
only this report. All 19 original test bodies/assertions are byte-identical to
that excluded commit. No schema, upgrade, frozen profile, other test or shared
composition file changed.

Each fixed private `Database` connection now executes
`PRAGMA recursive_triggers=ON` with its existing initialization PRAGMAs, before
installing the SQL authorizer. Existing immutable DELETE triggers therefore also
reject the implicit conflict deletions performed by SQLite REPLACE. The setting
is mandatory and has no caller option. Initialization failure still closes the
connection through the existing catch path. The unchanged authorizer denies
native PRAGMA changes, including Platform and Migration owner calls. No additional
callback, SQL capability, permission, provider access or authority is introduced.

This setting belongs to the connection, not persistent schema DDL or the stored
version receipt. There is no ALTER, migration or implicit upgrade. The frozen
schema-17 and schema-18 sources are unchanged. The full existing schema-upgrade
matrix still verifies exact historical profiles, byte-unchanged stale startup
refusal, explicit fresh-file upgrades and native data preservation. The current
production trigger definitions are the immutable offline guards and Platform's
audit sequence trigger; neither needs a DDL change for this repair.

Two new CA/US tests first fail on the excluded production source, alongside the
four original failures: 21 tests, 15 pass, 6 fail, exit 1, no skips. They then pass
without changing their assertions after the repair. Each uses a primary native
connection, a second independently opened connection and a reopened primary. It
attempts to disable recursion through Store.run, Store.migrate and the existing
native owner callback, both outside and inside writer transactions, under
Platform, Migration and Inventory scopes. Every attempt is refused. Byte-identical
REPLACE of each immutable table is then refused on every connection; retained
state and exact sqlite_master definitions stay unchanged and the recovery hold
stays closed. The original four tests additionally retain changed-row and
cross-binding eviction coverage.

Final direct foreground verification on Node `v24.19.0`:

- `node --import tsx --test tests/restore-offline-storage-boundary.test.ts tests/restore-offline-storage.test.ts tests/restore-offline-phase.test.ts tests/database-streaming.test.ts tests/audit-pages.test.ts tests/event-delivery.test.ts tests/schema-upgrade.test.ts`: **190/190 pass**, exit 0; zero failures, cancellations, skips or todos.
- `npm run typecheck`: exit 0.
- Assigned three-file Prettier and diff whitespace checks accompany the final
  transfer receipt; all original RED logs remain under the private audit paths.

The audit/event suites exercise normal trigger effects, independent audit writers
and injected late-trigger failures/rollback. No trigger-recursion regression was
observed in these targeted suites; a full product/browser/provider regression is
not claimed. This repair protects fixed native Database connections. A separate
raw SQLite connection outside that boundary can select its own settings; this is
not a claim of protection against arbitrary file editing or compromised process
code. Storage remains non-authoritative, and qualified coordinator/source/current
external authority work is still separate. Requested Astra/High; effective
runtime model/effort remains unavailable. No push, CI, provider I/O, PR, account changes,
infrastructure changes or reminders. Product gates remain **NOT VERIFIED**.
