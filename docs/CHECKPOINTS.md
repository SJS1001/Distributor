# Verifiable checkpoints

Date: 2026-09-30. **Every gate below is NOT VERIFIED.** The application is under construction; local engineering receipts do not qualify these gates.

## Gate register

| Gate | Required tasks | Evidence and pass condition | Reviewer responsibility |
| --- | --- | --- | --- |
| G0 — rules and approach | D-001–D-006 | Decisions and examples settled; source/license route selected; numerical targets/staffing/cost model recorded. Inputs needed are not silently marked resolved. | Product, warehouse, finance, technical |
| G1 — independent modular foundation | D-007–D-011 | Isolated boot/proof, real database, ownership/access negatives, durable recovery and extension enabled/disabled qualification. CH-07/08/09/11 at scoped foundation depth. | Technical + QA |
| G2 — inventory and scanning | D-012–D-017 | CH-01/02/03/05/07/08 at inventory depth; two-warehouse stock/cost/serial reconciliation and real hardware evidence. | Inventory lead + warehouse + QA |
| G3 — orders and portal | D-018–D-021 | CH-01/02/04/07; persistent cart, private prices/order history, credit policy, backorders and allocations match agreed examples. | Product + QA |
| G4 — money | D-022–D-025 | CH-01/04/06/08/09; invoices/credits/payments/refunds reconcile under agreed triggers and external callback failures. | Finance + QA |
| G5 — fulfillment | D-026–D-029 | CH-01/03/04/05/09; pick/pack/ship/collection operator acceptance and selected carrier sandbox evidence. | Warehouse/logistics + QA |
| G6 — warranty/returns | D-030–D-033 | CH-06/07/08; sold-serial coverage, inspection/disposition and stock/credit/refund results reconciled. | Warranty + finance + QA |
| G7 — handoffs/operations | D-034–D-037 | Selected real sandbox/import-format handoffs, dry-run migration, monitoring and security/license/CI qualification; accepted manual limitations clearly recorded. | Technical, finance, operations |
| G8 — production readiness | D-038–D-041 plus G0–G7 | All CH scenarios current at release candidate, workload/restore targets met, pilot cycles reconciled and actual operator acceptance; no unresolved critical defects. Deploy authority remains separate. | Owner, QA, finance, warehouse, operations |
| G-UB — optional qualification | D-042–D-044 | Synthetic adapter and independence evidence; adopt/defer/reject decision. Not a requirement for G8 unless later product scope explicitly changes. | Technical + owner |

Early gates run only the portions for implemented modules; do not mark the entire CH scenario passed before its full workflow exists. D-038 reruns every required scenario together at the final candidate. Gate dependency is defined by task prerequisites, not merely row order.

G8 execution order is D-039 load/restore/cutover rehearsal → D-038 final integrated CH-01–CH-11 rerun → D-040 observed operator cycles → D-041 readiness review. D-039 requires G2–G7; it does not depend on the final rerun whose CH-10 evidence it prepares. Any candidate changes during pilot invalidate affected receipts and require a consistent final candidate before G8 acceptance.

## Repeatable acceptance scenarios

Use synthetic organization D, warehouses A/B with bins and quarantine, buyer accounts C1/C2, staff with restricted permissions, serialized equipment S and a nonserialized item N. Retain opening quantities, costs and independent expected totals. Tax, price, quantities and coverage dates come from G0, not hardcoded assumptions here.

| ID | Scenario | Decisive expected result |
| --- | --- | --- |
| CH-01 | Receive equipment, scan, order, pick/pack/ship or collect, invoice and pay | One continuous job-free record chain; correct serial/customer, conserved stock, agreed billing trigger and reconciled payment. Repeat for both warehouse origins. |
| CH-02 | Two concurrent orders compete for the final available unit | Exactly one allocation succeeds; no negative availability, duplicate serial or lost reservation. Repeat with expiry/cancel race. |
| CH-03 | Transfer A → transit → B, including partial receipt/damage; count stock concurrently | Stock/cost conservation with correct unavailable/quarantine state and adjustment authority; retry cannot duplicate receipt. |
| CH-04 | Partially supply an order, backorder remainder, cancel or return a line | Delivered/reserved/canceled quantities and invoice/credit/payment/refund sums match agreed independent examples. |
| CH-05 | Scan duplicates, wrong SKU/serial/site, unknown/damaged label; deny camera; disconnect | No unapproved stock creation/movement; manual fallback works; stale/offline state is visible and cannot authorize offline allocation by accident. |
| CH-06 | Sold serial opens claim; returned equipment is inspected and repaired/replaced/restocked/scrapped or credited | Coverage and customer eligibility correct; disposition is explicit; one authorized stock effect and financial adjustment; no credit from unlinked or unreceived evidence. |
| CH-07 | C1 tries C2 records; restricted worker/site tries another warehouse; export/background routes included | Every unauthorized read/write/export denied; no leaked price, invoice, serial, attachment or claim. Include wrong-organization synthetic tests where isolation supports it. Repeat CA/US regional selection and named-provider consent/withdrawal checks at intent, send, worker and reconciliation boundaries; prove that accepting Stripe cannot enable QuickBooks or any carrier. |
| CH-08 | Duplicate/out-of-order events, lease expiry and crash around business/outbox/effect commit | Committed facts survive; retries yield one business effect, stale state refused, failed work diagnosable/replayable. Use actual process/database failures. |
| CH-09 | Provider succeeds but response is lost; duplicated callbacks; provider down/rate-limited | Outcome remains uncertain until reconciled; no duplicate charge/refund/label/posting; native operations and accepted fallback behave as documented. |
| CH-10 | Import, exercise agreed peak workload, back up, restore and reconcile pending work | Correct counts, stock costs, outstanding amounts and serials; target latency/availability/RPO/RTO met; restore does not redeliver irreversible effects blindly. |
| CH-11 | Add optional module, migrate/version it, disable/remove it; UB absent/unavailable | Base application and contract checks pass; no foreign persistence, orphan worker or incompatible version silently accepted. |

## Evidence quality

Each receipt binds task/scenario to commit/content hash, relevant dependency/configuration, environment, fixture/oracle, actual command/manual procedure, expected versus actual results, artifacts, reviewer/date and limitations. Never put secrets/customer data in a tracked receipt. Screenshots demonstrate UI interaction; reconciled database/business records prove stock/money. Test counts alone prove neither correctness nor readiness.

Use actual database transactions/concurrency for stock/money boundaries and actual hardware for scanner claims. Simulators support fault checks, but do not certify a carrier/accounting/payment provider. Live provider claims require selected sandbox or explicitly authorized production evidence and disclosure of differences. Human acceptance must be the human's observed record, never an agent-generated signature.

Statuses: NOT VERIFIED, IN VERIFICATION, PASS, FAIL, BLOCKED, SUPERSEDED. Skipped/pending/missing critical tests are not PASS. Changes to relevant code, contracts, schema, fixture/oracle, dependencies or configuration invalidate affected receipts; retain them as historical evidence and rerun the affected gates. Unrelated changes need not cause indiscriminate full reruns, but final G8 uses one exact integrated candidate.

No arbitrary coverage percentage or pass-count target replaces the business scenarios. Scope reductions and accepted manual fallbacks must be explicit in the decision register and readiness record.

## Scoped engineering receipt — 2026-10-07 photographs/minimums

The [photographs, customer minimums and spacing receipt](evidence/PHOTOS-MINIMUMS-2026-10-07.md) binds source `1e28654e712bbf586f41100b2cde7fdec905fa64` to native6108/6108, default browser343/343, focused enforcement/media checks, schema32 backup/clone conservation and read-only live18/18. It does not qualify G0–G8 or replace integrated operational/operator/provider/hardware acceptance. The [handoff blind-spot review](reviews/task-handoff-blind-spots-2026-10-07.md) records remaining ownership, deadlines, notification/escalation and manual exception procedures.
