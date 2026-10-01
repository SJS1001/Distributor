# DHL Express retained shipping/customs review — 2026-10-01

**PASS within captured local declaration/regression scope. Full system incomplete; all 44 tasks/10 product gates NOT VERIFIED.** Partial D-027/D-036, REQ-03/REQ-16/REQ-19 and CH-05/CH-07/CH-08/CH-09.

Final backend candidate captured 2026-10-01T23:53:15.381973+00:00 on `codex/local-distributor-checkpoint`, parent `d6a6ea686e734ea89bc3a1e364912a7e80d746d8`. The companion JSON retains 272 input SHA-256 values, 189 unchanged historical evidence files, 170 unchanged dependency license notices, every command/log and the superseded candidate hash. Source and browser inputs did not change after the first capture; the subsequent amendment affects only the existing backend routing fixture. No schema/dependency change, vendor code reuse or provider activity. See [the capture procedure](../CARRIER-BOOKINGS.md#dhl-express-goods-declaration-capture).

Environment: direct macOS arm64 workstation, Node v24.16.0/npm 11.13.0, disposable native SQLite, authenticated injected HTTP and synthetic Chromium journeys. All data is synthetic. US-to-Canada and Canada-to-US payloads use a US database fixture and explicit manual address acknowledgment; they do not prove actual Canadian infrastructure or origin qualification.

| Captured check | Observed outcome |
| --- | --- |
| `tsx --test tests/dhl-shipping-review.test.ts` | PASS 50/50, exit 0 |
| `tsx --test tests/dhl-shipping-review.test.ts tests/carrier-bookings.test.ts` | PASS 126/126, exit 0 after routing-fixture correction |
| `npm test` | PASS 1355/1355, exit 0; 50 added DHL tests/subtests |
| `npm run test:e2e` | PASS 60/60 plus production build, exit 0; existing regression, no DHL declaration form journey |
| `npm run typecheck` | PASS, exit 0 |
| `npm run format:check` | PASS, exit 0 |
| `python3 scripts/verify_plan.py` | PASS, exit 0; structure/links only |
| `git diff --check` | PASS, exit 0 |

Expected and observed: the reviewed cross-border declaration retains two serialized packed allocations with their full quantity of one each, independent CAD unit values 12345 and 12346 (total 24691 minor units), two total line net weights of 250 grams (500 grams combined) and a 1000-gram gross parcel. The leading-zero commodity code remains text. Native USD order/stock/shipment and unissued invoice facts stay unchanged. A separate actual bulk receipt/order/pick/pack produces one quantity-two allocation; partial quantity one is refused, explicit USD valuation is retained and line net weight remains a total rather than a per-unit weight. A separate simulated packed snapshot exercises aggregate safe-integer overflow; it is not evidence of large-volume native fulfillment.

Preparation requires explicit offset/seconds, goods description and supported incoterm; cross-border customs is mandatory and domestic customs is refused. Every packed allocation must appear exactly once. Unknown fields, padding/ASCII controls, sparse or extended arrays, foreign/duplicate/omitted allocations, wrong/fractional quantities, invalid dates/clocks/offsets, unsupported currency/incoterm/export reason, noninteger/out-of-bound values and excess net weight fail without a booking or native change. The static validator deliberately accepts historical valid dates for retained review/recovery. Country and commodity checks establish syntax only.

Actual close/reopen of the same application database retains the immutable declaration and original receipt. Caller/returned-object mutation cannot rewrite it. Changed key payloads conflict; cancellation permits a separately reviewed successor while history preserves the first review. Stored declaration tampering fails integrity reads. Current site, role, active-user and password restrictions precede cached preparation and scoped review/history, even with forged actor fields. Customer withdrawal refuses new preparation. Forced platform audit failure rolls back intent/command and allows the identical key after the trigger is removed. Authenticated HTTP rejects nested extras and string-valued integers, refuses missing reviews/incorrect CSRF, denies anonymous reads and retains exact retries. The amended existing routing fixture supplies an explicit domestic DHL review and asserts the retained review reaches the selected synthetic adapter.

Preserved failures: strengthened focused run was 47/48 because the test expected RESIDENCY_CHOICE_REQUIRED instead of the actual RESIDENCY_BLOCKED withdrawal refusal. Corrected only the error assertion and added bulk/opposite-direction cases; final DHL focused run passed 50/50. First full backend run was 1354/1355 because the older synthetic DHL routing fixture omitted the newly mandatory review. Added explicit review plus adapter assertion; repaired focused run passed 126/126 and backend passed 1355/1355. No guard or test was removed. Logs and superseded captures remain private and hashed. Earlier preliminary checks are retained as nonfinal evidence.

Self-review checked exact object/integer/calendar validation, full native allocation conservation, total value/weight bounds, canonical owned copies, hash/history integrity, current authority before cached commands, audit atomicity, strict HTTP fields and independence from native billing/stock. Historical receipts and license notices match. This is local engineering review, not independent security, customs or operator acceptance.

Remaining: DHL client/runtime configuration and warehouse declaration UI, actual send-time/horizon policy, private customs documents and uncertain-response recovery, actual account/service/protocol/terms/residency/fee qualification, real classifications/values/invoices, physical labels/devices and security/load/retention/recovery/human operating acceptance. No task or gate is accepted. No CI/cloud/delegation/push/PR/publication/deployment/live provider request/purchase or OPUS/UB integration. Private temporary logs have no archival guarantee.
