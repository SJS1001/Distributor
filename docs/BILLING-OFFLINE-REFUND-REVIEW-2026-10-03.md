# Billing-owned offline failed-refund review facts — 2026-10-03

Base: `c217e9022a678a4577339ed93784f4227ead0095`. This standalone prerequisite
changes only `src/server/billing-refunds.ts`, its new dedicated test, and this
report. Previous consumer/repair commits and other owners' work are preserved.
No application/API wiring, schema, phase authorization or restore consumer changes
are included.

## Public owning contract

```ts
app.database.transaction(() =>
  app.billing.refunds.reviewOfflineFailedRefundInTransaction(
    nativeFinanceActor,
    refundId,
  ),
);
```

The method requires an already active native writer transaction, re-reads current
IAM finance/admin staff authority and password restrictions, scopes the exact
refund/invoice/payment/customer organization and currency, and returns exported
`OfflineFailedRefundReview`. The return type is recursively readonly and the
runtime result is a detached, recursively frozen clone. A second invocation
reads actual current/uncommitted native facts on that same connection. There is
no clock, claim, native revision or mutation in the projection.

The body has these exact top-level fields:

- `version: 1`, `orgId`, `region`, `currency`.
- `refund`, `invoice`, `originalPayment`: complete retained native Billing rows,
  with original database column names. The original payment is the native
  payment row and separately binds its Stripe `pi_` identity.
- `intent`: existing `RefundIntent` fields `refundId`, `invoiceId`, `paymentId`
  (Stripe ID), `paymentAmount`, `amount`, `currency` (lowercase).
- `invoiceLines`, `credits`, `creditLines`, `payments`, `refunds`: complete
  related invoice funding/capacity facts, not a public page.
- `providerMappings`, `observations`, `manualProofs`, `notices`, `noticeUpdates`,
  `noticeReads`: all retained rows for every related refund, with native IDs,
  revisions, status/application flags, timestamps and source markers preserved.
  Read rows are the acknowledgements the native table actually retains; earlier
  overwritten acknowledgements are not invented.
- `capacity`: `credited`, `paid`, `refunded`, `balance`,
  `pendingReservations`, `invoiceAvailable`, `originalPaymentReserved`,
  `originalPaymentAvailable`.
- `factsHash`: SHA256 of `canonical(body)` with only `factsHash` omitted.
  It binds all the above facts, complete retained histories and derived capacity.
  There is no separately truncated history or cached observation in that hash.

A future comparator can import `OfflineFailedRefundReview` directly without
introducing a reverse dependency on its own types. Original database rows remain
unchanged. Fresh principals and external maintenance/recovery authority remain
responsibilities of the composition calling this owning reader.

## Native validity is not first-slice eligibility

This first bounded reader requires an existing **unknown Stripe refund** on a
native shipment invoice. Related payments/refunds support the current native
Stripe/manual families. Imported opening-balance documents/lines and unsupported
payment families are explicitly refused, because excluding their source facts
would misstate capacity. Supporting imported source balances needs a separately
reviewed complete projection, not a fallback to zero historical amounts.

An unknown refund with consistent earlier pending/requires-action observations
can be returned with its full history. Therefore a successful read does **not**
assert the proposed first offline slice is eligible. Integration must separately
require the original unknown effect, exact payload/provider/account binding,
absence of earlier provider observations for that slice, and the appropriate
poll, callback, dependent QuickBooks and other effect lineage. The returned
Billing histories allow the comparator to distinguish an empty history from a
valid nonempty one. There are no `allowed`, `qualified`, `eligible` or import
permission flags.

Platform retains command receipts and historical author evidence; this reader
does not access them. It reads no Integration or Platform table, no provider SDK,
network or filesystem, and emits no command, event, audit or receipt. Its only
non-Billing reads use the existing IAM owning interfaces to refresh scope.
Normal refund methods and the recovery hold remain unchanged.

A native fact hash establishes repeatable comparison of retained facts, not
historical authenticity or newly verified Stripe truth. Coherently rewritten
facts require comparison with independent retained intent/command/source evidence;
a Billing-only read cannot authenticate their past. It does not prove cutoff,
fencing, final provider failure, activation authority or permission to release a
reservation. No offline observation/import or refund mutation is implemented.

## Completeness, bounds and invariants

The reads include related refunds by both invoice and native payment lineage,
and credit lines by both credit and invoice-line lineage. Unscoped identity reads
are validated against the owning organization rather than silently hiding a
wrong-org linked row. All relevant child histories are then read for the full
related refund set. Ordering is deterministic by native IDs/revisions.

`offlineRefundReviewLimits` exports fixed immutable bounds: 1,000 rows per set
and 1,048,576 UTF-8 bytes. Each query fetches at most the limit plus a sentinel;
a sentinel refuses the whole projection instead of returning a page. Both
aggregate read bytes and final canonical body bytes are checked. Oversize facts
raise `OFFLINE_REFUND_REVIEW_LIMIT`. Malformed or unsupported native facts raise
`OFFLINE_REFUND_REVIEW` (ordinary current-authority/not-found errors retain their
existing meaning). No caller option can expand the bounds.

Validation reuses native `get`, `intent`, `recordedPayment`, `recordedCredit` and
`totals`, with complete raw-row checks around their existing projections:

- Invoice lines reconcile net/tax/total. Credit originals and cumulative line
  quantities conserve invoiced quantities. Payments/refunds bind exact invoice,
  organization, original payment, amount and supported provider identities.
- Completed refunds alone reduce cash credit. Pending/unknown refunds reserve
  invoice availability; every non-rejected refund consumes its original payment
  capacity. Safe integer totals and per-payment caps must agree with Billing's
  current aggregate totals.
- Stripe mappings and complete observations replay the native applied/ignored
  status ordering, including ignored pending after success and later action or
  terminal failure. Current refund state must agree. Stripe/manual proofs cannot
  substitute for one another; completed manual refunds retain their exact proof.
- Notices match applied exception transitions, contiguous updates and retained
  acknowledgements. Existing-state initialization is explicitly retained as that
  source, using a consistent suffix of native transitions; it is not represented
  as a newly observed provider result. Missing/mismatched history fails closed.

## Foreground verification

Linux, Node 24.19.0, UID 0, with the existing installed dependencies reused.
Effective model/effort settings are not exposed; requested Astra/High remains
unverified. The unavailable canonical path was not fabricated, and no nested
agent, runner, CI, provider I/O, publication or reminder was used.

```sh
node --import tsx --test tests/billing-offline-refund-review.test.ts
node --import tsx --test tests/billing-authority.test.ts tests/refunds.test.ts tests/refund-history.test.ts tests/refund-notices.test.ts tests/refund-callbacks.test.ts tests/payment-history.test.ts tests/accounting-refunds.test.ts tests/accounting-credits.test.ts tests/accounting-payments.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/prettier --check src/server/billing-refunds.ts tests/billing-offline-refund-review.test.ts docs/BILLING-OFFLINE-REFUND-REVIEW-2026-10-03.md
git diff --check
```

- Dedicated final checks: **15/15 pass**. Native invoice/payment/credit/refund
  commands create CA/CAD, CA/USD and US/USD fixtures, with reporting enabled and
  disabled. A synthetic in-memory transport throws to retain the actual native
  unknown refund/effect; no external provider is contacted. Tests cover current
  authority withdrawal/role/password/tenant scope, same-writer uncommitted reads
  and rollback, all funding/reservation invariants, complete history beyond a
  UI page, tamper, detached immutability, exact hash, notice replay, bounds,
  explicit opening refusal, unchanged Billing rows and Billing/IAM-only reads.
- Affected existing billing/refund/native accounting regressions: **114/114
  pass**. SDK/HTTP tests are existing synthetic fixtures, not provider qualification.
- TypeScript, assigned formatting and diff whitespace checks pass.
- Initial fixture failures remain recorded: the first ten tests expected a lost
  response to return a record, while the native refund API actually rejects and
  retains unknown state; the fixture now asserts both. A later opening fixture
  supplied 16 rather than 15 SQL values, and a legacy notice fixture retained
  its original notice creation timestamp rather than the documented bootstrap
  timestamp. Those two fixture details were corrected without weakening target
  assertions. Intermediate runs were 10/10, then two separate 13/14 runs, then
  14/14 before the final owner-access test brought the suite to 15/15.

No candidate capture/activation suite was needed for this Billing-only reader;
there is no new WAL/private-byte exception or workaround. Root's final offline
comparison, external evidence qualification, maintenance/phase authority,
provider outcomes, infrastructure and product acceptance remain unverified.

Retained synthetic logs:

- Final dedicated SHA256:
  `9666dbb6742f375fe074be4a3d88ce1c14cc27762121f5b63b920c162948bea1`.
- Existing 114-test regressions SHA256:
  `8bbbd7d06a9aa469f08ead6aa9405e8dcbb89c7309bf1d8c08d3560ea7e9574c`.
- Initial fixture failure SHA256:
  `61eaa3d65405cc8b1869c9dc24aca5dc4f9a30c22f7809803e243c2de5f53d6c`.
- Opening fixture failure SHA256:
  `6462467cbafe9b3a6f9487eee096aacf7d265ea9fd3bb6a19ad4adf5cb402b98`.
- Legacy fixture failure SHA256:
  `31893ae614a82cda53473feb37cda933a5a33e4c08d9165ec8d4430918cf1e37`.

## Root integration replay

The [local Billing receipt](evidence/LOCAL-BILLING-OFFLINE-REVIEW-2026-10-03.md) records exact transfer and tested hashes, the separate 143/143 workstation result and resource-bound limitations. Cloud outcomes above remain historical. This read-only prerequisite confers no mutation, first-slice eligibility or verified product gate.
