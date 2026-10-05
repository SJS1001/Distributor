# Deferred issue draft: scoped warranty dashboard summary

Status: proposal only; no `Warranty.claimSummary(actor)` contract was implemented. Read-only search of all issues in SJS1001/Distributor for `claimSummary OR warranty aggregate` returned no matches on 2026-10-05. This is not proof that differently named issues do not overlap. Existing category-navigation and analytics issues should be checked before intake.

Suggested title: Add a permission-scoped warranty summary for the dashboard

## Proposed scope and impact

Define an explicit read-only `Warranty.claimSummary(actor)` operation owned by Warranty, and a corresponding typed dashboard field. Counts must represent all accessible claims, not just the current page. Define which native claim states count as open, which require action, and how returns differ from warranty claims before implementation. Reuse native current-principal and organization/account restrictions; do not let the UI query foreign tables or infer full totals from a paginated sample.

The proposed aggregate is a new shared contract and extends the dashboard baseline. It adds implementation, access-control, query-performance and UI acceptance work. It does not change or close any of the existing 44 tasks or ten product gates. Keep implementation deferred until its scope is accepted; existing native claim queues remain available.

## Proposed acceptance criteria

- Document the included states, return/warranty grouping, observation time and explicit empty-result semantics.
- Return exact totals across the full authorized population, including data beyond the first page; verify totals against independently prepared fixtures.
- Enforce refreshed role, organization and buyer account scope. Revoked/unauthorized users receive native refusal and no aggregate disclosure.
- Keep counts consistent within one read transaction and perform no domain writes.
- Use a typed dashboard contract and permission-filtered UI with honest labels and an accessible path to the corresponding queue. Do not show a global total when the available data are only a sample.
- Record the tested source, focused security/accuracy evidence and measured query behavior for agreed representative volume before acceptance.

## Publication status

No GitHub mutation or account switch was attempted. GET /user returned `SJS1001`; the recorded mutation/publication identity check expects `sjsmithbot`. The available GitHub CLI account inventory lists only SJS1001. This draft retains the exact proposed issue without changing credentials or treating coordination input as new owner authorization. Issue intake is separate from delivery of the already authorized source snapshot.
