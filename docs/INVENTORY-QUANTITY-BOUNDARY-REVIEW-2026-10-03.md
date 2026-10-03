# Native quantity correction boundary review — 2026-10-03

Bounded synthetic engineering review of `SJS1001/Distributor`, published branch `codex/local-distributor-checkpoint`, exact baseline `f90922717f444af7ee57d17701cc470319bf2a29`. All tasks and product gates remain **NOT VERIFIED**. This receipt does not qualify production accounting, physical evidence, infrastructure, provider delivery or the full product.

## Reproduced defect and narrow repair

An approved quantity record could be returned by `inventory.quantityCorrections.get` or `history` even when its carrying delta disagreed with its physical/value effect, its selected predecessor movement had lost its independent approval, or its carrying effect had been deleted. The ordinary cost export already rejected all three conditions, including when the damage preceded its cursor. The history reads checked record shape, hashes and direct movement bindings but omitted the complete owning evidence reconciliation.

The new tests first ran against unchanged baseline production code: **19 tests, 13 passed and six failed**, with each failure reporting a missing expected exception from one of the two read operations. The altered delta was rehashed to distinguish a shape/hash check from relational evidence validation. Test corruption is deliberate local synthetic database damage, not an exposed production editing operation.

`get` now refreshes authority, checks the selected record/site and runs the existing owning reconciliation within one database transaction. `history` validates that evidence once before selecting a bounded page, including an empty continuation after the damaged history. Internal command reads use a private transaction-required helper so existing command transactions and cached receipt validation retain their behavior without nested transactions. The repair changes only `src/server/inventory-quantity-corrections.ts`; there is no schema, costing formula, HTTP, browser, journal, dependency or restore change.

## Added coverage of existing controls

The new `tests/inventory-quantity-boundary-review.test.ts` has 20 checks: the six defect reproductions and fourteen checks of controls that already worked or their regression coverage. Coverage includes:

- Two independent OS processes/SQLite connections racing a permanent reference or a pending layer slot: exactly one preparation, a deterministic reference/pending refusal for the loser, and retained references after rejection.
- Independent approval versus a five-unit reservation against a six-unit layer corrected to four: only one succeeds, stale approval or insufficient allocation blocks the loser, and physical quantity never falls below reservations. The race accepts either legal serialized winner; it does not claim that one invocation exercises both scheduler orders.
- Cached preparation with stale or forged actor fields after site/role/active/password/customer restriction, and organization/principal receipt-key isolation for preparation, decisions and reads.
- Late command-receipt and audit insert failures after a valued correction: all business rows, movements, value effects, stock revisions, clocks, events and receipts match the pre-operation snapshot. Removing the synthetic fault allows one exact retry.
- CA/US successive decreases, increase, zero, subsequent increase and decrease on an established carrying basis; original acquisition movement/cost and every separate approval/preparation receipt survive restart and exact replay.
- A rehashed retained decision naming a different finance reviewer cannot claim the original reviewer's physical effect. Reads and cached decision recovery refuse it without repairing evidence.

All preparation, approval, reservation and receiving operations use native module owners. Test-only owned-store mutations inject damaged history, revoked grants and late aborts; they do not add generic production editing paths. Child processes rendezvous after opening, have a 15-second deadline, and are reaped before their test returns.

## Verification

Runtime: Node **24.19.0**, npm **11.9.0**, retained installed locked dependencies; no dependency changes or installation required.

1. Baseline: `node --import tsx --test tests/inventory-quantity-boundary-review.test.ts` — 13/19 passed, six expected defect failures; no skips/cancellations. Original log retained privately as `baseline-new-tests.log`.
2. Initial repaired source: same command — 19/19 passed. This precedes the final empty-continuation assertion and extra retained-decision coverage; log `focused-fixed.log`.
3. Final: `node --import tsx --test tests/inventory-quantity-boundary-review.test.ts tests/inventory-quantity-corrections.test.ts tests/inventory-valuations.test.ts tests/accounting-costs.test.ts tests/counts.test.ts tests/count-policy.test.ts tests/inventory-authority.test.ts tests/inventory-internal-authority.test.ts` — **104/104 passed**, zero failed/skipped/cancelled, 26,744.406874 ms. Includes all 20 new checks. Log `final-native.log`.
4. `npm run typecheck` — passed (`typecheck-final.log`). Assigned source/test/document formatting and `git diff --check` are recorded in the private transfer receipt.

Private logs, action handoff, tested-file hashes and transfer receipts stay outside tracked source at `/workspace/distributor-quantity-review-audit`. Prior restore commits/artifacts are preserved. No CI, workflow, provider IO, deployment, PR, merge, push, nested delegation or scheduled monitoring was performed. Requested `gpt-6-astra`/high cannot be verified or selected through the exposed runtime; the canonical delegated model rule was not available in the checkout/shared paths inspected. No extra session was launched.

## Limits and coordinator follow-up

The fix makes public correction reads validate complete organization cost evidence and therefore adds full-history work and a SQLite write-reservation transaction to single-record reads. Pagination still bounds returned records, not reconciliation cost. Production data volume, contention and hostile multiwriter storage are not qualified. Hashes are consistency checks, not signatures or proof that supplied physical/accountant evidence is true; coordinated rewriting of every authority source is outside this validation claim.

There is a pre-existing documentation discrepancy for the coordinator: [the quantity procedure](INVENTORY-QUANTITY-CORRECTIONS.md) says increases add original acquisition cost, while the valuation owner and existing test preserve the established carrying basis. With six units valued at 4,001, adding three after reaching zero adds 2,000 carrying units while original unit cost stays 1,000. This review preserves that existing behavior and original costs; it does not change the valuation owner or decide a new accounting policy. Reconcile the procedure with the accepted accounting contract in the parent-owned work.

No full native suite, browser/build/runtime reinstall, combined cloud-lane integration, real accountant acceptance or product gate is claimed. The coordinator must review/integrate the exact patch and verify the combined checkpoint separately.
