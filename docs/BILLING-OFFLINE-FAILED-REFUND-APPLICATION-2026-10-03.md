# Billing first failed-refund native application prerequisite

Date: 2026-10-03. Exact excluded public base:
`bb0a2b2e9f6571fcd716ef9b9056e34fe40cf4ba`, tree
`060b2d6ccac1650508ae7a4dfb36f78661b43f99`.
Owned files: [billing-refunds.ts](../src/server/billing-refunds.ts),
[new native tests](../tests/billing-offline-failed-refund-application.test.ts)
and this report. No other production, test, schema, dependency or tracking file
is included. The earlier Fulfillment commit and delivery remain preserved.
Root’s announced Integration receipt/schema-19 work is excluded; these checks
use the actual published schema-18 baseline without guessing its next contract.

Requested model/effort: gpt-6-astra/high under the owner’s canonical delegated
model rule. Effective cloud model/effort is unavailable, not verified. Repository
AGENTS, README, PLAN, DECISIONS and current HANDOFF instructions were read.
No nested delegation, provider calls, CI/runners, public routes, Application
wiring, pushes, PRs, deployment or background monitoring were introduced.

## Exact internal API

The new method at billing-refunds.ts:910 is:

```ts
applyOfflineFailedRefundInTransaction(
  actor: Actor,
  refundId: string,
  expectedFactsHash: string,
  failed: OfflineFailedRefundTuple,
): OfflineFailedRefundApplicationReceipt
```

Both named types are exported. The tuple is a detached plain data record with
exactly these eight enumerable own data properties, no others:

```ts
{
  refundId: string;
  invoiceId: string;
  paymentId: string; // native intent's Stripe pi_ identity, not payment row ID
  paymentAmount: number; // complete original payment amount
  amount: number;
  currency: "cad" | "usd";
  externalReference: string; // exact re_ identity
  status: "failed";
}
```

Root must construct this narrow record after independent evidence qualification;
a provider/adapter payload with extra metadata or an effect ID is not this API.
There is no provider adapter argument, issuer field, approval flag, supplied
observation ID, sequence or caller timestamp.

The frozen flat return type is exactly:

```ts
{
  version: 1;
  refundId: string;
  observationId: number;
  applied: true;
  state: "rejected";
  status: "failed";
  noticeId: string;
  noticeSequence: number;
  noticeRevision: 1;
  noticeStatus: "failed";
  noticeState: "open";
}
```

`noticeId` is the refund ID, matching BillingRefundAlerts’ existing public notice
identity. `noticeSequence` is the exact numeric `billing_refund_alerts.seq`.
The fields are not interchangeable. `observationId` is the exact numeric native
`billing_refund_observations.id`. Every returned number is bounded to a positive
safe integer; the notice revision must be exactly 1. Native observation,
notice/update and audit timestamps continue to come from the unchanged native
operations. The result is an in-transaction receipt, not proof that COMMIT or
root’s durable receipt occurred.

## Native authority, consistency and transition

The method first requires Database.requireTransaction on the actual composed
writer. Input capture performs no writes, then Billing’s existing history reader
refreshes Identity, password restriction and staff authority. Native finance
permission is mandatory (existing admin override retained); a current account-bound
principal is refused. Supplied actor role/account assertions cannot replace the
persisted actor. There is no conversion of external signed finance identities
into native Actors.

The complete bounded `reviewOfflineFailedRefundInTransaction` executes again in
the same writer, and its exact `factsHash` must match. That hash provides
consistency only. It is neither authority nor evidence provenance. Each intent
field is compared exactly against this fresh native result. The target must be
unknown with zero retained target provider mappings, observations, manual proofs,
notices, updates and reads. Coherent unrelated sibling refund history remains
in the complete review and its hash; it does not become target history. Any
changed sibling capacity or retained facts invalidate the expected hash.

A separate fixed Billing-only existence check refuses reuse of the external
reference in provider mappings, observations or manual proofs, including orphan
rows outside the selected invoice. This check returns a fixed numeric sentinel,
never materializes those unrelated payloads, and never selects a newest row.
Provider-reference uniqueness is native organization scoped. A reference in a
different organization is not thereby authenticated or bound to a Stripe
account; root must independently establish actual account/provider scope.

The method then calls the **unchanged ordinary `observe` operation** (now :1178;
baseline :902) exactly once. Its ordinary return type remains RefundStatus.
The same native status transition inserts an applied failed observation, binds
the reference, changes unknown to rejected, creates failed/open notice revision
1 and preserves both existing notice and observation audits. Payment, original
credit, invoice and prior histories are not rewritten. No generic repair,
provider retransmission, Integration effect completion or foreign SQL is added.

After that transition, fixed Billing-owned count queries establish exactly one
target observation, mapping, notice and notice update, and zero proof/read rows
across all organizations. Exact predicates bind the sole observation to native
refund/org/reference/failed/applied, the notice to refund/org/invoice/failed/open/
revision 1, and its update to source `observation`. State/provider predicates
confirm rejected/failed. Only numeric identifiers are fetched. Any absence,
ambiguity or unsafe numeric identifier throws; there is no `MAX(id)`, ordering
heuristic, last-row guess or caller-supplied identity.

A second call refuses because native state/history changed. This operation has
no lost-response replay inference. Root’s independent durable receipt and
coordinator own replay and must match the exact owner receipt.

## Input and retained-data resource boundaries

The capture helper (:252) checks node:util.types.isProxy before reflection or
property access, including revoked proxies. Only ordinary Object.prototype or
null-prototype data records are accepted. Reflect.ownKeys must yield exactly
the eight expected string keys; symbol/nonenumerable/accessor/extra/missing
properties and custom prototypes are rejected. Descriptor values are copied
without invoking accessors. Nested objects, cycles, arrays, bigint, symbol and
proxy field values cannot satisfy the required primitive types and are never
traversed, cloned or serialized. Tests demonstrate zero proxy/getter invocation.

Refund/invoice/payment identities are bounded to 128 characters and UTF-8 bytes;
external identity to 160. Exact whitespace/NUL checks run without normalization.
Payment/reference syntax is `pi_`/`re_` followed by ASCII letters, digits or
underscores. Currency and failed status are exact literals. Both money fields
are positive safe integers, payment amount at most 10^12, refund no greater
than that original payment. String length is checked before byte counting.
The supplied facts hash must be exactly 64 lowercase hexadecimal characters.

No caller object reaches structuredClone, JSON serialization or canonical hashing.
The ordinary native operation receives only the frozen detached captured tuple.
The existing complete Billing review retains its independent SQL count/UTF-8
and aggregate limits (1,000 rows per set and 1 MiB), all existing lineage and
balance checks, and conservative unsupported-case refusals. No review bounds or
checks are loosened. JavaScript’s own-key enumeration and existing Identity
internals are not claimed to have a new constant-allocation resource limit.

## Transaction requirement and explicit unresolved dependencies

**Every thrown error must escape the caller’s Database.transaction callback.**
Database owns the actual outer writer and COMMIT. Its SQL authorizer forbids
owner transactions/savepoints; this implementation does not bypass that guard.
The supported exception path rolls back observation, mapping, refund state,
notice/update and both audits together, including errors after earlier writes.
An internal caller that catches a post-write error and commits anyway violates
this contract. There is no owner-local savepoint or transaction poisoning API
in this baseline. Root must preserve abort propagation across the complete
multi-owner mutation and guard. No claim is made that this method can prevent
a trusted caller from swallowing errors.

The operation is intentionally an internal prerequisite, callable with or
without a restored hold but never releasing it. Held provider transport remains
refused. It does not establish private evidence qualification, Stripe test/live
mode or account authenticity, common signed approvals, independent current
external authority, source/candidate fencing, root session CAS, offline phase,
commit-spanning trust or durable replay. Root must compose all those conditions
before adding any Application or public route caller. Native account/provider
facts and a matching untrusted factsHash cannot substitute for them. No product
gate, provider qualification or physical/financial-world truth is verified.

## Verification and preserved failures

Environment: Node v24.19.0, Linux x64, SQLite 3.53.3. A fresh isolated checkout
was populated using only approved public repository commit/tree/blob reads;
each fetched Git object hash and exact baseline HEAD were verified before
analysis. No prior checkout was overwritten.

Final source run: **174/174 passed**, zero failed/cancelled/skipped/todo, exit 0,
8,278.249842 ms. Includes 21 new file-backed native tests. New scenarios cover
CA/CAD, CA/USD, US/USD, exact non-initial IDs, same-writer role/password/org/staff
revocation, stale capacity and changed intent, collision/first-observation
refusal, input traps/resources, native count/byte limits, detached frozen data,
audit/native-write/absent-notice/ambiguous-observation rollback, outer rollback,
reopen, duplicate refusal, conservation and retained provider hold.

```sh
node --import tsx --test tests/billing-offline-failed-refund-application.test.ts tests/billing-offline-refund-review.test.ts tests/billing-offline-refund-review-boundary.test.ts tests/refunds.test.ts tests/refund-notices.test.ts tests/refund-history.test.ts tests/refund-callbacks.test.ts tests/accounting-refunds.test.ts
node_modules/.bin/tsc --noEmit
node_modules/.bin/prettier --check src/server/billing-refunds.ts tests/billing-offline-failed-refund-application.test.ts docs/BILLING-OFFLINE-FAILED-REFUND-APPLICATION-2026-10-03.md
```

Complete TypeScript and assigned formatting pass. Existing affected tests remain
unchanged; no assertion skips, timeout changes or shared-source repairs were
used. Pre-existing BillingRefunds code, including observe and DDL, is verified
byte-identical after removing only the declared additions.

Preserved foreground receipts outside tracked source:

| Receipt                              | Actual result                                                                                   | SHA-256                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| billing-application-type-first.log   | Exit 1: local assertion helper needed an explicit function declaration for TypeScript narrowing | `1411c38a1134fad6982aba0fd789108a6965684df26c03f9c6cca18522e3f958` |
| billing-application-first.log        | 8/19 pass, 11 fail, exit 1: attempted owner savepoint rejected by existing SQL authorizer       | `bf3fd9feee46b7b05fe1f819fb407644b71ecd0e51bff9204d3cf8de8e81c4c8` |
| billing-application-second.log       | 18/19 pass, exit 1: reopened fixture cleanup retained the original closed Application reference | `b99d5f50896003c75ee03ff9f67a015efe4234c4528bbe159dd2b5b8773e725b` |
| billing-application-regression.log   | 173/174 pass, exit 1: overflow fixture’s recursive CTE alias rejected by owner SQL authorizer   | `9887a1cbfec13a8f98749d8536567ca751d5f20325a718b5c04180c8bab304ea` |
| billing-application-final-source.log | 174/174 pass, exit 0                                                                            | `abe8e6e4a29178562f8024ef48ed499dedbb6fac6c4cb9c20d6247a4f492c071` |

The initial source/test pair is also retained as
`billing-application-savepoint-red.ts` SHA-256
`fbcecf1daddae53b8885ca1eea72ee515904de4f35495dd4fbbd67e0b388d86b`
and `billing-application-savepoint-red.test.ts` SHA-256
`e0ff7e8a9722c7b544db8ae478ba8ca659590805f26058049cbf1eb952e32f19`.
The speculative assertion that a caught error could safely commit was replaced
with the actual required outer-abort contract, not presented as implemented
savepoint protection. All five fault/conservation cases remain and now verify
full Database rollback. Fixture cleanup now updates the original fixture
object; the overflow test uses 1,001 fixed native inserts with the same count
refusal assertion, preserving the SQL authorizer.

Final commit identity, three file SHA-256 identities and exact binary-delta
raw/gzip/chunk hashes are supplied in the delivery manifest. That manifest is
outside the committed documents to avoid a self-referential commit hash. This
is bounded owner engineering evidence, not full-system or provider acceptance.
