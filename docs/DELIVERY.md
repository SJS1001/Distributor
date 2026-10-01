# Delivery packets, risks and operating plan

Date: 2026-09-30. Status: planning package complete; full application engineering subsequently authorized. Business/operator qualification and release gates remain pending. Task IDs/effort remain canonical in [TASKS.md](TASKS.md); [PLAN.md](PLAN.md) owns the calendar ranges.

## Execution rules and reviewable outputs

The owner authorized engineering before G0 qualification. Dependency and business decision gaps remain acceptance constraints; preserve them explicitly while developing provisional synthetic behavior. Record a named responsible person, branch/version, requirement IDs, inputs, test oracle and evidence location before implementation. Select the stack and pin versions in the G0/G1 route record; the current local stack is recorded in IMPLEMENTATION.md. No provider account or production database has been provisioned.

Each implementation packet must include owning code/migrations/contracts, operator-facing behavior, meaningful negative/failure checks and relevant documentation. READY FOR VERIFICATION means a reviewable candidate exists; VERIFIED requires the task's actual acceptance evidence and responsible reviewer. Small commits or a green build alone do not satisfy stock/money/provider/hardware outcomes. Preserve concurrent edits and failed/superseded receipts.

| Packet | Tasks and gate | Concrete review artifacts | Stop/revisit condition |
| --- | --- | --- | --- |
| Discovery | D-001–D-006; G0 | DISCOVERY answer sheets, source manifest/route comparison, independent examples, hardware matrix, target/cost/staffing record. | Unanswered required rules, ambiguous rights, unavailable staff/targets. |
| Independent foundation | D-007–D-011; G1 | Fresh startup/run instructions; real database receipt/invoice/return proof; ownership/grant model; outbox crash evidence; optional module enabled/disabled checks. | Two-week proof fails, field-service dependencies remain necessary, foreign persistence or permission/recovery defects. |
| Inventory and scanning | D-012–D-017; G2 | Identifier/UOM fixtures; stock/cost/custody reconciliation; PO/transfer/count screens; concurrent reservations; physical scanner/label receipts. | Conservation mismatch, race, unsupported actual labels/devices or offline authority gap. |
| Orders and portal | D-018–D-021; G3 | Price/credit snapshots; persistent cart/order UI; buyer isolation checks; partial supply/cancel agreement with D-023/D-026. | Quote/account leakage, exposure race, duplicate submit or inconsistent remaining quantities. |
| Money | D-022–D-025; G4 | Immutable invoice/credit/PDF samples; exact independent totals; verified payment/refund callbacks and balances/aging/delivery receipts. | Double financial effect, uncertain payment mislabeled paid, unexplained totals or unapproved invoice trigger. |
| Fulfillment | D-026–D-029; G5 | Pick/pack/ship/collection UI; origin-aware carrier adapter/labels/tracking; exceptions and operator observations for both sites. | Double issue/label, unqualified provider, wrong serial/site or unobserved hardware cycle. |
| Warranty and returns | D-030–D-033; G6 | Sold-serial policy/history; claim/review/RMA/inspection UI; repair/restock/scrap/replacement chain; one linked credit/refund result. | Missing sale/eligibility/inspection evidence, unapproved disposition or stock/money disagreement. |
| Handoffs and operations | D-034–D-037; G7 | Accounting mapping/reconciliation; import dry run with cost layers/rejects; monitoring/recovery procedures; dependency/license/security/CI evidence. | Duplicate posting/import, lost valuation, leaked secrets or incorrect hosted runner qualification. |
| Integrated acceptance | D-038–D-041; G8 | One-candidate CH-01–CH-11 receipts; load/restore/cutover rehearsal; two agreed operator cycles; training/support/release/rollback review. | Critical unresolved defect, stale/partial receipts, missing targets/operator evidence or deploy authority. |
| Optional UB | D-042–D-044; G-UB | One scoped synthetic workflow, pinned compatibility/replay proof, disabled adapter/native checks and separate adopt/defer/reject estimate. | Live modes/rights unqualified, duplicate routing owner, stock/money authority creep. |

These packet groups are not a serial waterfall: honor the exact task dependency graph. D-020 waits for D-024 payment completion; D-021/D-023 wait for D-026 shipping state. Backend billing foundation can proceed alongside order UI when owning contracts are ready. Complete the full packet before claiming its gate; all required packets remain in the baseline.

## Scheduling and staffing controls

The planning baseline is 248–396 developer-days plus 8–14 optional UB days. Three dedicated developers plus QA/operator participation support the conditional pilot at weeks 26–32 and production readiness at weeks 32–42. The two-week proof is part of the foundation, not permission to mark all of G1 complete after a thin demonstration. Actual proof effort and discovery decisions determine the revised schedule.

For each weekly review record available developer/QA/operator days, work completed with versioned evidence, unresolved dependencies, provider/hardware access dates and the next ready tasks. Preserve team capacity for corrections, integration and support; shared OPUS work must be deducted from availability. No named team or kickoff date currently exists. Owner-selected scope/staffing changes recalculate the estimate, rather than presenting person-days divided by headcount as a commitment.

## Cost worksheet

No spend is authorized and no currency/rate/quote has been selected. D-006 fills this model with current source/date, payer and approved ceiling. Keep sensitive commercial quotes outside public files when required.

| Cost component | Calculation/input | Decision owner |
| --- | --- | --- |
| Engineering | Sum task-specific measured/planned days × relevant loaded daily rates; do not add task-local correction twice. Baseline days 248–396; optional UB separate. | Owner/technical lead |
| QA/operator | Agreed part/full-time days across phase windows × rates, plus hardware/provider observation cycles. These are excluded from developer-day totals. | Owner/domain leads |
| One-time hardware/setup | Actual selected scanners/printers/labels, migration assistance, provider setup/certification and training quotes. | Warehouse/operations |
| Monthly platform | Selected compute/database/worker/storage, bandwidth, document/email delivery, backups/restore drills, monitoring and support. | Operations |
| Usage/provider | Orders/payments/refunds/carrier labels/accounting/API volume × actual selected fee schedules, including retry/reconciliation behavior. | Finance/logistics |
| CI and artifacts | Actual GitHub-hosted runner eligibility, job minutes/concurrency and artifact/cache retention; re-evaluate for private visibility or larger runners. | Operations |
| Maintenance/reserve | Named support/update capacity and explicit contingency allowance; choose reserve once and disclose its basis. | Owner |

Track one-time delivery and recurring monthly cost separately. Open-source license cost is not total operating cost. No vendor/rate assumption is a purchasing recommendation or account creation instruction.

## Risk register

| ID | Risk / detection | Mitigation and owner | Tasks / gate |
| --- | --- | --- | --- |
| RISK-01 | OPUS extraction retains field-service startup/schema/payment coupling; proof requires job/assets. | Inventory dependencies, prove independent startup/job-free flows, timebox and select another route if needed; technical lead. | D-002, D-003, D-007; G0/G1 |
| RISK-02 | Copied source/license/publication scope unclear or enterprise exceptions overlooked. | Pin actual files/notices/rights and delivery model; hold ambiguous reuse/publication; owner/license reviewer. | D-002; DEC-11/14 |
| RISK-03 | Stock/serial/cost diverges under reservation/transfer/return races. | Owning atomic commands, exact oracle and real competing/fault cases; inventory lead/QA. | D-013, D-015, D-016, D-032; G2/G6 |
| RISK-04 | Credit exposure/order/billing/partial supply disagree. | Agreed financial workbook, versioned accepted facts, atomic exposure controls and integrated line reconciliation; finance/backend. | D-004, D-018, D-021, D-023; G3/G4 |
| RISK-05 | Lost provider success creates repeated payment/refund/label/posting. | Durable effect identity, explicit unknown state and lookup/reconciliation before new effects; integration lead. | D-024, D-027, D-034, D-036; CH-09 |
| RISK-06 | Cross-account/site leaks through history, prices, files, exports or workers. | Derived identity/scope and denial matrix across every surface, including cached receipts; security/QA. | D-008, D-020, D-037; CH-07 |
| RISK-07 | Actual camera/scanner/printer labels fail, or warehouse connectivity is insufficient. | Early selected-device matrix/manual fallback; qualify physical workflows; separately estimate authoritative offline if required; warehouse lead. | D-005, D-017; G2/G5 |
| RISK-08 | Import preserves counts but loses valuation/unpaid balances or duplicates on retry. | Reject/report bad rows, include costs/source manifests, reconcile independently and rehearse rerun/cutover; finance/operations. | D-035, D-039; G7/G8 |
| RISK-09 | Shared staffing/provider access makes calendar unrealistic. | Named available capacity and prerequisites, weekly measured forecast, explicit estimate changes; owner. | D-006; all packets |
| RISK-10 | Restore replays completed external effects or cannot meet agreed RPO/RTO. | Isolated restore and receipt reconciliation, credentials/provider separation, release/rollback rehearsal; operations. | D-036, D-039; CH-10 |
| RISK-11 | Optional module/UB becomes a required dependency or second stock/money writer. | Compile-time ownership and disabled/absent compatibility proof, one routing authority, synthetic UB first; technical lead. | D-009, D-011, D-042, D-043; CH-11 |
| RISK-12 | Public workflows expose untrusted code/secrets or hosted environment cannot run required checks. | Hosted-only OS/capability review, least token permissions, immutable action pins, untrusted input handling and separated protected release; operations. | D-037; G7 |
| RISK-13 | Historical/mock/doc receipts are mistaken for current product or human acceptance. | Bind exact candidate/environment/oracle, retain limitations/failures, obtain actual human observations; QA/owner. | D-038, D-040, D-041; G8 |

## Future GitHub-hosted CI

Owner instruction on 2026-09-30 selects GitHub-hosted runners for this repository only. No workflow exists or is introduced by this package. Before authoring one, verify current repository permissions/policies and the selected image OS/architecture/tools against the chosen stack and databases; record image/tool versions in run receipts. GitHub documents hosted environments and available labels in [hosted runner concepts](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners) and [runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), reviewed 2026-09-30. Choose stable explicit image labels when reproducibility needs them; do not assume preinstalled tools stay constant.

Proposed check families: planning/link validation, formatting/types/build, domain/unit checks, real database/permission/concurrency/migration checks, browser flows and bounded process/provider-fault checks. Product commands become real only after the stack and fixture environment exist; do not add placeholder passing jobs. Physical scanner tests and actual human acceptance remain separate receipts. Provider sandbox jobs require separately authorized access and protected credentials.

Follow [GitHub secure use guidance](https://docs.github.com/en/actions/reference/security/secure-use) for least-privilege workflow tokens, full commit SHA action pins, trusted/untrusted trigger separation and safe inputs. Use timeouts, cancel superseded safe verification work, and retain redacted evidence. No PR job obtains deployment or live-data authority. Review usage/concurrency/retention costs under the repository's then-current visibility and account plan; no hosted plan upgrade is selected. Future PRs still require verified sjsmithbot identity and the target repo's policies.

## Operations and release readiness

D-036/D-039/D-041 must deliver actual procedures for backup/restore, poison/failed work, uncertain payments/refunds/bookings/accounting, stock/money discrepancy, import reject/retry, credential rotation, account/site grant incidents and provider outages. Each procedure defines an observable trigger, authorized responder, evidence to inspect, bounded recovery action, reconciliation and escalation. Restore/cutover includes source cutoff, opening counts/costs/balances, pending effects, old/new routing authority, abort conditions and verified rollback limits. A rollback after external completion cannot blindly reverse cash or shipping.

Training covers receiving/scan fallback, stock/transfers/counts, orders/credit holds, picking/collection, invoice/credit/payment, claim/RMA/disposition and support exceptions. Pilot observation includes at least two agreed operating cycles across both sites, independent totals and named human feedback. Production readiness requires current G0–G8 receipts, no unresolved critical defects, support ownership and owner review. Deployment, live data and provider activation remain separately authorized actions.

## Planning package acceptance

Planning completion means all stated scope is represented by requirements, task dependencies/effort, ownership/workflow contracts, discovery inputs, verification scenarios/receipts, risks, costs and delivery controls; local document links and identifiers resolve. It does not mean decisions have been answered or a product gate passed. Run `python3 scripts/verify_plan.py` from the repository root for structural checks, then review the actual content against the requirement register. The verification receipt records file hashes and limits; later content changes require a new check.
