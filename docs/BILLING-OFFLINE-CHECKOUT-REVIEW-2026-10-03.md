# Billing offline checkout native history review — 2026-10-03

Delivered prerequisite for accepted D-010/D-024/D-039: a complete, bounded,
read-only native invoice settlement projection. It supplies historical native
consistency, not provider truth, source completeness, import/retry permission,
external maintenance authority or restore release. Product gates remain
**NOT VERIFIED**.

## Exact ownership and version

Excluded baseline: `423800747358f18f9265259144bcd1e4828e067b`, tree
`0a49769a3ce06e2df5f8729efe2398f5a5d8d23b`, schema 19. Source/test commit:
`9de53f9d6939c8e3256d2f4073a06ec7cf01a5e3`. The closing commit adds only this
report; the transfer manifest supplies its exact SHA and all final file hashes.

Only three new paths belong to this return:

- [Billing reader](../src/server/billing-offline-checkout-review.ts)
- [Native tests](../tests/billing-offline-checkout-review.test.ts)
- This report.

The previous Integration checkout reader, its
`OFFLINE_CHECKOUT_BILLING_HISTORY_REQUIRED` refusal, all existing Billing/refund
files, original tests/reports/digests, Application, schema and shared composition
are unchanged. No other cloud parent was imported. Root owns later composition.

Normal HTTPS fetch of the exact public commit was blocked by network policy.
The authorized read-only GitHub connector supplied the exact public commit,
recursive tree (1,304 entries, not truncated) and 23 missing blobs. Blob byte
lengths/Git SHA1s, recursively reconstructed tree identities and raw commit
identity were verified before creating this isolated checkout. Existing
worktrees and deliveries were preserved. No remote write occurred.

Requested model/reasoning: `gpt-6-astra/high`. Effective runtime settings were not
exposed and are **unverified**. The supplied canonical boundary-selection rule
was followed; the macOS canonical rule path is unavailable in this Linux runtime.

## Internal API and admitted scope

```ts
const reviews = new BillingOfflineCheckoutReview(database, identity, billing);
// Existing caller-held native outer writer; do not start another owner transaction.
const result = reviews.getInTransaction(
  { id: nativeFinanceId, orgId },
  invoiceId,
);
```

Trusted application composition must supply the actual Database, Identity and
Billing belonging to the **same connection**. No generic SQL, caller facts,
completeness assertion, callback or configurable reader port is accepted. The
constructor does not create schema, perform recovery or wire a route.

`Database.requireTransaction()` precedes reading. Invoice identity is an exact
bounded primitive; only bounded own data-descriptor `id`/`orgId` values are copied
from the actor. Proxy detection, including revoked proxies, precedes reflection;
identity accessors/coercions never execute. Other historical Actor fields do not
supply authority. `Identity.workerActor` freshly checks active native principal,
scoped tenant/region, finance/admin staff, no customer scope and current password
policy inside that writer. Billing's public invariant readers repeat their
ordinary current checks. An external dossier identity cannot be used as an IAM
mapping or authorization grant here.

The projection contains:

- Exact native invoice and original lines; complete invoice credits and credit
  lines, including reverse identity links.
- Every invoice payment, associated refund and original payment relationship.
- Complete refund provider mappings, ordered observations (including ignored
  observations), manual bank proofs, notices, ordered notice updates and reads.
- Explicit empty sets where history is absent; opening document/line sets are
  empty **only in the admitted non-opening profile**.
- Organization, region, currency and account bindings from actual native IAM,
  recomputed current totals, aggregate pending/unknown refund reservations and
  each payment's completed/pending/unknown consumption and remaining capacity.

Unpaid, partially paid, fully paid and Stripe-overpaid invoices are represented.
Native manual and Stripe-recorded payments, partial/full credits, pending manual
refunds, completed manual proofs and coherent Stripe refund state histories are
represented. Stripe records are retained native facts; their presence is not an
independent verification of a Stripe transaction. Unsupported payment providers,
malformed identities, control characters in identifiers and inconsistent states
refuse. Bounded Unicode and multiline invoice descriptions/credit reasons retain
their exact text. There is no JSON column in this fixed returned Billing profile;
opening values are refused before any materialization or parsing.

### Identity closure and conservation

Selection is by original invoice and both directions of native relationships,
not paginated views or scoped inner joins that could erase copied rows. Related
foreign-org rows are captured internally and fail fixed scope checks. Same-org
rows with missing or foreign-org parents are conservatively included and then
refused, even if damage elsewhere prevents attributing that orphan to this
invoice. Related refund alerts also match the original invoice identity.
Cross-tenant provider/bank reference collisions refuse using numeric existence
queries; foreign values are not returned or placed in errors. Healthy unrelated
invoices are outside the admitted invoice closure.

Checks bind every line, credit, payment, refund and history row to its exact native
parent/org; credit quantities cannot exceed original sold quantities. Recomputed
line/credit money must agree with original native totals;
`Billing.recordedCredit` is invoked only after all underlying rows are bounded
and independently checked. Refund observations replay the existing applied and
terminal-status rules; mappings, refund state, notice transitions/revisions,
legacy `existing-state` suffixes and acknowledgments must agree. Nothing is
reconstructed as newly observed provider evidence.

`Billing.totals` is compared with complete native recomputation:
`balance = invoice.total - credited - paid + completedRefunds`.
Pending/unknown reservations must fit current invoice entitlement; completed plus
reserved refunds cannot exceed the original payment or invoice credit/overpayment
capacity. Rejected refunds consume no capacity. `invoiceAvailable` is remaining
refundable cash, clamped to zero for an unpaid invoice, and is **not** its open
receivable balance. The signed `balance` remains separately available. This new
purpose does not change any existing refund review digest or capacity contract.

### Refused opening profile

Any matching `billing_opening_documents` or `billing_opening_lines` row produces
`OFFLINE_CHECKOUT_BILLING_OPENING_REQUIRED` through numeric existence checks,
before retained opening text enters JavaScript. Imported historical
paid/credited/refunded snapshots do not supply the complete original settlement
and proof rows returned by this profile. A separate Billing-owned opening-history
contract, including historical capacity/identity evidence, is the explicit wake
input for admitting opening invoices. No zero-history claim is made for them.

## Resource and lifetime boundary

All 12 returned sets have fixed complete schema column lists. Before **any**
retained Billing row is read, every selected set passes numeric native SQL
preflights: at most 1,000 rows/set, 4,096 rows total, exact text/integer types,
nonnegative safe integers, 64 KiB per field and 128 KiB per row. SQL BLOB lengths
count actual UTF-8 bytes including bytes after embedded NUL. Six times raw bytes
plus fixed key/punctuation overhead is accumulated over **all** sets against a
2 MiB canonical-output budget, before decoding or serialization; a final exact
canonical byte check also applies. No rows are truncated. Limits are fixed,
exported and frozen, with no caller override. SQL work may scan retained tables;
these are capture/serialization limits, not a database CPU-time guarantee.

After that preflight, each text column is captured with a same-read native hex
witness. Exact UTF-8 round-trip equality rejects the SQLite driver's replacement
of malformed native byte sequences, including a truncated sequence whose decoded
replacement has the same byte length. Internal witnesses are discarded, never
returned. No second connection or independent snapshot is used.

The detached, deeply frozen result is purpose-hashed with
`billing.offline-checkout-native-history.v1`; `factsHash` is SHA256 of the native
canonical body excluding `factsHash`. Complete native history and computed totals
are included, so later changes require a fresh review. `total_changes()` must
remain identical. The result is historical data, not reusable current authority
or a freeze of the live database. No owner row, claim, clock, audit, revision,
provider state, restore hold or queue is mutated.

Fixed refusal codes are `OFFLINE_CHECKOUT_BILLING_REVIEW`,
`OFFLINE_CHECKOUT_BILLING_LIMIT` and the named opening-profile code. Existing
native transaction/IAM/account refusal codes are retained rather than remapped
into permissive outcomes. Error text contains no copied identifiers or raw facts.

## Foreground verification

Environment: Linux x64, UID 0, Node `v24.19.0`, OpenSSL `3.5.7`, SQLite `3.53.3`;
existing isolated repository dependencies, no package/lock changes. A temporary
local dependency symlink was used and removed before closing. No fixture server,
provider adapter, provider connection, external account or background job was
started. These tests use actual Application/native Billing commands and the
same SQLite writer, including actual native Stripe payment recording and refund
observation methods with **synthetic** inputs. They do not establish provider
truth or prove a provider response was obtained.

Commands (repository working directory):

```sh
node --import tsx --test tests/billing-offline-checkout-review.test.ts
npm run typecheck
node_modules/.bin/prettier --check src/server/billing-offline-checkout-review.ts tests/billing-offline-checkout-review.test.ts docs/BILLING-OFFLINE-CHECKOUT-REVIEW-2026-10-03.md
git diff --check 423800747358f18f9265259144bcd1e4828e067b
```

Final focused result: **96/96 pass**, zero failures/cancellations/skips/todos,
15,800.069389 ms, exit 0. Complete TypeScript exits 0. Assigned formatting and
whitespace checks pass. Source/test bytes tested are committed exactly at
`9de53f9d6939c8e3256d2f4073a06ec7cf01a5e3`:

| File                                            | Bytes | SHA256                                                             |
| ----------------------------------------------- | ----: | ------------------------------------------------------------------ |
| `src/server/billing-offline-checkout-review.ts` | 26286 | `857e9df62a0f487e92419f1edeb095e26f00a656789a7d9f2497f39494828a2c` |
| `tests/billing-offline-checkout-review.test.ts` | 28939 | `321c2723f62d157c07f180182d2c5b252a5e3cc77110cae408f72d4a07ba82b6` |

Coverage includes CA/CAD, CA/USD, US/USD; empty/partial/full settlement;
complete mixed refund and notice histories under restore hold; same-writer
uncommitted payment visibility, actual competing writer lock, rollback/reopen;
fresh revoked role/active/account/password/tenant checks; copied/orphan/changed
identities and provider reference collisions; all returned collections' UTF-8
bounds before retained materialization; unsafe native integers, row/set/aggregate
limits; malformed UTF-8; hostile identities; detached immutable copies; later
same-writer corruption refusal; and 32 payments/33 observations beyond normal
history pages. Budget tests intentionally corrupt native rows only as fixtures;
they do not loosen production authorizers.

Affected existing regressions, unchanged throughout this assignment:

```sh
node --import tsx --test tests/billing-authority.test.ts tests/refunds.test.ts tests/refund-history.test.ts tests/refund-notices.test.ts tests/billing-offline-refund-review.test.ts tests/billing-offline-refund-review-boundary.test.ts tests/billing-offline-failed-refund-application.test.ts tests/billing-offline-failed-refund-recovery.test.ts tests/integration-offline-checkout-review.test.ts tests/checkout-current.test.ts tests/checkout-history-proof.test.ts tests/checkout-renewal.test.ts
```

**279/279 pass**, zero failures/cancellations/skips/todos, 10,907.065734 ms,
exit 0. This ran before the final additive multiline-text support and four focused
cases; none of these existing files imports the new Billing reader, and their
production inputs remain byte-identical to baseline. Total distinct passing
checks are 375 across the final focused and affected runs, **not** a full-suite or
product-gate claim. No WAL/candidate-filesystem failure occurred: this assignment
does not exercise restore candidate preparation or qualifying WAL file metadata.
Root's native workstation replay and later composition remain required.

### Retained failed attempts and repairs

Logs are retained in the private scratch `billing-checkout-evidence` directory;
no existing assertion or historical receipt was removed.

1. The `tsx --test` launcher failed before executing tests: IPC socket `EPERM`.
   `node --import tsx --test` avoids that launcher socket without weakening tests.
2. Initial TypeScript rejected a conditional indexed type; the explicit readonly
   array element conditional repaired it. Later test instrumentation needed the
   existing Store generic return type, repaired without changing production.
3. Initial native run: 14/15 pass. The fixture expected
   `TRANSACTION_REQUIRED`; the actual established error is `TRANSACTION`.
4. Expanded run: 84/87 pass. One **real new-reader defect** omitted a local payment
   whose parent invoice existed under a foreign org. The original refusal
   assertion remains; orphan qualification now requires parent org as well as
   ID. Two fixture failures were repaired: an oversize update violated a unique
   refund-reference constraint (now targets one row), and recursive SQL was
   correctly denied by the native authorizer (now fixed inserts in a held writer).
   The repaired run passed 87/87.
5. Additional actual SQLite malformed UTF-8 tests: **0/2 pass**. Both `ff` and
   truncated `f09080` descriptions were silently decoded into replacement text
   and accepted. Same-read byte witnesses fixed this; both refusal assertions
   remain. Expanded run then passed 92/92; final additive coverage passed 96/96.

| Retained log                     | SHA256                                                             |
| -------------------------------- | ------------------------------------------------------------------ |
| `focused-initial.log` (launcher) | `5319c2f74b02dfe2805e2e09622ed1fa9ec5849ad504d4b67b47e88ff17bca92` |
| `focused-1.log` (14/15)          | `ccd0b620b92aa6c8b0454e66b7df9548067847e32890d0f754a4400393826bd8` |
| `focused-2.log` (84/87)          | `d35f07e220249893c10d1d39c36326d8818ee1ff76e91d6e097b04e3cfdc7ac6` |
| `utf8-red.log` (0/2)             | `a0f6836be446a66d3033b1eee3470edf56b1e2099f94cc618c0601b8fc9aa31c` |
| `focused-final.log` (96/96)      | `b147a1271f2219562ebd560fc228dca373afb22fddedac5b47b62501662593ed` |
| `affected-final.log` (279/279)   | `53357b536297a6bd66f1b2650534a307b8b60096881ea6e56681017664f31d90` |
| `typecheck-final.log`            | `561e0b64da9c027206b026047fea097e70b4e9f9488a41f2a7de084bcdd29e2b` |

Root must compose this projection with the separately reviewed Integration
checkout lineage and actual current trust/evidence/fences. This return changes no
existing refusal, enables no import and satisfies no external qualification gate.
