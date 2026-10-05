# Deferred issue draft: scoped warranty dashboard summary

Status: tracked in [Distributor issue #4](https://github.com/SJS1001/Distributor/issues/4); implementation deferred. No `Warranty.claimSummary(actor)` contract was implemented. All three pre-existing issues were read on 2026-10-05; none covers this aggregate.

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

## Issue intake and source publication status

Created [issue #4](https://github.com/SJS1001/Distributor/issues/4) on 2026-10-05 with source, impact, acceptance criteria and explicit implementation deferral. Immediately before POST `/repos/SJS1001/Distributor/issues`, GET `/user` verified `sjsmithbot` through the existing designated profile. Subsequent GET verified the open issue, author and exact body. No access or global authentication changes were made.

The owner's standing scope-control mandate authorizes searching and creating/reusing tracking issues for work outside the frozen baseline. The earlier statement that intake lacked authority was incorrect: the existing mandate applies, without authorizing the aggregate implementation. Source publication remains separately blocked by the bot's recorded repository `push:false`; that permission did not prevent issue creation. No source push, PR, merge, CI or deployment occurred.
