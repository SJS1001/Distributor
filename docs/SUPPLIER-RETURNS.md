# Supplier returns and finance follow-up

Local engineering workflow, 2026-10-01. All acceptance tasks and product gates remain NOT VERIFIED. The [local receipt](evidence/LOCAL-SUPPLIER-FOLLOWUPS-2026-10-01.md) records synthetic checks; it does not qualify a supplier, physical handover or finance policy.

## Find a supplier return

Purchasing initially shows twenty newest supplier return headers in the current organization and warehouse scope. Use **Search supplier returns** for a return reference, serial or reason, then **Search returns**. Searches trim surrounding whitespace, match ASCII case without treating `%` or `_` as wildcards, and retain other characters literally. **Load more supplier returns** adds the next twenty matching headers; a failed read retains the exact cursor for retry. Final-page keyboard focus returns to the queue heading.

Open **Supplier history** from any loaded row. Finance/admin users can record outcomes on an older searched return using the same native commands and revision checks. Warehouse readers remain limited to their granted sites. Searches cancel superseded responses and close the previous history. Navigation, refresh and sign-out cancel pending reads; returning to Purchasing starts from its initial page with an empty search. These are live pages, so concurrent changes can alter traversal; refresh for current results.

The [queue evidence](evidence/LOCAL-SUPPLIER-RETURN-QUEUE-2026-10-02.md) records synthetic workstation verification. Returned header counts and per-page enrichment are bounded; receipts, replacement choices, legacy full-list reads, SQL scans/sorts and aggregate work still require production qualification. No schema or dependency changed.

## Physical handover

In Purchasing, an administrator reviews the exact purchase receipt and current held stock, scans a serialized unit where applicable, and confirms return quantity, reason and handover evidence. The owning command reloads the active persisted administrator and refuses a required password change before a new handover or any cached result. It then rechecks current custody, revision, reservations and original purchase lineage. Supplied role/site fields cannot increase permission; an absent, foreign or deactivated principal is denied. See [purchasing authorization evidence](evidence/LOCAL-PURCHASING-AUTHORITY-2026-10-02.md). Inventory removes only the handed-over quantity at its original cost. Original purchased/received totals remain intact. A zero-quantity serial retains its identity and permanent history. Historical split lots without explicit purchase origin need reconciliation before return.

## Record and review the supplier outcome

A finance user or administrator opens the retained return row and uses a unique follow-up reference and evidence for each action:

1. Record a supplier credit in positive integer cents in the organization's CAD or USD. A credit may differ from the stock cost; record the reason and reconcile it externally. Recording it changes no customer credit, cash balance or accounting ledger.
2. Link a replacement only after it has been received normally on another purchase order from the same supplier for the same product. Choose that delivery and quantity. The command prevents linking more than returned units or allocating the same delivery's units twice across returns. Linking changes no stock or purchase order. The receipt proves prior receipt, not current physical custody.
3. Close the follow-up with reviewed evidence and an explicit resolution. `reconciled` requires an active credit or replacement; `no-remedy` requires none. This records the review outcome without proving a supplier settlement or completed accounting reconciliation.
4. Reopen a closed follow-up before correcting its outcomes. In Supplier history, void an active credit or replacement using a new reference and evidence. The original remains visible; a void frees that replacement allocation. Enter new corrected evidence separately.

Commands bind the displayed revision. Reload after another user's change and review again. A lost response can retry the exact key/payload. Reusing the same normalized reference with identical original details returns its original receipt even after later corrections; it does not restore a voided outcome or reopen the return. Changed details require a new reference.

## History and access

Supplier history shows 20 newest revisions and loads older pages. It retains loaded rows on failure and supports retry. Corrections remain visible on the original observation even on an older page. Current finance/admin/commercial grants permit reads; a warehouse user sees only returns handed over at their granted sites and cannot record financial outcomes. Inactive users, revoked grants and required password changes block reads and cached retries. Browser history resets on refresh/navigation/sign-out; close returns focus to its opener.

## Operating limits

Administrator handover approval and organization-wide finance review are provisional duties requiring operator/finance agreement. The app stores text evidence references; no attachment archive or supplier subledger is supplied by this workflow. Actual supplier credit notes, replacement custody, original-cost/accounting differences and external reconciliation need independent review. A separately received replacement may already have been consumed, transferred or returned; a link makes no availability claim. No supplier API, QuickBooks posting or cash settlement occurs here.

Stop every old application/worker writer before upgrade. Existing physical returns start with open follow-up and zero observations; original facts and historical receipts remain intact. Mixed-version writers, production migration/load/index/locking/retention/tamper resistance, backup/recovery/security/residency and human acceptance require qualification. History and current supplier-return pages bound returned rows; other purchasing lists and aggregate work are not qualified at production scale.

The owner authorized committing and pushing the current repository snapshot on 2026-10-02. Verification uses direct workstation commands. No CI jobs/runners, workflows, PRs, actual provider requests, deployments or OPUS/UB integration are part of this work. Future CI uses GitHub-hosted runners after separate authorization and qualification.
