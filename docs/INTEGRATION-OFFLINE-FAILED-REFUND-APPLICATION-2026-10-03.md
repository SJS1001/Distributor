# Integration failed-refund application: confirmed prerequisite gap

Date: 2026-10-03. Exact excluded public baseline:
`072086fe84588f7a6b59aed23296ad22c9f9f4bb` (published code parent `1fb2ab3d337a8f8ed10f3734ba80e6f0d22e13ff`),
tree `412d5ff5056254f11cd88552fb572e96f80185b4`.

**The requested writer is not implemented.** The assignment explicitly requires
preserving every completeness-unavailable blocker and permits a concrete gap
report if the missing contract prevents safe coding. At this baseline, a valid
first-unknown refund always has three such blockers. The allowed primitive
input and Database/Identity/Billing constructor do not supply a verified way to
discharge them. An allowlist that treats those blockers as eligibility would
weaken the specified refusal. No such allowlist, stub writer, dead mutation
branch or fabricated authority token is delivered.

This delivery contains only this report and the new
[native gap tests](../tests/integration-offline-failed-refund-application.test.ts).
`src/server/integration-offline-failed-refund-application.ts` is intentionally
absent. No existing source/test/schema/owner guard changed. Prior deliveries and
other owners’ work remain preserved. This is the assignment’s missing-contract
exception to the requested three-file implementation, not a passing import claim.

## Verified setup and model scope

Created a fresh isolated checkout using source Git objects and read-only approved
public GitHub commit/tree/blob retrieval. Every fetched blob/tree hash and exact
commit bytes were verified; HEAD matched the excluded baseline and was clean
before analysis. No private runtime data or private local artifact was copied
into the checkout. AGENTS, README, PLAN, DECISIONS and current HANDOFF were read.
The explicit current assignment supersedes HANDOFF’s stale batch-only stop.

Requested model/effort: gpt-6-astra/high per the canonical owner rule. Launcher
controls/effective runtime settings are unavailable and are not claimed verified.
No nested session, CI, workflow, push, PR, deployment, provider IO or monitoring
routine was started. Existing focused tests use synthetic transports only.

## Exact missing contract

The current [Integration owner review](../src/server/integration-offline-refund-review.ts)
constructs these blockers unconditionally at lines 732–736. It hashes them as
part of the complete returned facts at lines 785–801.

| Blocker                                  | What exists now                                                                                                                                                                                      | What the writer still needs                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BILLING_COMPLETE_HISTORY_REQUIRED`      | Billing’s complete read-only task now exists at billing-refunds.ts:345. Integration’s review still uses get/intent/accountingFact at :190–196.                                                       | Invoke the actual complete Billing task in the same writer, bind its hash and zero target history to the exact intent before any Integration write. This dependency can be implemented within the allowed Billing constructor; it is no longer missing code. Its mere prior invocation does not mutate or clear the Integration blocker.                     |
| `PLATFORM_RECEIPT_HISTORY_REQUIRED`      | The actual PlatformOfflineRefundReviewReader.getInTransaction exists at platform-offline-refund-review.ts:115 and is composed by Application.                                                        | Root must explicitly bind the current complete request/queue/audit projection to this operation. The requested constructor has no actual Platform owner dependency, and primitive requestId/binding/hash strings cannot replace its projection. Do not read Platform SQL from Integration or invent a caller callback.                                       |
| `INBOX_UNATTRIBUTED_HISTORY_UNAVAILABLE` | Integration inbox retains provider/event/hash/time, without org/effect columns (integration.ts:157). The review only selects inbox rows attributable through selected callback event IDs (:373–393). | Independently qualified source interval/account/event completeness and an explicit root-owned contract for applying that qualification to this exact candidate/refund. Empty selected arrays or matching hashes cannot establish absence/completeness of unlinked history. There is no such validated discharge input in this assignment’s primitive record. |

The [private-byte helper](../src/server/restore-offline-private-evidence.ts)
exports a summary with `qualification: "unverified"` at :157–164 and returns it
unchanged at :308–316. Its fixed comparator supplies historical consistency;
it does not authenticate issuer, exhaustive history or provider finality.

The [commit guard](../src/server/restore-offline-commit-guard.ts):24–51 specifies
a separately qualified authority/revocation/source/candidate interlock. Its
static host operation must perform all other evidence/IAM/owner checks. It does
not supply a typed historical completeness decision or make a caller’s evidence
hash qualified. Current source fencing and historical source completeness are
different requirements. This report does not duplicate or invent the separately
owned common security design.

## Native reproductions and retained-lineage distinction

The new file-backed tests independently prepare a native invoice, Stripe payment,
credit, refund and queued Integration effect. A guarded synthetic transport throws
a lost-response error; no provider is called. Native Billing and Integration
remain unknown with a null poll claim, no outcomes, no callbacks and no offline
provenance. The restored hold is retained.

1. CA/CAD, CA/USD and US/USD all return exactly the three inherent blockers.
   Calling actual complete Billing and Platform readers inside the same writer
   first produces valid owner projections and still does not clear those blockers.
2. Inserting an unattributed Stripe inbox row leaves the target review’s inbox
   empty and its entire hash unchanged. The row is retained, not erased or assigned
   to the target. The test does **not** claim that this event belongs to the refund;
   the inability to establish that attribution is the missing information.
3. An unlinked refund callback with a proposed failed `re_` identity, in either
   the same or another organization, also leaves the null-reference target’s hash
   unchanged. At :303–310 the current callback search uses the target’s already
   retained external reference; that is null for the required first import.
   A future writer must separately search the proposed incoming reference with
   bounded, owner-only queries, including orphan/cross-org records, and refuse
   collisions before its first write. This check would not resolve source completeness.
4. A coherent non-null poll claim adds `RETAINED_REFUND_CLAIM`; generic leases add
   `RETAINED_GENERIC_LEASES`. They do not replace inherent limitations. Rollback
   preserves the exact earlier review. Current role/password/org/account/active
   checks and the actual writer requirement remain effective.
5. An arbitrary canonical schema-19 record with a matching digest is accepted as
   retained storage but adds `RETAINED_OFFLINE_REFUND_IMPORT`. It does not complete
   an effect or grant qualification. Native append-only UPDATE/DELETE refusal is
   unchanged. Reopen retains the unknown state and original blockers.

The other existing extra blockers (:737–757) cover non-first state, retained
provider/manual outcomes, offline provenance, callback lineage, accounting,
checkout and balance histories. These are concrete retained facts requiring
refusal in the narrow subtype. They must never be reduced to the three inherent
limitations or cleared by old age, a string flag or an input digest.

## Bounded next implementation sequence for root

1. Specify the common qualified source-completeness boundary and the permitted
   way for the static root operation to discharge each inherent dependency. Bind
   it to exact organization/account, Stripe scope, source interval, candidate
   generation, private evidence identity, current native owner hashes, immutable
   request/queue lineage and proposed provider outcome. Its lifetime must extend
   through the existing qualified guard’s COMMIT. This is a contract requirement,
   not a proposed `qualified: true` flag, generic registry or new credential.
2. Explicitly decide composition of the existing Platform and Billing native
   readers. Root may revise this assignment’s fixed constructor or keep a truly
   inaccessible writer inside a reviewed static root composition; an exported
   primitive-only method cannot silently consume an out-of-band assertion as
   verification. Resolve that design with the active common security owner before
   assigning mutation, without edits in this lane to shared code.
3. Once the contract is supplied, capture a fixed primitive record with exact
   expected org/account/region/currency, effect/refund/invoice/native payment and
   Stripe payment identities, both amounts, failed `re_` result and the three
   provenance identifiers. Reject proxies before reflection, accessors, symbols,
   extra keys and oversized primitives. Hashes remain lowercase64 consistency
   bindings, never authority. Avoid arbitrary JSON/provider payload inputs.
4. Run the fresh Integration and required other-owner reviews before writes while
   Billing is still unknown. Check the qualified discharge against the exact
   inherent profile and refuse every additional retained blocker. Preflight the
   proposed reference and request/binding uniqueness, including unlinked native
   histories. Do not infer qualification from schema-19 row presence.
5. Perform exact effect/poll CAS, then insert one fixed versioned canonical
   provenance record (at most 65,536 UTF-8 bytes) binding org/effect/refund/
   reference/review/evidence/outcome/request/binding. Retain exact original effect
   and poll facts needed to explain the transition; do not retire any claim.
   Export the agreed record/receipt types only once this callable contract is
   established. Root then invokes the existing separate Billing application in
   the same outer writer; every error must abort that writer.
6. Test successful first import and every requested refusal, post-write fault,
   conservation, repeated-call refusal and reopen recovery against the real
   schema19. Extend these gap tests rather than deleting their limitations or
   changing their meaning. Root separately owns durable common receipts/replay.

Ordinary [IntegrationRefunds](../src/server/integration-refunds.ts):171–215 calls
Billing first, stores `canonical({ ...result.result, status })`, marks the effect
completed, clears error, emits its ordinary event, and clears the poll token/time
with retry_at set to current time plus 30,000. Its terminal polling query at :267
only selects pending/requires_action. The new offline ordering explicitly reverses
the owner calls under one transaction and excludes Platform events. A future
writer must preserve the ordinary failed result’s exact native identities and
retain honest poll semantics; it must not quietly invent a different result,
claim a retired lease or use a no-op Billing observation to manufacture history.

Schema19’s [fixed DDL](../src/server/integration-offline-refund-schema.ts):4–24
already supplies bounded append-only storage and uniqueness. No schema addition
is justified by this gap report. Storage does not validate a semantic provenance
record, prove external outcomes or supply the missing qualification contract.

## Actual verification and delivery limits

Environment: Node v24.19.0, Linux x64, SQLite 3.53.3. Initial new gap suite:
10/10 passed, exit 0, 2,945.180944 ms. Final focused suite: **208/208 passed**, exit
0, zero failures/cancellations/skips/todos, 7,143.480583 ms. Complete TypeScript
and owned-file formatting pass. Existing source, tests and schema remain
byte-identical to the excluded baseline. No initial test/typecheck failure
occurred in this assignment; no failed receipt was discarded.

```sh
node --import tsx --test tests/integration-offline-failed-refund-application.test.ts tests/integration-offline-refund-review.test.ts tests/integration-offline-refund-review-boundary.test.ts tests/integration-offline-refund-provenance.test.ts tests/billing-offline-refund-review.test.ts tests/platform-offline-refund-review.test.ts tests/restore-offline-private-refund-parser.test.ts
node_modules/.bin/tsc --noEmit
node_modules/.bin/prettier --check tests/integration-offline-failed-refund-application.test.ts docs/INTEGRATION-OFFLINE-FAILED-REFUND-APPLICATION-2026-10-03.md
```

Private foreground receipt identities (logs remain outside tracked source):

| Receipt                       | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| int-application-gap-first.log | `ea6e766ac8dc02f34cb00be92b4281418840268f2c1cac3cd6e6d15e60bdc168` |
| int-application-gap-final.log | `81379b6bc6c6d7de044a26463ba27ce71c094079e955ebd38adeda362b8c8c00` |
| int-application-gap-type.log  | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

There is no application success, owner mutation, qualified provider/source truth,
common approval acceptance or product gate verified by these passes. Input
capture, writer CAS and post-write rollback tests for the requested new operation
remain unimplemented because the safe callable boundary is missing. The delivery
manifest gives the two-file commit, file hashes and exact excluded-base delta.
Root owns the next contract decision and monitoring; this bounded assignment ends
with that report and preserved refusal.
