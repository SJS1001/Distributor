# Bounded accounting boundary review — 2026-10-03

## Tested baseline and ownership

Repository: `SJS1001/Distributor`. Both the read-only remote branch lookup and
the fresh local clone resolved `codex/local-distributor-checkpoint` to exactly
`4d0c45a275fd26a3cdb1362182f7c4eea3881110`. Initial checkout was clean. Runtime:
Node `v24.19.0`, Linux, isolated synthetic regional SQLite fixtures. The owner’s
canonical model rule was supplied during the assignment. This launcher exposes
no model/effort selection or effective configuration; Astra/High remains
unverified. No subagent or additional coding session was launched.

Read repository instructions and the requested planning, decision, handoff and
coding-remainder documents; scoped implementation review to correction chains,
final observations, cancellation/retries and journal delivery ownership.
Actual owners are `CostCorrections` in `src/server/cost-corrections.ts` and
`StockJournalDelivery` in `src/server/stock-journal-delivery.ts`, exposed through
`integration.costs.corrections` and `integration.costs.journals`. Existing
task-shaped source/policy/cancellation interfaces remain unchanged.

Only the journal-delivery implementation, new focused native tests and this
document change. No inventory, HTTP, schema/version, restore/platform lifecycle,
browser, shared tracking/HANDOFF, dependency or CI file changes. Existing pinned
dependencies were installed with `npm ci --ignore-scripts --no-audit --no-fund`;
package manifests and lockfile remain unchanged.

## Confirmed defect and narrow repair

Correction retry dispatch checked only its immediate predecessor’s native
journal. Manual correction attempts do not necessarily have native deliveries.
Consequently, two separately approved manual cancellation/retry transitions
could skip an earlier native journal and acquire another write lease while that
earlier journal was still running, unknown after dispatch, or already posted.
No provider call is needed to reproduce the ownership violation; a dispatched
unknown ancestor is sufficient to demonstrate duplicate-posting exposure.

Deterministic reproduction, through the established native owners:

1. Independently approve a correction and a native delivery for one leg. Acquire
   its write lease and cross its dispatch fence. Retain explicit synthetic
   unknown, running or posted native state.
2. Record separate synthetic final manual non-posting evidence and independently
   approve a fresh manual retry. Do not create a native journal for that retry.
3. Record the intermediate manual retry’s final cancellation and independently
   approve another retry and its native delivery.
4. Claim a write lease for the newest native delivery. Baseline wrongly accepts
   all twelve CA/US × reversal/replacement × native-state cases.

The repair changes the integration-owned predecessor query from immediate
attempt equality to every other attempt of the same organization/source/leg.
All earlier native journals must be cancelled or rejected. The current native
attempt is excluded so its own pending/running state remains valid. The fence
runs within the existing claim, guard, dispatch and result-retention
transactions. Review/approval order and ownership interfaces are unchanged;
no foreign-table writes, new schema, provider behavior or accounting policy is
introduced.

The tests explicitly confirm that separate exact native cancellation permits
the fresh write, crossing its dispatch fence twice refuses, reservations remain
distinct, old unknown history remains intact and quantities, original cost,
source cursor and correction bytes remain conserved. A posted native ancestor
cannot be cancelled merely because later manual evidence says non-posting.

## Other bounded outcomes

- A native unknown replacement still refuses changed-account successor
  preparation even with final manual cancellation. Separate native cancellation
  permits a changed replacement with **no additional reversal**; the original
  journal and the already-posted reversal remain intact.
- A closed posting date refuses successor preparation; an explicitly selected
  later open date succeeds. Closing a period invalidates further write fencing.
  Lookup of an already-uncertain journal retains its exact original bytes/date
  and requires current permission, rather than silently changing its journal.
- Reaccepting organization permission invalidates stale authority. Separately
  approved lookup-only permission cannot become write permission. Old lease
  responses cannot overwrite the retained result of a later lookup.
- Injecting a late correction approval receipt/audit failure twice rolls back
  the decision each time: draft remains ready and no approved file is available.
  Retrying the exact body/key after removing the fault commits once and recovers
  that same receipt. Changed input under the committed key refuses.

These controls already held at baseline; no additional implementation defect
is claimed for them. Ledger outcomes in every test are explicit synthetic
observations or operator attestations, never inferred from a lookup miss.

## Foreground verification

Commands run from the repository checkout:

```sh
node --import tsx --test tests/accounting-boundary-review.test.ts
node --import tsx --test tests/accounting-boundary-review.test.ts tests/cost-corrections.test.ts tests/cost-correction-retries.test.ts tests/cost-correction-chains.test.ts tests/stock-journal-delivery.test.ts tests/stock-journal-permissions.test.ts tests/stock-journal-cancellation.test.ts tests/stock-journal-original-cancellation.test.ts tests/stock-journal-original-retry.test.ts tests/stock-journal-reconciliation.test.ts tests/stock-journal-transport.test.ts tests/quickbooks-stock-journal.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/prettier --check src/server/stock-journal-delivery.ts tests/accounting-boundary-review.test.ts
git diff --check
```

| Verification                                           | Actual outcome                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| Final new tests against exact baseline production file | Expected red: 4/16 pass, 12/16 fail at missing predecessor refusal; exit 1 |
| Final new tests against repaired production file       | 16/16 pass; exit 0; zero skips/cancellations                               |
| Twelve-file focused accounting/journal regression      | 220/220 pass; exit 0; zero skips/cancellations                             |
| TypeScript                                             | Exit 0                                                                     |
| Assigned source/test formatting and whitespace         | Exit 0                                                                     |

Baseline replay temporarily substitutes only the owned production file with
`git show 4d0c45a275fd26a3cdb1362182f7c4eea3881110:src/server/stock-journal-delivery.ts`.
A Python `try/finally` restores the exact repaired bytes, verified by equality
and SHA-256, before final regression. HEAD never changes.

Private raw logs remain outside git under `/tmp/accounting-boundary-*.log`.
Preserved failure history includes the initial tsx CLI’s IPC socket refusal
(`EPERM`), the original four-case baseline red and an expanded test’s 14/16 run.
That latter run had two fixture reference conflicts: manual cancellation
initially reused the permanently reserved native document number. Corrected
fixtures use separate operator references and the existing independent native
cancellation confirmation; no production relaxation was made. The direct
`node --import tsx` test runner avoids the tsx CLI IPC requirement.

| Retained log                                 | SHA-256                                                            |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `accounting-boundary-red.log`                | `7640435e7e9ca2ea5ae7dc5fce75ab1b76adb71c966af69a12ca6dab69ea734d` |
| `accounting-boundary-red-native.log`         | `72df012480fcc8ffeb87649e510224b7b03031c0d04ce927eee592c4bcb0a672` |
| `accounting-boundary-expanded.log`           | `7a8d17c52ba099f9a7eab61255fee43a57e30fa11d2e7b169362908f574829a0` |
| `accounting-boundary-final-baseline-red.log` | `ceda543cf1e3302f2f923b4d4b3b7743a5422b22ebe9bd9f9a6c19797cb56c4c` |
| `accounting-boundary-final-focused.log`      | `0f773aed548f1fb990dbf989c05fcde1f0ba8ce67f9dd4172ef1806b05ae54c5` |
| `accounting-boundary-regression.log`         | `4a64f188be3e3569b48e4fcd628cb69ea51ca84aa58f5af736a037e667382323` |

## Limits and transfer

This is a bounded synthetic native review, not a complete application audit or
actual ledger/finance/provider qualification. No full native suite, browser
suite, production build, infrastructure activation or product gate is claimed.
Parent uncommitted quantity work and schema-17 integration are absent from this
exact baseline checkout; combined verification belongs to the parent. No change
requires a proposed patch to parent-owned files.

No CI/Actions/runner, provider I/O, deployment, secret/settings access, purchase,
PR, merge, push, background automation, polling or reminder was performed.
Delivery is a local commit and exact `git format-patch -1 --stdout` bytes,
base64-encoded in separate foreground output chunks of at most 12,000
characters, with decoded byte count and SHA-256 recorded in transfer output.
Concatenate numbered chunks in order, base64-decode and verify the patch hash
before review/application. All Distributor tasks and product gates remain
NOT VERIFIED.
