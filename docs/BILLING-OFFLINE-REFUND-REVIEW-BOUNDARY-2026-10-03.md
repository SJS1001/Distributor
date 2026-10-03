# Billing offline refund review boundary evidence — 2026-10-03

Current repair against `c0ed01a7647826e195d8ed330dadfa905c38b173`: all three
preserved red assertions now pass without changes. The production repair and
expanded verification receipt appear at the end. The original adversarial
receipt below is retained as historical evidence, including its actual failures.

## Original adversarial delivery

Exact production/test baseline: `63bfcd43efaa44e30324009f4a93119969e41046`.
This contribution adds only this report and
`tests/billing-offline-refund-review-boundary.test.ts`. The previous Billing
projection delivery is excluded. Production, existing tests, schema, Integration,
Platform, restore history and tracking files are unchanged. No root checkpoint
was fetched. Root owns any implementation repair.

## Result: byte refusal is too late

The new suite leaves three ordinary assertions failing, with no `todo`, skip or
expected-failure conversion. They reproduce one resource-boundary defect:
`reviewOfflineFailedRefundInTransaction` loads retained rows with `Store.all`,
then calls `canonical(rows)`, and only afterward compares UTF-8 bytes against
`offlineRefundReviewLimits.bytes` (1,048,576). Complete row counts are checked
before that canonicalization, but text/aggregate byte limits are not.

| Case                                | Synthetic data                                                           | Marked UTF-8 bytes passed to `JSON.stringify` before refusal | Required assertion |
| ----------------------------------- | ------------------------------------------------------------------------ | -----------------------------------------------------------: | ------------------ |
| Oversized invoice-line description  | One retained multibyte field; JavaScript character count below 1 MiB     |                                                    1,048,599 | 0                  |
| Oversized target refund reference   | One retained multibyte field; JavaScript character count below 1 MiB     |                                                    1,048,597 | 0                  |
| Oversized complete invoice-line set | 220 added rows, each description under 2,000 characters; 221 total lines |                                                    1,192,180 | 0                  |

All three receive the actual native `OFFLINE_REFUND_REVIEW_LIMIT` refusal. The
failing assertion is that this refusal must occur before serializing the oversized
text. This is **not** evidence that an invalid projection was returned or that
money was released. It demonstrates that the advertised byte limit does not
bound pre-refusal JavaScript materialization. Larger retained SQLite text can
therefore cause work/allocation beyond the intended limit before rejection.
These small deterministic fixtures do not attempt process exhaustion, measure
peak memory, or claim a deployed exploit.

The test uses call-through instrumentation on `JSON.stringify` during a single
synchronous native read. It counts matching synthetic marker strings by
`Buffer.byteLength`, delegates every call to the original serializer and restores
it in `finally`. Queries, native rows, returned values and error codes are never
substituted. Metrics are numbers, not private evidence. The aggregate fixture
adds synthetic zero-price lines with distinct product identities directly to the
Billing-owned test store; it is a resource-bound corruption fixture, not a claim
that a native order command produced those added lines. Each corrupting writer
rolls back even when the red assertion fails.

Root's repair should bound retained text/complete sets before JSON construction,
including the early `get`/`intent` path, without paging or silently dropping facts.
SQL text character length alone is not a UTF-8 byte bound. The final canonical
body check should remain, including duplicated projection fields and JSON
escaping overhead. This report introduces no production repair or new API.

## Passing native boundaries

The independent fixture uses real temporary native SQLite databases, shipment
invoices, one verified Stripe payment, a manual payment, two separately issued
credits and three native refund requests. The manual refund has a native proof.
Billing's native `markUnknown` retains the target state inside a writer; no
Integration eligibility is asserted. Provider observations are synthetic values
passed directly to the existing Billing owning method in native transactions,
not network responses or mocked query results.

The new suite checks:

- CA/USD with event reporting, CA/CAD and US/USD; exact region/currency/intent,
  complete facts hash, two-credit capacity and all sibling reservations.
- Real sibling success, ignored pending, then failure observations; completed
  manual cash-out remains counted, failed sibling reservation is released, and
  unknown target reservation remains. Valid earlier history is returned as facts.
- Sixteen independent missing, malformed or copied-history cases: sibling
  mappings; observation reference, organization, status and time; missing notice
  revision; copied update organization; wrong notice invoice; duplicate foreign
  notice; read scope/revision/time/actor; and a manual proof copied to Stripe.
  Refusal leaves the damaged rows unchanged, followed by full fixture rollback.
- Per-payment capacity even when the invoice still has sufficient credit;
  invoice capacity even when the original payment is sufficient; individually
  reconciled credits whose combined quantities exceed original units; and
  cross-invoice/cross-organization siblings reached through retained native IDs.
- Fresh finance role, active user, organization and password-change checks in the
  actual writer. No ambient or cached principal replaces current IAM.
- Recursive freezing of every returned nested object/array, detached earlier
  snapshots, hash changes for uncommitted native facts, and rollback restoration.
- A real uncommitted native observation plus notice update is visible immediately;
  a second read after revoking finance in that same transaction refuses. Rolling
  back restores the original complete facts and authority.
- 1,001 observations and 1,001 acknowledgement rows refuse instead of returning
  a truncated page. The rejected sets are not canonicalized. The observation
  check permits the one earlier provider-mapping serialization (9 marker bytes);
  acknowledgement overflow serializes zero marked reader IDs.
- Recovery hold remains closed. These readers grant no transport authority.

Copied acknowledgement actor IDs are retained-fact corruption fixtures, not
newly authenticated historical users. This suite deliberately does not demand
historical IAM authentication, receipt authenticity, offline first-slice
eligibility, dossier qualification, provider truth, or Integration/Platform
lineage from this Billing-only projection. A consistent earlier observation is
not itself an error. The facts hash is a repeatable comparison, not authenticity.

## Foreground verification

Environment: Linux, Node `v24.19.0`, UID 0, repository's existing isolated installed
dependencies. No dependency/lock changes. All fixture applications close and
remove their synthetic databases through the native test fixture cleanup.

Final command:

```sh
node --import tsx --test tests/billing-offline-refund-review-boundary.test.ts tests/billing-offline-refund-review.test.ts
```

Actual exit **1**: **54 tests, 51 pass, 3 fail**, zero skipped/cancelled/todo;
4,039.186996 ms. The new file contributes **39 tests, 36 pass, 3 fail** including
nested cases. The unchanged original projection suite contributes **15/15 pass**.
The three failures are exactly the byte-boundary assertions above. Final log
`/tmp/billing-boundary-verified.log` SHA256:
`51789f7a5f4292e47c2da3b1f8ab2c364079b1992c897502ea7201d97526e3cd`.

`./node_modules/.bin/tsc --noEmit`: **exit 0**. Dedicated Prettier for the two new
files and `git diff --check` pass. No broad regression rerun or actual-provider,
customer, infrastructure, product-gate or restore-candidate capture qualification
is claimed. The temporary native SQLite tests had no environment blocker; this
assignment does not exercise or bypass the root-only candidate WAL metadata
limitation seen in earlier restore work.

Original failures remain in separate logs:

- `/tmp/billing-boundary-initial.log`: 37 tests, 33 pass, 4 fail. Two genuine row
  byte-boundary reds plus two setup failures: recursive observation-copy query
  denied by the SQL authorizer, and duplicate invoice/product identities in the
  aggregate fixture. Corrected with ordinary bounded inserts and distinct
  synthetic product IDs; no guard or production file was changed. SHA256
  `aa4a8e50dd96ca37ed0ef7ace488e14dc073e8f75af9b5724bbe9cb9da89924d`.
- `/tmp/billing-boundary-corrected.log`: 37 tests, 34 pass, 3 byte-boundary failures.
  SHA256 `bc7cd50c8607c390a45de531592aec5e2c54aa7e0df75f052f74a38396e7614a`.
- `/tmp/billing-boundary-final.log`: 54 tests, 51 pass, same 3 failures before an
  explicit numeric SQLite query type annotation. SHA256
  `a186b443e2a56738f8a209e7ad47b16fed0c36af10dafcf3cb2d5fa17afd593d`.
- `/tmp/billing-boundary-typecheck-final.log`: retained intermediate TS2345 for
  the generic SQLite row's possibly undefined ID. Fixed only the new test's
  query result type to `{ id: number }`; final TypeScript passes. SHA256
  `a10a1bf0ad24e8835377904a8a9c31bd11cf2c3ed6439e4a73a6d70c01403716`.

Unchanged production `src/server/billing-refunds.ts` SHA256:
`40c2e398636f7487969f8c79289bab925a178afd6c84470e4afdda6919490943`.
Unchanged `tests/billing-offline-refund-review.test.ts` SHA256:
`69e86aaeead1156012e3d128f8dd1ba441ee2d87e5a128ff6ea9f5014226da7f`.

Read repository instructions. The external canonical delegated-model rule path
was unavailable in this cloud filesystem; the supplied owner rule applies.
Requested Astra/High; effective model/reasoning configuration is not exposed and
is unverified. No nested executors, live provider IO, CI, runner/workflow, push,
PR, deployment, accounts, secrets, reminders or background routines were used.

## Production repair against the preserved adversarial delivery

Exact incremental base: `c0ed01a7647826e195d8ed330dadfa905c38b173`. This new
contribution changes only `src/server/billing-refunds.ts`, appends tests to the
existing owned boundary file, and updates this owned report. It excludes both
prior deliveries (`63bfcd43` and `c0ed01a`) and all other owners' changes. The
original 610-line boundary test content, including the three red assertions,
is byte-for-byte preserved as the prefix of the expanded test file.

The reader now has fixed, method-local Billing column sets and numeric-only SQL
preflights for every returned retained collection: invoice, invoice lines,
credits, credit lines, payments, refunds, provider mappings, observations,
manual proofs, notices, notice updates and notice reads. No caller supplies SQL,
columns, budgets or store access. All parameters remain bound values.

Before fetching a collection, the reader counts at most 1,001 rows and refuses
if the fixed 1,000-row limit is exceeded. This is a refusal sentinel, not a
truncated review. For an accepted count, SQLite calculates the largest complete
row and aggregate retained value bytes with `length(CAST(column AS BLOB))` and
numeric sums. This measures UTF-8 bytes, including bytes after embedded NUL,
rather than Unicode characters. Ordering is removed only from these fixed
metadata queries; the actual complete returned histories retain their original
ordering. The metadata queries return no retained text to JavaScript and use no
JSON serialization/parsing to measure it.

The aggregate raw-byte budget is cumulative across collection reads. A later
collection that would exceed the remaining budget refuses before that
collection's retained strings are fetched. The exact existing canonical
collection/body checks remain, additionally covering keys, JSON escaping and
repeated fields in the final projection. These checks are not represented as an
exact process peak-memory or SQLite-internal memory measurement.

The early native `get`/`intent` paths are also guarded: exact scoped refund,
invoice and original payment rows pass an aggregate scalar SQL budget before any
of those readers runs. Scalar preflights use only the scoped caller refund ID
and native SQL relationships, without first fetching possibly oversized IDs.
The scalar budget is separate because subsequent collections repeat those
rows; the final canonical body check still covers duplicated output fields.
Unsupported opening snapshots now refuse through an existence check before
`billing.invoice()` can materialize their retained source strings. They remain
unsupported, with the original `OFFLINE_REFUND_REVIEW` refusal semantics.

All preflights and subsequent native validations run inside the already-required
same writer transaction. No snapshot can change between them through a second
writer. Current IAM/password/organization checks precede the Billing reads and
remain repeated through owning interfaces where previously required. Complete
lineage, conservation, immutable detachment, native errors, recovery hold and
original observation/notice semantics are preserved. There is no foreign SQL,
new receipt, mutation, schema change, caller port, transport grant, external
qualification or Integration eligibility assertion.

### Expanded native checks and exact outcomes

Seventeen new subcases use actual SQLite corruption under rollback and
call-through instrumentation on the Database return boundary. Oversized marker
text must never leave SQLite for JavaScript. They cover every returned Billing
collection, early target/payment/account/currency identities and invoice
scalars. Four additional cases cover combined scalar overflow, cumulative
collection overflow, embedded NUL, and unsupported opening-snapshot text. No
query, response, refusal or native API is replaced by these probes.

Final foreground commands:

```sh
node --import tsx --test tests/billing-offline-refund-review-boundary.test.ts tests/billing-offline-refund-review.test.ts
node --import tsx --test tests/billing-authority.test.ts tests/refunds.test.ts tests/refund-history.test.ts tests/refund-notices.test.ts tests/refund-callbacks.test.ts tests/payment-history.test.ts tests/accounting-refunds.test.ts tests/accounting-credits.test.ts tests/accounting-payments.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/prettier --check src/server/billing-refunds.ts tests/billing-offline-refund-review-boundary.test.ts docs/BILLING-OFFLINE-REFUND-REVIEW-BOUNDARY-2026-10-03.md
git diff --check
```

- Focused native tests: **76/76 pass**, exit 0, 5,228.645361 ms; boundary **61/61**
  and original projection **15/15**. All three previously failing serializer
  probes report **zero** oversized marker bytes before refusal. Final log
  `/tmp/billing-boundary-repair-final.log` SHA256
  `fcf2c124154faefb8b52fcb4258e9fa191dd52203c5aff087c3b45454b2e38ca`.
- Affected native regressions: **114/114 pass**, exit 0, 9,514.189658 ms. Log
  `/tmp/billing-boundary-repair-regressions.log` SHA256
  `0f1874f20a18f12e882c807b12d396f43c55847f6ed84cbb38982d9d8f550de4`.
- Complete TypeScript, assigned formatting and diff checks: **pass**.
- Earlier repair checks are retained: `/tmp/billing-boundary-repair-initial.log`
  **54/54 pass**, SHA256
  `a59d41bdc01a6408a92ae9f68caab5351c380b52e3659f2f359ff396660d08a8`;
  `/tmp/billing-boundary-repair-expanded.log` **76/76 pass** before removing
  unnecessary metadata-query ordering, SHA256
  `1fa0fd88bd7bb0298736cdc32b5b8bb09e6f888e6c37625c93efbeea9bf87f1a`.

All original red receipts above remain unchanged. No production repair was made
to other owners' files. Environment remains Linux/Node 24.19.0/UID 0; no fixture
blocker or setuid workaround occurred. These temporary native SQLite tests do
not qualify restore-candidate WAL capture, providers, infrastructure or product
gates. No dependency changes, remote fetch/push, CI, provider IO, nested executor
or background routine. Fixture databases are closed by test cleanup. Requested
Astra/High remains distinct from effective runtime settings, which are unverified.
