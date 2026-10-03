# Approved stock-cost account mapping corrections

Engineering continuation, 2026-10-03, following the owner's accepted [recommendations](MISSING-INPUT-RECOMMENDATIONS.md). This extends [original cost handoffs](ACCOUNTING-COSTS.md) with linked immutable account mapping corrections. It preserves original quantities, costs, artifacts, permanent movement claims and the reviewed cursor. It neither recalculates valuation nor posts to QuickBooks. All product tasks and gates remain NOT VERIFIED.

## Configure and prepare

Current internal finance/admin users open Billing, load a saved approved stock-cost review, then Load cost corrections. Configure a versioned policy with the customer's established valuation/finance basis, monthly periods, optional closed-through date, inventory account, movement-type offset accounts and responsible finance evidence. Example accounts are synthetic; the actual chart requires review. The first revision supplies `previousRevision: 0`; later revisions identify the exact current revision. A closed-through date cannot move backwards or be removed after closing. Policy history is immutable and hash-checked. This policy controls corrections only; it does not silently change original handoff policy or the customer's valuation method.

Prepare a correction identifying the original approved ID and SHA-256, current policy revision, permitted posting date, named ledger receiver, original external reference, independently verified outcome and evidence, and reason. The posting date must fall after any recorded close. Accounts must actually change; every nonzero original movement must map to a supplied offset different from inventory. The original journal amounts and movement identities remain exact and balanced using checked integer arithmetic.

| Verified original outcome | Saved plan | Additional evidence |
| --- | --- | --- |
| Posted | Reverse the exact original accounts/amounts, then replace with corrected accounts | Original ledger posting date; accountant review for an original date in a closed period |
| Unposted and cancelled | Corrected replacement only | Verified non-posting and cancellation; retain matching original receiver/acceptance identity if present |
| Unknown | Blocked review, no downloadable artifact | Outcome evidence remains unresolved; cannot approve |

A recorded original acceptance must match the supplied ledger receiver and external reference. Its later creation or any policy revision changes the frozen review and invalidates approval. A closed-period mapping correction requires responsible accountant evidence; this workflow does not perform retrospective restatement, write-downs, quantity changes, changes of valuation method or arbitrary financial adjustments.

## Independent decision and delivery

A different current internal finance/admin principal must approve or reject the exact saved review hash. Approval recomputes the plan against the intact original, current policy and receipt evidence inside the command transaction. One original can have only one approved correction; competing drafts cannot approve a second reversal/replacement. Unknown outcomes cannot be approved. Rejection retains evidence. Exact retries preserve the original request key and result, while changed input conflicts. Successful decisions create immutable canonical JSON plus a newline, including original hash, policy/evidence, reversal/replacement journals and preparer/reviewer identities and times. Server and browser validate its exact SHA-256 before download.

Download does not record delivery, ledger acceptance or posting. Retain the file and reconcile its separate reversal/replacement references through an approved ledger process. No correction receiver-receipt command or QuickBooks journal transport is provided. A fresh original acceptance is refused after an approved correction supersedes that original; existing original acceptance history and exact retries remain historical evidence. Original and correction downloads remain available under restore hold; new policies, preparations and decisions remain blocked. Browser operations discard responses after navigation/sign-out without undoing a committed native command.

## Native API and storage

Authenticated finance reads: `GET /api/accounting/cost-policy`, `GET /api/accounting/costs/:originalId/corrections` (latest 100), `GET /api/accounting/cost-corrections/:id`, and `GET /api/accounting/cost-corrections/:id/file`. The browser exposes history and frozen evidence. Direct ID reads retain access to earlier corrections.

Strict session/origin/CSRF commands with durable exact-attempt keys: `accounting.cost.policy`, `accounting.cost.correction.prepare`, `accounting.cost.correction.decide`. Exact input contracts are defined in `src/server/cost-corrections.ts` and validated at the HTTP boundary. Integration owns the new policy/correction tables; no module writes foreign tables. Schema version 8 requires an explicit [fresh-file upgrade](SCHEMA-UPGRADES.md) for versions 1–7. No live provider request, stock adjustment, invoice change or financial valuation mutation is made.

Actual company accounting basis, periods, material-error treatment, approval authority, mappings, external cancellation/posting identity, duplicate-posting review and independent human ledger reconciliation remain qualification evidence. See [local checks](evidence/LOCAL-CORRECTIONS-RESTORE-REVIEW-2026-10-03.md).
