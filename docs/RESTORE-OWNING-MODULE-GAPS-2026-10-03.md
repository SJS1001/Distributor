# Restore owning-module gaps: independent investigation

Date: 2026-10-03. Repository: SJS1001/Distributor. Branch fetched: `codex/local-distributor-checkpoint`. Exact clean clone HEAD before analysis: `c006b554351ad4280f6329a1ec872717962f839d`. All source line references below bind that baseline, not a later working tree.

This is a bounded code investigation and implementation brief, not product acceptance, provider qualification or permission to activate. No production code, tests, dependencies, schemas or tracking documents were edited. No nested session, runner, provider request or publication was started. Effective model/effort is not exposed by this runtime; requested Astra/High is not a verified configuration.

## Conclusion and next assignment

Independent gaps are confirmed by source inspection. Start with **eligibility compatibility for already retained native cancellation/supersession**, then implement separately reviewed offline evidence intake in the owning integration, carrier and journal modules. Inventory's specific finance corrections also lack a hold-compatible path; coordinate with the incumbent quantity owner before assignment. Do not implement a generic restore repair endpoint or remove provider fences.

Two eligibility mismatches were reproduced with in-memory SQLite and source-derived predicates: (1) a natively canceled Canada Post group leaves inactive pending members that still block preparation; (2) a retained locally canceled/superseded integration effect in `blocked` state still blocks preparation. These are two successful predicate demonstrations of the problem, **not** executed native workflow or full restore tests. Proposed native red/green tests are in the companion plan.

## Gate and timing

`src/server/restore-activation.ts:334-389` checks every organization's copied queues under the candidate writer lock. Its terminal sets are:

| Owning integration records | Allowed by prepare |
| --- | --- |
| Effects | completed, rejected |
| Checkout and refund callbacks | completed |
| Ordinary bookings | booked, canceled |
| Canada Post groups / members | transmitted or canceled / created |
| Stock journals | posted, cancelled, rejected |
| Customer and organization credential revocations | confirmed, released |
| Customer and organization OAuth attempts | completed, canceled, denied, expired |
| Operation leases, balance reads, refund polls | token must be null |

`src/server/platform.ts:69-85` closes provider access while restored. `Platform.command` checks release-command access before cached authorization (`platform.ts:98-120`). Before any unresolved release exists, native offline commands remain possible: `restore-activation.ts:623-631` accepts absence of a current release. After prepare, a held/failed/pending release blocks those commands too. For forward recovery, use the existing supersession lifecycle and fresh capture; do not add a command exception for a signed but stale dossier. See `docs/RESTORE-ACTIVATION.md`, prepare steps 2-5 and forward recovery; `restore-activation.ts:695-738` retains supersession controls.

Recovery hold is not a universal write freeze before preparation. Inventory, billing and identity changes can change the eventual candidate hash. All reconciliation must finish before final capture; old signatures cannot bless later changes. A local terminal state also does not prove the source performed no post-cutoff external operation.

## Confirmed gaps and counterexamples

### G1: existing terminal business dispositions fail raw queue eligibility

* `carrier-bookings.ts:750-825`: `cancelCanadaPostGroup` allows only wholly unsent/unclaimed groups; retains canceled group history and sets member `active=0`, without changing member `state='pending'`. Prepare checks all members, including inactive ones (`restore-activation.ts:346-364`). Member DDL permits only pending/creating/unknown/created (`canada-post-schema.ts:11-15`). Ordinary booking cancellation is available after removing active group membership (`carrier-bookings.ts:2042-2083`); canceling those bookings still leaves the inactive member blocker. This is **not a missing group-cancel command**.
* `integration.ts:1064-1161`: independently reviewed unsent credit-application cancellation retains a permanent receipt and leaves transport `blocked`; only the receipt releases capacity, not the blocked state. `integration.ts:617-703` also leaves an unsent replaced checkout `blocked` and retains its renewal lineage. Prepare rejects both (`restore-activation.ts:341,364`). Blanket acceptance of blocked effects would admit unrelated permission failures and uncertainty. This is **not a missing ordinary credit-cancel or checkout-renew command**. Credit cancellation deliberately refuses restored pending snapshots (`integration.ts:1053,1082-1083`); its existing pre-cutoff receipt remains useful evidence.

Resolve eligibility using verified owning-module dispositions, not invented successful transport. A cancellation in a restored pending snapshot requires independent full-interval source/fence evidence before it can support release, even when a local cancel command exists.

### G2: provider effects and financial callbacks lack bounded offline recovery intake

`Integration.reconcile` dispatches to `IntegrationOperations.run` or `IntegrationRefunds.run` (`integration.ts:1591-1594`). Both require provider access before lookup and before applying results (`integration-operations.ts:94,215`; `integration-refunds.ts:52-56,156`). A synthetic adapter is not an authorized way around this gate. Pending effects cannot use the unknown-only general lookup branch (`integration-operations.ts:113-124`); post-cutoff results may nevertheless exist for a snapshot still pending.

Checkout callbacks require gated claim/retry and gated settlement verification (`integration.ts:451-473,503-525,1596-1669`). Refund callbacks require gated run/retry (`integration-refund-callbacks.ts:189-224,257-277`). Stale recovery merely changes processing to waiting and clears claims (`integration.ts:1551-1578`); it does not settle any external truth. No task-shaped offline evidence command binds the copied effect/callback and recovery generation to independently verified outcome and the native financial receipt.

Billing primitives already exist: `verifiedPayment` deduplicates provider reference (`billing.ts:762-808`); `BillingRefunds.observe` validates refund/payment/amount/currency/reference and retains status history (`billing-refunds.ts:159-248`). They are lower-level trusted operations, not an externally evidenced recovery interface. Do not call them directly from a generic restore proxy. A manual payment (`billing.ts:809-839`) uses provider `manual`; using it to relabel a Stripe settlement would discard canonical duplicate identity. Opening-document import creates another invoice rather than repairing an existing provider effect (`billing-opening.ts:228-316`). Neither is a substitute.

### G3: uncertain carrier outcomes have no offline owning intake

Ordinary reconcile requires `assertNative -> ready -> assertProviderAccess` before lookup (`carrier-bookings.ts:2091-2138,2207-2216,1897-1916`). Canada Post member reconciliation calls `assertCanadaPostNative`; manifest reconciliation builds a readiness-checked native snapshot (`carrier-bookings.ts:905-982,843-874,1313-1375,1169-1238`). Those paths enforce the same hold through native readiness. The existing clients are provider/test transport interfaces, not private independently obtained evidence intake.

Existing claim review/release and stale recovery are useful offline stopping operations (`carrier-bookings.ts:1599-1730,2235-2248,1125-1147,1521-1532`): they preserve unknown outcomes and prevent late same-file claims from committing. They cannot turn unknown into booked/created/transmitted/canceled. Existing `cancel`/`cancelCanadaPostGroup` handle only genuinely unclaimed unsent native states. No offline result import binds carrier/account/configuration, exact intent, label bytes and hash, member/group identity, or final non-creation evidence to a recovery generation. Native packed-stock ordering and separate physical dispatch must remain intact.

### G4: journal recovery only covers a subset of final non-posting cases

Existing original-journal final cancellation **does** work offline before release preparation: `stock-journal-delivery.ts:2205-2421` retains exact final non-posting/prevention evidence and requires a different finance reviewer. Its test explicitly exercises isolation (`tests/stock-journal-original-cancellation.test.ts:168-206`). No duplicate operation is needed for an unknown original with complete native history and valid final proof.

Other cases remain blocked: claim/lookup requires provider access (`stock-journal-delivery.ts:1586-1669`); posted observation requires a native in-memory lease and current provider authority (`stock-journal-delivery.ts:1676-1718,1760-1822`). A copied running lease cannot be represented by the new process's WeakSet (`stock-journal-delivery.ts:129,1824-1859`). There is no restored-lease retirement command or separately reviewed offline posted-observation command. Ready/pending journals cannot simply be rejected through the ordinary decision path under hold (`stock-journal-delivery.ts:661-681`).

Correction-journal cancellation consumes owning correction outcome evidence (`stock-journal-delivery.ts:2423-2494`), but adding that outcome itself is gated (`cost-corrections.ts:1392-1402`); existing pre-cutoff final evidence remains usable, newly obtained proof cannot enter through that operation under hold. Original packet acceptance and reconciliation are also gated (`integration-costs.ts:750-764,893-940`); a report can document external truth but must not falsely label a native packet accepted. Reversal-before-replacement, exact retry ancestry, permanent references and immutable final outcomes remain requirements, not obstacles to remove.

### G5: specific stock error/value correction differences lack offline finance workflow

Bulk quantity-error preparation/decision are gated (`inventory-quantity-corrections.ts:234-242,506-514`), including cached attempts as explicitly tested (`tests/inventory-quantity-corrections.test.ts:177-253`). Carrying-value policy/preparation/decision are gated (`inventory-valuations.ts:249-257,416-424,635-643`). Thus a confirmed post-cutoff quantity error tied to an original movement, or a carrying-value-only adjustment, cannot use those finance workflows before release. Existing native count, serial custody and transfers are available for their own meanings (`inventory.ts:1320-1389,1601-1919,1922-2137,2745-3304`). A fresh physical count is not proof of a historical quantity-entry error, and it cannot stand in for a value-only adjustment. This is a separate recovery contract for those operations, not missing count/transfer functionality. Preserve the incumbent quantity implementation and its ordinary hold refusals.

## Existing operations and evidence that are not new code gaps

| Area | Existing behavior; boundary |
| --- | --- |
| Identity/security | Restore invalidates copied sessions/MFA recovery and OAuth attempts, disables copied credential material (`recovery.ts:338-345`; `iam.ts:513-517`; `provider-credentials.ts:835-847`). Current user/grant/reset/session commands exist (`iam.ts:772-1024`). Independent post-cutoff revocation/user authority must still be obtained; copied accounts cannot vouch for current trust. |
| Credential revocation | Customer and organization offline reviews keep disabled credentials, explicit confirmed/unconfirmed outcomes and retained evidence (`quickbooks-revocation.ts:318-375`; `organization-revocation.ts:401-466`). Their offline authority checks omit outbound provider access (`quickbooks-revocation.ts:49-64`; `organization-revocation.ts:92-105`). Do not invent upstream confirmation from local disable. |
| Disposable claims | Operation/balance/refund-poll stale recovery already clears expired tokens (`integration-operations.ts:44-61`; `integration-accounting-balances.ts:149-157`; `integration-refunds.ts:248-260`). Claim retirement is not settled money. Do not add a duplicate generic claim-resetter. |
| Stock/migration | Native receipt, relocation, inspection, counts, transfer loss/found custody and reviewed opening/master/document imports exist (`procurement.ts:681-767`; `inventory.ts:914-1111,1113-1318`; `migration.ts:258-380`; `master-imports.ts:237-408`; `document-imports.ts:240-420`). Use their actual semantics and current authority; importing an opening balance over existing custody or recreating an invoice is not interval replay. No blanket transaction-replay gap is claimed. |
| Billing/fulfillment | Manual verified bank payments/refunds, credits, native shipment commit and delivery confirmation already exist (`billing.ts:652-760,809-839,909-969`; `fulfillment.ts:666-827,896-1062`). These are appropriate only for evidenced facts they actually represent. Order-before-reservation-before-fulfillment-before-invoice remains native ordering. |

Actual source cutoff/cursor, stopped writer sets, delayed external effects, current carrier/ledger/bank outcomes, physical warehouse custody, signing authority, confidential evidence custody and qualified fencing/routing infrastructure must come from responsible external systems/people. Neither code nor matching report hashes can manufacture them. `restore-activation.ts:247-280` and `docs/RESTORE-ACTIVATION.md` require authoritative observations. Missing balances can be supplied in independently verified private reports without inventing a new provider-read exception.

## Verification and uncertainty

Read repository instructions and requested planning/decision/handoff/activation material, traced the prepare predicate and relevant owner commands, inspected existing synthetic tests, and executed only the two foreground in-memory SQLite predicate demonstrations. No native test suite was run; dependencies were not installed. No red/green implementation result or product gate is claimed. Exact source predicates and command guards establish the gaps; end-to-end reproduction is the first implementation task.

No live source interval, customer configuration, provider result, policy approval or infrastructure authority was accessed. Those determine which confirmed capability gap actually blocks a particular restore. Corrupt/unsupported records may legitimately remain held. Root and the restore owner must review G1's compatibility contract before changing prepare; shared schemas/versioning and final production integration remain root-owned. The companion plan proposes new interfaces; none is claimed to exist or be authorized for implementation by this investigation.
