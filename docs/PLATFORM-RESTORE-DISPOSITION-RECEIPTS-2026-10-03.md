# Platform restore-disposition receipt port — 2026-10-03

## Boundary and consumer API

Platform now implements the trusted `IntegrationDispositionReceipts` port through
`platform.integrationDispositionReceipts(nativeActor)`. The factory copies the
native principal and returns only `forResultInTransaction(orgId, command,
resultId)`. It does not read, authorize or cache receipts at construction. Every
read requires the existing writer transaction on the same `Database` connection.
It starts no transaction, opens no secondary connection and writes nothing.

Root-owned consumer composition can use:

```ts
const receipts = app.platform.integrationDispositionReceipts(maintenanceActor);
const disposition = app.database.transaction(() =>
  app.integration.restoreDispositionInTransaction(
    maintenanceActor,
    binding,
    receipts,
  ),
);
```

If already inside the candidate writer transaction, call the owner directly;
do not nest a new transaction. `binding` is the integration owner's exact native
candidate binding, not external evidence or a projection from a cached page.
This contribution does not wire Application or the restore consumer.

The existing `Application` configuration of `Platform.configureReadAuthority`
resolves the current IAM principal and refuses password-change restrictions.
The new method reuses Platform's existing finance read-authority check, requires
finance/admin with no buyer account, and checks the exact organization against
the copied principal. It does not use `authorizeRead()`'s support-only grant as a
substitute for finance. Missing authority configuration, revoked/inactive users,
non-finance users, buyers and password-restricted users fail closed. Copying the
principal prevents caller mutation from changing the captured organization or
identity; copying grants does not preserve permission because IAM is re-read on
every invocation. The integration owner independently rechecks its native actor.

A maintenance principal must be a real, currently authorized native IAM user.
`RestoreDossier.preparedBy` and external approver identifiers are not native user
credentials and must never be converted into fabricated actors. The port retains
original command authors, including actors whose historical access has since
ended. It is not HTTP input, an external-JSON import, provider outcome evidence,
a transport permission or standalone restore-release authority.

## Selection, integrity and ownership

Only these exact command names are allowed:

- `quickbooks.credit.apply`
- `quickbooks.credit.cancel`
- `stripe.checkout.renew`

Platform selects all rows for the exact organization and command from its own
`platform_commands` table, validates the complete scoped history, then selects
exact decoded result IDs. There is no historical actor filter, `LIMIT`, page,
cache, secondary connection or generic query surface. All matching duplicate
receipts are returned so the integration owner can reject ambiguity rather than
silently choose one. Valid absence returns an empty array; malformed scoped
history raises `RESTORE_RECEIPT_INTEGRITY`, even if it would otherwise disappear
behind a JSON result-ID filter. Other organizations/commands cannot contribute
receipts or contaminate the scoped scan.

Validation checks exact nonempty bounded identities and keys without whitespace
aliases; lowercase SHA256 shape; canonical ISO creation time; object results
with exact string IDs; and the original Platform `JSON.stringify` encoding.
Malformed JSON, duplicate members, alternate ambiguous encodings, arrays, null
results and identity aliases refuse. Decoding creates detached objects on each
call; returned mutations never change retained data or another read.

The request body is not stored here, so the port does not claim to recompute its
hash. Integration reconstructs the exact native request/result and checks full
hash, actor, time and source provenance. Valid-looking but false hashes, result
fields or timestamps remain insufficient to produce a native disposition.
Historical actor IDs and original row bytes are preserved. The port sees stored
receipt changes within the caller's current writer transaction, including
uncommitted changes; only that transaction's eventual commit makes its overall
outcome durable. It cannot use a separate connection's earlier committed view as
proof. Reads never clear recovery holds, mutate queues or infer provider truth.

## Exact prerequisites and owned delta

Original local parent: `9836f9eed8fa939016c6ff02ff4175a248e0ad03`. Previous restore
repair `9c8c91a1fd8b619b66ec1de8783aca4313386912`, original restore package
`e33ad405a97479f42e59aca30f21054da9323f19`, browser diagnosis and accounting work
remain preserved.

The supplied integration delta is attributed to
`fb049767435f86f4b09fd30299b43bec5e81c5fa`, base
`f2d648e755f9d1cbaf26914d13e834906526ccca`. Existing transfer files were available
locally. All three whole base64 chunks were concatenated before decoding/gunzip;
both exact supplied byte counts and SHA256 values matched:

- Raw patch: 57,041 bytes,
  `025f55680bf1f29035c6f852332709213f4955945ac914c26a875b87f660fd94`.
- Gzip: 14,314 bytes,
  `6199beb638475bd888b4c5ba71cf225b3e762f7ebc131d75852df089917e337f`.

`git apply --check` passed without modification. The supplied patch actually
contains five files (three implementation files, its test and report), despite
the assignment's four-file wording. All five exact files were committed
separately as prerequisite `a0f6dd6d0f47133ffe1eec71a7032315548628ab`.
**The delivered owned delta starts at that prerequisite commit and excludes all
prerequisite bytes.** This is not a claim that the entire checkout equals the
integration author's separate base or ROOT's newer published checkpoint.

Owned changes are only `src/server/platform.ts`,
`tests/platform-restore-disposition-receipts.test.ts` and this report. No schema,
restore/application/integration/carrier implementation, existing test, HTTP,
shared tracking, dependency or workflow was edited by the owned delta.

## Foreground verification and preserved failures

Read repository instructions, README, PLAN, DECISIONS, HANDOFF and the supplied
canonical model rule. Requested `gpt-6-astra/high` remains unverified because no
effective model/effort setting is exposed. No nested session/agent was launched.
Runtime: Node 24.19.0, Linux UID 0, existing pinned dependencies reused unchanged.

```sh
node --import tsx --test tests/platform-restore-disposition-receipts.test.ts
node --import tsx --test tests/platform-restore-disposition-receipts.test.ts tests/integration-restore-dispositions.test.ts tests/stock-journal-preparation.test.ts tests/reconciliation-receipts.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/prettier --check src/server/platform.ts tests/platform-restore-disposition-receipts.test.ts docs/PLATFORM-RESTORE-DISPOSITION-RECEIPTS-2026-10-03.md
git diff --check
```

- Initial dedicated native run: 22/22 pass, 3368.463263 ms.
- Initial TypeScript failed on missing callback contextual types and a test's
  private Identity helper. These were corrected with a typed port and the public
  `identity.users()` interface; the failed log remains retained.
- First expanded regression: 64/65 pass, 4301.613829 ms. Its added buyer test
  referenced a nonexistent fixture actor and failed; TypeScript caught the same
  mistake. The test now creates and resolves an actual buyer through IAM.
- Final regression: **65/65 pass**, zero skipped/cancelled, 3558.884455 ms,
  including all 24 new Platform cases, existing integration dispositions,
  native legacy journal preparation and reconciliation receipt coverage.
- Final TypeScript, owned formatting and patch whitespace checks pass.

New coverage uses actual Platform command receipts and native integration
operations. CA/CAD, US/USD and CA/USD configurations exercise cancellation and
unsent checkout supersession with reporting on/off and an unchanged recovery
hold. Historical native invoice/credit completion is built only through
explicit deterministic in-memory adapters; no network or vendor client is used.
The tests assert no transport permission or externally verified outcome.

Adversarial cases cover 206 duplicate receipts across authors beyond public
paging limits, inactive historical authors, independent current finance reads,
real native-owner ambiguity refusal, same-connection uncommitted updates/inserts,
outside-transaction and owning-SQL-callback refusal, rollback, exact scope and
command allowlist, detached return/principal data, missing authority, current
role removal/password restriction/buyer refusals and an external signer-shaped
ID that is not an IAM user. Platform-owned corruption fixtures test bad stored
JSON/hash/time/identities; valid-looking false native provenance is separately
rejected by Integration. Complete owning-table snapshots assert that successful
reads and failed/rolled-back transactions leave source rows, audits and holds
unchanged. Legacy journal receipt APIs remain intact.

Retained logs under `/tmp`:

| File                                                                   | SHA256                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `platform-disposition-test-initial.log`                                | `77ae31d262335f692aaef72d5b963f792a7879c82bd3fb48a4ccec68a2d5ca01` |
| `platform-disposition-typecheck-initial.log`                           | `6c0c6f0ae9b73644aeccdd9be1b1cfc71e0128caadc609e3cb5ab5881e80aff7` |
| `platform-disposition-regression.log`                                  | `51b24c7967881c39cb5a4a88cee487daee4532fff4432cd06a558246ce05796c` |
| `platform-disposition-typecheck-final.log` (historical failed attempt) | `3992195ffc3d4a03e743297829410cc6e2e03a1edf4bad4a964cc191e333e534` |
| `platform-disposition-regression-verified.log`                         | `8b2214ad3c236ba1de4f12f8858714ee22059b0bba5a34221aff7e57c521a6d8` |
| `platform-disposition-typecheck-verified.log`                          | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

Exact `git diff --binary parent..commit` bytes are delivered as ordered base64
chunks of gzip, with raw/compressed sizes and SHA256 plus per-chunk hashes.
All foreground processes finished. No provider I/O, outbound production adapter,
CI/runner, PR/push/deployment, settings/secrets, reminder or automation was used.
No subscription was created. Consumer wiring, actual infrastructure qualification
and all task/product gates remain **NOT VERIFIED**.

## Root integration replay

Root verified the exact 36,104-byte owned delta SHA-256
`d2d140a98da5c329fa05dddf800abbf6459e985587186707ed8ff0553ad2a476` and
applied it to the newer Distributor checkpoint after completing its full native
and browser runs. On macOS arm64 with Node 24.16.0, Platform/integration/journal
preparation/journal reconciliation regression passes **76/76**, with zero
failures, cancellations or skips, 4,101.593458 ms. The private replay log has
SHA-256 `20d9d1e60340f0c90d42df924a420b6a9ea87475eb3b225e208bb29a69becb4b`.
Fresh TypeScript, assigned formatting and document structure pass. This is
focused verification of the adapter increment; prior full-suite receipts retain
their original captured source scope. Consumer wiring and qualification remain
open.
