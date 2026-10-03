# Independently settled native checkout review — 2026-10-03

Read-only prerequisite for accepted D-010/D-024/D-039. A new fixed
`IntegrationOfflineCheckoutReview.getSettledInTransaction(actor, effectId)`
composes the published Billing owner into the bounded unknown-checkout review.
It returns native consistency only. It does not grant import, retry, provider,
release or external maintenance authority. All product gates remain **NOT
VERIFIED**.

## Version and exclusive ownership

Excluded published baseline: `dd8517e9bf735b26be0854d3f785c845a374959f`, exact tree
`e8d0f29142973741e2082005e446b20d05977619`, schema 19. Exact tested source/test commit:
`1ce6db5b20d995e1e11d4570353d974413005224`. Closing commit adds only this report;
its exact SHA, final file hashes and raw/compressed/chunk hashes are in the
separately returned transfer manifest.

Only these paths change:

- [Existing Integration reader](../src/server/integration-offline-checkout-review.ts).
- [New settled-profile tests](../tests/integration-offline-settled-checkout-review.test.ts).
- This new report.

Original [zero-settlement tests](../tests/integration-offline-checkout-review.test.ts),
old reports, Billing reader/refund modules, schema, Application, private parsing,
shared composition and all other owners' files are byte-identical to baseline.
Root owns composition and publication. No other cloud parent was imported.

Normal public HTTPS fetch was policy-blocked. Authorized read-only GitHub Git
objects supplied the exact commit, full nontruncated recursive tree (1,318
entries) and 14 missing blobs. Blob sizes/SHA1, reconstructed tree identities and
raw commit SHA1 were verified before creating the isolated checkout. Existing
worktrees and prior deliveries were preserved; no push/remote merge occurred.

Requested model/reasoning: `gpt-6-astra/high`. Effective settings were not exposed
and remain **unverified**. The supplied canonical delegated boundary rule applies;
its macOS filesystem path is unavailable in this Linux environment.

## Fixed API and original-profile preservation

```ts
const reviews = new IntegrationOfflineCheckoutReview(
  database,
  identity,
  billing,
  integration.checkouts,
);
// The caller already holds this actual Database's native outer writer.
const facts = reviews.getSettledInTransaction(nativeFinanceActor, effectId);
```

Actual trusted same-connection owners are required; there is no public mode flag,
caller proof, SQL, parser, callback or generic reader port. The fixed method
constructs the actual `BillingOfflineCheckoutReview`. It calls no provider and
starts no owner transaction. It refreshes current native finance/admin staff
through `Identity.workerActor`, including active/password/tenant/no-account-scope
checks. Actor ID/org and effect ID are bounded primitives captured without
executing accessors, proxy traps or coercions. No external dossier identity is
converted to native authority.

A private capture helper shares existing structural checks. The original
`getInTransaction` selects its original branch and returns exactly the original
purpose, fields, totals, digest construction, empty allocation meaning and
refusals. In particular `OFFLINE_CHECKOUT_BILLING_HISTORY_REQUIRED` remains active
for any paid/credited/refunded invoice. Its original 60 tests are unchanged and
pass. The new entry point requires some native payment/credit/refund activity;
zero settlement stays on the original profile. No public caller can choose the
private profile switch.

The new purpose is
`integration-offline-independently-settled-checkout-native-review/v1`, with
`billingScope: complete-native-invoice-settlement-history`. The detached frozen
projection includes the existing exact unknown leaf, complete admitted renewal
chain, effects, observations, operation leases and related collections; the
complete Billing projection and its owning hash; monetary events and a
per-checkout original/current balance comparison. SHA256 binds its canonical
body excluding `factsHash`.

The legacy `allocationPayments` field is omitted from the new profile. Instead,
`accountingAllocations` is the actual complete retained Integration collection.
It is empty only after the fixed owning read proves absence in the admitted
profile; nonempty related allocation history refuses. Native payments are fully
present in `billingHistory.payments`, with their actual IDs, provider/external
references, amounts, invoice/account/currency bindings and associated credit,
refund, proof and notice history. They are not falsely labeled as payments
attributed to a checkout session.

## Supported financial and lineage cases

The admitted checkout remains an unknown current leaf. All predecessors retain
existing unsent-blocked or completed-expired-unpaid qualification, exact renewal
review hashes, original identity, current/successor invariants and complete
observations. Result and observation amounts now bind each checkout's immutable
payload amount, which can differ from the original invoice total after native
settlement. The original branch retains its original-total equality.

The Billing owner validates original invoice/line and credit conservation, exact
payment/refund/provider mapping/proof/notice closure, original payment capacity
and current invoice totals. The new Integration calculation then recomputes
monetary chronology from those same captured facts:

- Credits reduce balance at their native creation timestamps.
- Payments reduce balance at their native creation timestamps.
- Completed manual refunds increase balance at their retained bank-proof time.
- Applied Stripe refund observations entering `succeeded` increase balance;
  later applied departures reverse that increase. Ignored observations remain
  in complete Billing history and do not manufacture monetary events.

Integer sums use BigInt internally, then require exact safe-integer results. For
every checkout, the invoice original total plus monetary events strictly before
its creation must equal the immutable intent amount. Subsequent events must
reconcile that amount to the actual current Billing balance. Checkout creation
cannot predate the invoice, and a renewal successor cannot predate its
predecessor. These checks qualify retained consistency, not authenticity of
historical timestamps or provider observations.

Supported cases include CA/CAD, CA/USD and US/USD native invoices; manual or
independently Stripe-recorded partial payment before checkout; revised amounts
on unsent or expired/unpaid renewal; further payments and partial credits after
an unknown checkout; and coherent manual or Stripe-observed refund histories
that leave zero/negative current balances. A settled current balance does not
make an unknown checkout terminal or safe to retry. Native Stripe payment records
alone do not assert which checkout or external event produced them.

## Explicit retained refusals and exact wake inputs

| Case                                                                                              | Result and responsible next input                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any retained Stripe settlement inbox row                                                          | Original `OFFLINE_CHECKOUT_INBOX_HISTORY_REQUIRED`. Integration's current inbox stores provider/event ID, hash and time, but no event/payment preimage or scoped checkout/payment identity. A native owning same-writer attribution/comparison contract is required, with independently qualified external evidence where necessary. Root/Integration own that boundary. No global Stripe rows are silently dropped. |
| Related QuickBooks effects or payment allocations                                                 | `OFFLINE_CHECKOUT_ACCOUNTING_PROFILE_REQUIRED`. `integration_payment_allocations` is a QuickBooks cash-application ledger, **not a Stripe checkout/payment join**. Its complete parent invoice/payment/credit/refund/observation lineage needs a separate admitted owning accounting profile. This is an explicit unimplemented profile, not a claim that the underlying facts or every owning API are absent.       |
| Monetary event shares a checkout creation millisecond                                             | `OFFLINE_CHECKOUT_SETTLEMENT_ORDER_REQUIRED`. Native ISO timestamps alone do not order separate commands within that millisecond. An owning immutable order/creation-balance receipt would be needed to admit the ambiguity. No inferred ordering or tolerances are used.                                                                                                                                            |
| Opening/imported invoice                                                                          | Billing's existing `OFFLINE_CHECKOUT_BILLING_OPENING_REQUIRED`; a complete owning historical settlement/capacity contract remains necessary. Opening snapshots are not assumed to have empty history.                                                                                                                                                                                                                |
| Other related Integration refund/accounting descendants, completed callbacks or unsupported chain | Existing conservative profile/refusal checks remain. No dependent work is marked settled or removed.                                                                                                                                                                                                                                                                                                                 |
| Damaged, copied, orphan, out-of-scope or oversized rows                                           | Fixed read/integrity/limit refusal. Related allocation reverse closure additionally follows exact Billing payment IDs, including foreign-org or different-invoice/effect copies.                                                                                                                                                                                                                                     |

The tests reproduce the first gap using actual `Integration.stripeSettlement`
with a local synthetic verifier: Billing records the payment and Integration
retains its real inbox hash; the new read refuses. The QuickBooks profile test
uses actual `accounting`, native completion and `accountingPayment`, proving its
real allocation is preserved and refused. The timestamp-gap test uses actual
manual payment and fresh checkout commands at the same mocked native Date value,
without editing their stored rows. No generic external-proof permission is added.

## Resource, snapshot and lifetime controls

The original fixed whole-store Integration SQL preflight remains: 64 rows per
set, 512 total, 64 KiB field, 256 KiB row and 2 MiB conservative expanded-byte
budget. Numeric type/safe-integer and BLOB UTF-8 byte metadata precede retained
Integration row materialization. The Billing owner independently preflights all
of its fixed complete sets before any retained Billing row is read. Thus the
invoice identity can be discovered from bounded Integration facts without an
unbounded Billing scalar read. No foreign-table SQL is added.

The new profile additionally captures each Integration text column with an
internal same-read byte witness after the preflight, rejecting malformed UTF-8
that the native driver would otherwise replace. Witnesses are discarded and
never returned. The original zero-settlement branch's behavior is unchanged.
JSON byte/depth/node/canonical shape checks, full history, scope collisions and
latest-observation binding remain in force. No reflection/PRAGMA or caller SQL
is used by production.

Derived chronology is bounded by the admitted owner sets; the final combined
canonical projection is capped at 4 MiB. This final cap supplements the two
owners' pre-materialization budgets. The SQL guards bound captured data, not
arbitrary database scan CPU time. No page or cache proves completeness.

All reads execute within the actual caller-held native writer. Existing
`total_changes()` conservation remains checked; the new post-capture chronology
and hashing are pure operations on detached facts. Read-only review works under
a retained raw restore hold and does not alter it. It does not independently
qualify restore generation/source/fences/current external trust, and is not
wired to Application or a public route. A returned hash is historical consistency,
not reusable live authority.

## Exact foreground verification

Environment: Linux x64, UID 0; Node `v24.19.0`, OpenSSL `3.5.7`, SQLite `3.53.3`.
Existing isolated installed dependencies were reused through a temporary symlink;
no package/lock changes. No fixture server or background job was started.
Synthetic provider result/verifier functions only exercise native owner APIs;
no network, credential, actual provider or customer-data qualification occurred.
No WAL candidate-file guard was exercised or weakened in this assignment.

```sh
node --import tsx --test tests/integration-offline-settled-checkout-review.test.ts tests/integration-offline-checkout-review.test.ts
node --import tsx --test tests/billing-offline-checkout-review.test.ts tests/checkout-access.test.ts tests/checkout-current.test.ts tests/checkout-history-proof.test.ts tests/checkout-observations.test.ts tests/checkout-renewal.test.ts tests/refund-history.test.ts tests/refunds.test.ts
npm run typecheck
node_modules/.bin/prettier --check src/server/integration-offline-checkout-review.ts tests/integration-offline-settled-checkout-review.test.ts docs/INTEGRATION-OFFLINE-SETTLED-CHECKOUT-REVIEW-2026-10-03.md
git diff --check dd8517e9bf735b26be0854d3f785c845a374959f
```

Results: **110/110** focused (50 new + 60 unchanged original), 9,109.797521 ms;
**211/211** affected, 16,865.309351 ms. Both exit 0 with zero
failures/cancellations/skips/todos. Complete TypeScript, owned formatting and
whitespace checks pass. These are 321 distinct checks, not a full native/product
regression or actual provider qualification.

Focused cases cover changed balances and historical intent amounts; complete
native credits/refunds/proofs/observations; actual held writer and competing
writer lock; uncommitted native payment visibility and rollback/reopen; fresh
IAM/account/password/tenant refusal; hostile proxies/accessors; frozen detached
hashes; later history damage; reverse/foreign/orphan identities; full histories
beyond normal pages; numeric/UTF-8/NUL/count/aggregate limits before retained
materialization; malformed JSON; original refusal preservation; and the three
actual native unsupported-profile reproductions above.

Exact tested final source/test bytes:

| File                                                        | Bytes | SHA256                                                             |
| ----------------------------------------------------------- | ----: | ------------------------------------------------------------------ |
| `src/server/integration-offline-checkout-review.ts`         | 31740 | `4ce527e3e9f8d8e99583a59ccc8a2395db057eaa2302433601033c0354ef2335` |
| `tests/integration-offline-settled-checkout-review.test.ts` | 26123 | `66d71643bead1d0c0b68e2b6c21a21a7183d6a0dcce93dfcc393df49daee9ce3` |

### Retained failures and repairs

Initial dedicated run passed 24/24. Expanded run passed 46/49:

1. Real new-profile failure: a malformed SQLite `f09080` error string was
   replaced by the driver and accepted. The new branch now verifies exact
   same-read UTF-8 bytes; the original refusal assertion remains.
2. Real new-profile failure: checkout creation before the native invoice was
   accepted. The chronology now requires invoice/checkout ordering; the original
   refusal assertion remains. Renewal predecessor/successor ordering is also
   checked in the new profile.
3. Fixture failure: changing both operation-lease primary keys to one orphan
   violated uniqueness before exercising the reader. The fixture now changes
   one row; the orphan-refusal assertion is unchanged. Only this test fixture's
   corruption connection disables foreign keys; production authorizers remain.

Repaired 50-case new suite plus untouched 60-case original suite passed 110/110.
All TypeScript runs passed. No assertion was skipped or weakened. Retained
private scratch logs in `settled-checkout-evidence`:

| Log                            | SHA256                                                             |
| ------------------------------ | ------------------------------------------------------------------ |
| `focused-1.log` (24/24)        | `15ca6b8a394f4cba57452bde7e70a8e8cd33078a18ee2d0b9739a1c6e10690b6` |
| `focused-2.log` (46/49)        | `e0944e0339add1c6e245635deb0870bf1b9e118208d02591f4d67a09258d0150` |
| `focused-3.log` (110/110)      | `7676de946fea3c9c038e9f9e4d72c5b7a2dbe621416bdc3965fe6ce5550ce271` |
| `affected-final.log` (211/211) | `bb511a1a7242cd3e0d7f0405d00b350896172b581ddc1077d4918d5a0cf3df5d` |
| `typecheck-3.log`              | `561e0b64da9c027206b026047fea097e70b4e9f9488a41f2a7de084bcdd29e2b` |

Root must independently transfer, review and replay this exclusive-path patch,
then own any shared composition. No existing queue blocker, provider hold or
external qualification requirement is cleared by this return.
