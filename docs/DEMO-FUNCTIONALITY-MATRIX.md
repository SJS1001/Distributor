# Distributor public demo functionality audit

Audit date: 2026-10-05. The public v1 Site is a separate browser-local teaching model. The expanded standalone draft in `sites-demo/dist/app.js` is **unpublished** and is **not an exact replica**. Publication was paused when the owner requested exact native-system representation. No product gate is verified by this audit.

## Architecture and parity decision

The native UI is `src/web/main.tsx` (approximately 7,000 lines) and 94 web TypeScript/TSX files at audit time, including deferred specialist panels. `src/web/navigation.ts` defines 15 pages with role-specific visibility. Native transport includes normal JSON reads/commands and binary document/evidence/label downloads. The reproducible register below enumerates **133 actual registered commands** and **313 native HTTP method/path pairs** (automatic HEAD aliases and static routes excluded).

The standalone static demo uses independent HTML templates, single-line orders, aggregate product quantities and localStorage. It cannot faithfully reproduce multi-line native contracts, serialized custody, policy enforcement or review concurrency. Adding menus cannot resolve this gap. **The chosen parity architecture is the actual React UI plus an isolated native Node backend**, serving a fictional dataset with no production credentials or real external transport. Reuse the native application composition, command registry, HTTP handlers, SQLite domain owners and exact shared contracts. Do not intercept/reimplement the API in a second browser simulator. Seeded simulated provider/carrier outcomes must remain visibly labeled and must not silently bypass native review/authorization contracts.

The native backend cannot be hosted unchanged in the existing static Site/browser runtime: `src/server/database.ts` uses Node's `node:sqlite`, filesystem persistence and SQLite authorizers; native PDF/rendering uses native dependencies, and `src/server/main.ts` composes a Fastify runtime. Hosting an isolated native demo requires a qualified Node runtime, controlled dataset resets/session isolation and external I/O blocked or explicitly replaced by deterministic fictional adapters. Source reuse preserves implemented behavior; it does **not** prove every workflow. Native CLI `demo` seeds only a minimal warehouse/customer/product/PO/receipt scenario, not all specialist workflows.

### Native MVP implementation

`src/demo/runtime.ts` now instantiates the actual `Application` and `createHttp`; `src/demo/gateway.ts` forwards the real HTTP surface and serves the unchanged production `dist` build. This retains all 15 pages, 133 registered commands and 313 registered native method/path pairs, including specialist deferred panels and binary downloads. The only frontend addition is a demo notice linking to role/reset controls. There is no second implementation of business rules.

The seed uses native commands to populate serialized/bulk stock, two warehouses and customers, supplier purchases, a partially received incoming commitment with quarantine holds, multi-line open orders, a picked/packed/handed-over order, invoice/partial payment, return claim, transfer and count discrepancy. Eight credentials cover all seven application roles and an independent finance reviewer. These are starter scenarios; empty native queues can be populated through the actual native workflows.

**Representation is source reuse, not universal verification.** Real Stripe/QuickBooks/carrier/email transports are disabled. The native demo now injects explicitly fictional Stripe responses, signed local callbacks and a native settlement worker. Onboarding selects success, unpaid/expired checkout or pending/failed refund scenarios. No hosted card-entry or decline form is represented. Offline carrier booking/label simulation now uses native carrier dispatch and explicit handover; Canada Post also uses native group/manifest confirmation. These are generic fictional outcomes, not qualified vendor protocols. QuickBooks invoice, payment, credit/application, refund expense/application and invoice balance reads use an isolated fictional ledger; OAuth/company authorization and cost/stock journal transport remain outside this simulation. Physical scanners/printers, actual regional hosting, production onboarding, other background workers and protected operator CLI procedures are not demonstrated as browser workflows. The native CLI files are listed below as operator-only surfaces. Temporary demo provisioning is separate from production signup. The public v1 Site has not been replaced; this native runtime currently runs locally and requires Node-capable hosting to share remotely. See [native demo](NATIVE-DEMO.md) for launch, limits and focused evidence.

### Existing public v1 versus unpublished draft

Public v1 has full-order shipping without native pick/pack, full receipts directly usable, full payment recording, read-only warehouse values and return inspection only. It does not execute native APIs or components. Provider/reconciliation/security panels are illustrative. The unpublished draft adds connected bulk incoming promises, quarantine and inspection, partial picking/packing/handover invoicing, partial payments/credits, simple transfer/count/return-disposition teaching journeys and an explicit coverage page. Neither version has native UI or backend parity. The following matrix documents the draft analogues honestly; all missing native contracts also remain gaps in public v1. No draft was published after the exact-replica requirement.

## Page and workflow coverage

All draft actions below are fictional and local to one browser. They do not enforce separate human identities or prove provider integration. Source references identify native contracts; draft coverage describes only what exists locally.

| Native page | Native workflows and source evidence | Standalone draft coverage | Missing exact parity |
|---|---|---|---|
| Overview | Native dashboard, actionable queues and role-aware links; `overview.tsx`, `main.tsx` | Sample totals, starter checklist and links | Native dashboard shape, tenant/role scoping, all queue filters and metrics |
| Orders | Saved carts, quote/accept, multi-line amendments, reservation deadlines/expiry, incoming commitments, stock allocation; `saved-carts.tsx`, `order-amendments.tsx`, `order-reservations.tsx`, `incoming-supply.tsx`, `order-detail.tsx` | Create one-product order; usable reservation/backorder; incoming PO earmark priority; release; cancel backorder | Multi-line carts/quotes, price/tax snapshots, amendments, expiry policy, serial selections, native retry/concurrency outcomes |
| Orders / fulfillment | Pick, short pick, pack, void, partial carrier/collection handover; delivery history and carrier preparation/cancellation/claims; `main.tsx`, `carrier-booking.tsx`, `carrier-claim.tsx`, `canada-post.tsx`, `dhl-declaration.tsx` | Partial bulk pick/pack/handover; invoice only for handed quantity; delivery observation without automatic remedy | Serialized scans, native packing/shipment identities, carrier labels/quotes/claims/cancellation, Canada Post manifest groups, DHL customs declarations, all policy and recovery paths |
| Inventory | Warehouse stock/serial queues, quantity corrections, valuation, bins, stock history/dossier, missing-serial review/recovery, labels; `stock-queue.tsx`, `inventory-quantity.tsx`, `inventory-valuation.tsx`, `bin-relocation.tsx`, `serial-dossier.tsx`, `stock-labels.ts` | Aggregate stock, reserved/held/damaged split; whole-product bin move | Lot/serial custody, per-warehouse availability, valuation lineage, count-to-correction lineage, missing serial review, scan/label output, native permissions |
| Inventory / counts | Bulk/serialized observe, review policy, conflict/stale snapshots and separation of duties; `count-review.tsx`, `count-queue.tsx` | Bulk count observation then approve/reject; stale snapshot and protected-stock checks | Serial discrepancy review, independent identities, exact native snapshot/permission/version contracts |
| Inventory / transfers | Dispatch, paged queues, partial arrival and loss review; `transfer-dispatch.tsx`, `transfer-arrival.tsx`, `transfer-loss.tsx` | Available primary bulk stock enters transit, then whole arrival at secondary | Partial/lost quantities, serialized moves, destination roles, stock value in transit and transfer history parity |
| Purchasing | Supplier availability, PO draft/save/confirm, receipt history, partial receipts, inspection, incoming earmarks, supplier returns; `purchase-entry.tsx`, `supplier-availability.tsx`, `purchase-queue.tsx`, `supplier-return-queue.tsx`, `supplier-return-history.tsx` | One-product purchase with original cost; partial receipt; quarantine/usable; whole-receipt inspection; pending incoming promises become holds then usable allocations automatically, or shortage if damaged | Native multi-line drafts, supplier search/version review, serialized receipt identity, partial inspection, supplier returns, per-lot costing, failed/conflicting receipt retry |
| Catalog | Customer-product search/selection, creation, retirement/reactivation with retained history and affected saved carts; `catalog-maintenance.tsx`, `cart-quantities.tsx`, `unavailable-cart-items.tsx` | Sample browsing/search and illustrative products | Native lifecycle controls, customer price/availability contracts, cart affected-item review, exact validation |
| Billing / invoices | Shipment invoice snapshots, PDFs, cash payments/refunds, partial credits, customer inbox publication/acknowledgment, aging; `invoice-queue.tsx`, `cash-payments.tsx`, `cash-refunds.tsx`, `billing-inbox.tsx`, `refund-notices.tsx`, `api.ts` | Handover invoice, partial payment, separate credit, simulated invoice delivery, illustrative aging | Tax/currency/profile snapshots, PDF bytes/integrity/download receipts, refund/payment provenance, portal/inbox review, idempotent cash records, buyer/finance scopes |
| Billing / providers | Stripe checkout renew/close/refund, QuickBooks invoice/payment/credit/refund sync, history/callback reconciliation, scoped OAuth and revocation/disclosures; `checkout-action.tsx`, `provider-history.tsx`, `quickbooks-authorization.tsx`, `organization-quickbooks-authorization.tsx`, `organization-revocation.tsx`, `provider-disclosures.tsx` | Explicit illustrative provider status only | Entire native preparation/review/history/recovery controls; no real provider integration is represented as working |
| Billing / accounting | Cost packet policy/prepare/accept, correction successor/retry and outcomes; stock journals, mappings/permissions/decisions/reconciliation/original retry/cancellation; `accounting-costs.tsx`, `cost-corrections.tsx`, `stock-journals.tsx`, `stock-journal-*.tsx` | Explicit omitted specialist controls | All native accounting packet and journal decision contracts, independent reviewer separation, content hashes and transport lineage |
| Returns | Sold-serial warranty coverage, submit/evidence, retained policy, manufacturer referral/decision, replacement reserve/dispatch/handover and shipping; `warranty-coverage.tsx`, `sold-serial-select.tsx`, `warranty-evidence.tsx`, `warranty-decisions.tsx`, `replacement-serial-select.tsx` | Starting bulk sample return inspection, separate restock/damaged disposition; separate credit decision | Claim creation/coverage, evidence files/hashes, manufacturer workflows, serialized replacement custody, replacement shipments and claim coverage enforcement |
| Customers | Accounts/terms, buyer entry and residency choice; `main.tsx`, `provider-disclosures.tsx` | Fictional customer list/detail | Native customer creation/update controls, terms and buyer scopes, account provider residency selections |
| Security | Password change, session termination, MFA setup/confirm/disable/replacement/recovery; `mfa-security.tsx`, `required-mfa.tsx`, `factor-replacement.tsx`, `recovery-codes.tsx` | Simulated signup/login and local reset; explicitly no real authentication | Actual login/session/password/MFA contracts; demo security must be clearly simulated even with reused native UI |
| Operations health | Recovery/service status and retry controls; `operations-health.tsx`, `main.tsx` | Illustrative statuses, explicit omissions | Actual operation queues, restore/control lifecycle, dependency and provider health; native operator CLI workflows cannot be claimed as browser UI |
| Audit history | Native paged actor/action/record history; `audit-history.tsx` | Browser-local action history | Native immutable audit shape, actor scope, filters/cursors and evidence links |
| Event reporting | Event deliveries, report activity and retry; `event-reporting.tsx` | Illustrative read-only reporting | Native event filters/pages/retries, delivery receipts and report lineage |
| Reconciliation | Prepare/read/download immutable report with verified length/hash/headers; `reconciliation.tsx`, `api.ts` | Illustrative read-only summary | Native preparing/history/result contracts, actual matching report bytes and integrity/download behavior |
| Imports | Master/opening/document preview and independent decide; `main.tsx`, shared import contracts | Illustrative samples only | Actual source file/preview/validation/decision, duplicate/retry/conflict paths, opening activation and reconciliation |
| Administration | User/role controls, warehouses, business/region/residency/provider/count/warranty/accounting policies; `main.tsx` | Illustrative organization/settings | Native policy forms, validation, role restrictions, service activation and scoped configuration |

## Incoming allocation semantics checked with backend owner

The native implementation keeps pending PO commitments distinct from arrived quarantine holds and usable physical reservations. Receipt assignment uses priority 1 first and FIFO ties. Usable inspection converts held commitments atomically; damaged inspection releases to uncovered shortage. Generic usable allocation must skip incoming and held commitment quantities. Explicit release removes pending incoming before arrived holds; cancellation/amendment trims lowest priority and newest ties. The unpublished draft was aligned to these semantics, but this is not a complete native contract validation.

## Verification and outstanding evidence

- Standalone draft JavaScript syntax check: `node --check sites-demo/dist/app.js` passed on 2026-10-05.
- First connected Playwright journey attempt failed before product selection with a locator timeout. No full connected journey pass is claimed. The test also had an eager error-text lookup that needed correction. Temporary test scripts remain outside the repository.
- No new Site version was saved or deployed after the exact-replica requirement. Public v1 remains unchanged.
- Exact UI parity requires same native React source revision, all role/page/section entry points, all dialogs and specialist panels, and comparative screenshots/DOM behavior for desktop/mobile.
- Functional parity requires endpoint inventory including dynamic calls, simulator coverage of every reachable command/read/binary download, state invariant checks and negative/conflict/idempotency cases. An unsupported-operation ledger must remain visible until empty for the agreed scope.
- Provider, payment, email, carrier, identity and restore operations must remain visibly simulated and isolated. Real-world delivery, production security and readiness are outside any fictional demo parity claim.

## Source coverage register

Reproduce with `node_modules/.bin/tsx scripts/demo-parity-inventory.ts`; regenerate this section with `--write`. This registers the native Fastify runtime without listening, opening a database, invoking handlers or provider I/O. A placeholder Application is used only to capture handlers. Command names come directly from `commands(app)` keys, and routes come from Fastify after `ready()`, including expanded command/security/carrier/effect loops and webhook plugin registration. Automatic HEAD aliases and static serving are excluded. Counts prove registration only, not successful workflow execution.

- Native pages: **15**.
- Native registered commands: **133**.
- Registered method/path pairs excluding automatic HEAD/static: **313** (GET 142, POST 171).
- Native web source files: **94**, including **85 TSX files**.
- CLI/worker entrypoint files: **12**.

### Registered native commands

Every command is retained by native runtime reuse. None is executed by public v1 or the unpublished standalone draft; their analogues are listed in the page matrix. Native source reuse does not prove every command's happy/failure/recovery path.

- **account**: `account.create`, `account.hold`, `account.residency`.
- **accounting**: `accounting.cost.accept`, `accounting.cost.correction.decide`, `accounting.cost.correction.observe`, `accounting.cost.correction.prepare`, `accounting.cost.correction.retry.decide`, `accounting.cost.correction.retry.prepare`, `accounting.cost.decide`, `accounting.cost.policy`, `accounting.cost.prepare`, `accounting.cost.reconcile-journals`, `accounting.journal.cancel-correction`, `accounting.journal.cancel-original`, `accounting.journal.decide`, `accounting.journal.original-cancellation.evidence`, `accounting.journal.original-retry.prepare`, `accounting.journal.permission.decide`, `accounting.journal.permission.prepare`, `accounting.journal.prepare`.
- **billing**: `billing.credit`, `billing.payment.manual`, `billing.portal.acknowledge`, `billing.portal.publish`, `billing.portal.withdraw`, `billing.profile`, `billing.refund.manual`, `billing.refund.notice.acknowledge`, `billing.refund.request`.
- **canada-post**: `canada-post.group.cancel`, `canada-post.group.prepare`.
- **carrier**: `carrier.cancel`, `carrier.claim.release`, `carrier.prepare`.
- **cart**: `cart.quote`, `cart.save`.
- **count**: `count.decide`, `count.policy`, `count.start`, `count.submit`.
- **events**: `events.retry`.
- **fulfillment**: `fulfillment.delivery`, `fulfillment.delivery.update`, `fulfillment.pack`, `fulfillment.pick`, `fulfillment.ship`, `fulfillment.short-pick`, `fulfillment.void`.
- **import**: `import.documents.decide`, `import.documents.preview`, `import.masters.decide`, `import.masters.preview`, `import.opening.decide`, `import.opening.preview`.
- **inventory**: `inventory.quantity.decide`, `inventory.quantity.prepare`, `inventory.valuation.decide`, `inventory.valuation.policy`, `inventory.valuation.prepare`.
- **operations**: `operations.reconciliation.prepare`.
- **order**: `order.accept`, `order.allocate`, `order.amend`, `order.cancel`, `order.incoming.commit`, `order.incoming.priority`, `order.incoming.reconcile`, `order.incoming.release`, `order.reservation.deadline`, `order.reservation.expire`.
- **organization**: `organization.ledger-disclosure.publish`, `organization.ledger-disclosure.withdraw`, `organization.ledger-residency.choose`.
- **product**: `product.create`, `product.price`, `product.reactivate`, `product.retire`.
- **provider**: `provider.disclosure.publish`, `provider.disclosure.withdraw`.
- **purchase**: `purchase.create`, `purchase.draft.confirm`, `purchase.draft.discard`, `purchase.draft.save`, `purchase.receive`, `purchase.return`, `purchase.return.credit`, `purchase.return.replacement`, `purchase.return.review`, `purchase.return.void`.
- **quickbooks**: `quickbooks.credit`, `quickbooks.credit.apply`, `quickbooks.credit.cancel`, `quickbooks.invoice`, `quickbooks.payment`, `quickbooks.refund`, `quickbooks.refund.apply`.
- **serial**: `serial.missing.decide`, `serial.missing.recover`, `serial.missing.report`.
- **stock**: `stock.count`, `stock.inspect`, `stock.relocate`.
- **stripe**: `stripe.checkout`, `stripe.checkout.renew`, `stripe.refund`.
- **supplier**: `supplier.availability`, `supplier.create`.
- **transfer**: `transfer.dispatch`, `transfer.loss`, `transfer.receive`, `transfer.recover`.
- **user**: `user.create`, `user.password.change`, `user.password.reset`, `user.sessions.end-own`, `user.sessions.revoke`, `user.update`.
- **warehouse**: `warehouse.create`.
- **warranty**: `warranty.credit`, `warranty.disposition`, `warranty.inspect`, `warranty.manufacturer.decide`, `warranty.manufacturer.refer`, `warranty.policy`, `warranty.receive`, `warranty.replacement.cancel`, `warranty.replacement.dispatch`, `warranty.replacement.handover`, `warranty.replacement.reserve`, `warranty.replacement.shipping.update`, `warranty.review`, `warranty.submit`.

### Registered HTTP method/path pairs

All routes below are absent from both standalone versions. An isolated native runtime preserves these registrations and their real handlers. Providers, documents and roles still need explicit scenario validation.

| Method | Registered path |
|---|---|
| GET | `/api/accounting.csv` |
| GET | `/api/accounting/cost-correction-retries/:retryId` |
| GET | `/api/accounting/cost-corrections/:correctionId` |
| GET | `/api/accounting/cost-corrections/:correctionId/file` |
| GET | `/api/accounting/cost-corrections/:correctionId/outcomes` |
| GET | `/api/accounting/cost-policy` |
| GET | `/api/accounting/cost-source` |
| GET | `/api/accounting/costs` |
| GET | `/api/accounting/costs/:packetId` |
| GET | `/api/accounting/costs/:packetId/corrections` |
| GET | `/api/accounting/costs/:packetId/file` |
| GET | `/api/accounting/costs/:packetId/journal-reconciliation` |
| GET | `/api/accounting/journal-preparations/:key/receipt` |
| GET | `/api/accounting/journal-sources/:sourceId` |
| GET | `/api/accounting/journals` |
| GET | `/api/accounting/journals/:journalId` |
| GET | `/api/accounting/journals/:journalId/cancellation-review` |
| GET | `/api/accounting/journals/:journalId/observations` |
| GET | `/api/accounting/journals/:journalId/original-cancellation-evidence-review` |
| GET | `/api/accounting/journals/:journalId/original-cancellation-review` |
| GET | `/api/accounting/journals/:journalId/original-retry-review` |
| GET | `/api/accounting/journals/:journalId/permission-review` |
| GET | `/api/accounting/journals/:journalId/permissions` |
| GET | `/api/accounts/:accountId/provider-acceptance-versions` |
| GET | `/api/accounts/:accountId/provider-acceptances` |
| GET | `/api/audit` |
| GET | `/api/audit/page` |
| GET | `/api/billing/aging` |
| GET | `/api/billing/aging.csv` |
| POST | `/api/billing/documents/:kind/:documentId/pdf` |
| GET | `/api/billing/downloads` |
| GET | `/api/billing/inbox` |
| GET | `/api/billing/inbox/:publicationId/history/:kind` |
| POST | `/api/billing/inbox/:publicationId/pdf` |
| GET | `/api/billing/inbox/page` |
| GET | `/api/billing/invoices/:invoiceId/payments/page` |
| GET | `/api/billing/invoices/page` |
| GET | `/api/billing/payments` |
| GET | `/api/billing/payments/page` |
| GET | `/api/billing/profiles` |
| GET | `/api/billing/refund-notices` |
| GET | `/api/billing/refund-notices/:noticeId/history` |
| GET | `/api/billing/refunds` |
| GET | `/api/billing/refunds/:refundId/observations` |
| GET | `/api/billing/refunds/page` |
| GET | `/api/canada-post/groups/:groupId` |
| GET | `/api/canada-post/groups/:groupId/bookings` |
| GET | `/api/canada-post/groups/:groupId/manifest/claim` |
| GET | `/api/canada-post/groups/:groupId/manifest/document` |
| POST | `/api/canada-post/groups/:groupId/manifest/reconcile` |
| GET | `/api/canada-post/groups/:groupId/manifest/review` |
| POST | `/api/canada-post/groups/:groupId/manifest/transmit` |
| GET | `/api/canada-post/groups/:groupId/members/:bookingId/claim` |
| POST | `/api/canada-post/groups/:groupId/members/:bookingId/create` |
| POST | `/api/canada-post/groups/:groupId/members/:bookingId/reconcile` |
| GET | `/api/carrier/:bookingId/canada-post/group` |
| GET | `/api/carrier/:bookingId/claim` |
| GET | `/api/carrier/:bookingId/label` |
| POST | `/api/carrier/:bookingId/reconcile` |
| POST | `/api/carrier/:bookingId/send` |
| GET | `/api/carts` |
| GET | `/api/carts/page` |
| GET | `/api/carts/selection` |
| GET | `/api/catalog/customer-products` |
| GET | `/api/catalog/customer-products/page` |
| GET | `/api/catalog/products/:id/history` |
| GET | `/api/catalog/products/:id/review` |
| GET | `/api/catalog/products/page` |
| POST | `/api/commands/account.create` |
| POST | `/api/commands/account.hold` |
| POST | `/api/commands/account.residency` |
| POST | `/api/commands/accounting.cost.accept` |
| POST | `/api/commands/accounting.cost.correction.decide` |
| POST | `/api/commands/accounting.cost.correction.observe` |
| POST | `/api/commands/accounting.cost.correction.prepare` |
| POST | `/api/commands/accounting.cost.correction.retry.decide` |
| POST | `/api/commands/accounting.cost.correction.retry.prepare` |
| POST | `/api/commands/accounting.cost.decide` |
| POST | `/api/commands/accounting.cost.policy` |
| POST | `/api/commands/accounting.cost.prepare` |
| POST | `/api/commands/accounting.cost.reconcile-journals` |
| POST | `/api/commands/accounting.journal.cancel-correction` |
| POST | `/api/commands/accounting.journal.cancel-original` |
| POST | `/api/commands/accounting.journal.decide` |
| POST | `/api/commands/accounting.journal.original-cancellation.evidence` |
| POST | `/api/commands/accounting.journal.original-retry.prepare` |
| POST | `/api/commands/accounting.journal.permission.decide` |
| POST | `/api/commands/accounting.journal.permission.prepare` |
| POST | `/api/commands/accounting.journal.prepare` |
| POST | `/api/commands/billing.credit` |
| POST | `/api/commands/billing.payment.manual` |
| POST | `/api/commands/billing.portal.acknowledge` |
| POST | `/api/commands/billing.portal.publish` |
| POST | `/api/commands/billing.portal.withdraw` |
| POST | `/api/commands/billing.profile` |
| POST | `/api/commands/billing.refund.manual` |
| POST | `/api/commands/billing.refund.notice.acknowledge` |
| POST | `/api/commands/billing.refund.request` |
| POST | `/api/commands/canada-post.group.cancel` |
| POST | `/api/commands/canada-post.group.prepare` |
| POST | `/api/commands/carrier.cancel` |
| POST | `/api/commands/carrier.claim.release` |
| POST | `/api/commands/carrier.prepare` |
| POST | `/api/commands/cart.quote` |
| POST | `/api/commands/cart.save` |
| POST | `/api/commands/count.decide` |
| POST | `/api/commands/count.policy` |
| POST | `/api/commands/count.start` |
| POST | `/api/commands/count.submit` |
| POST | `/api/commands/events.retry` |
| POST | `/api/commands/fulfillment.delivery` |
| POST | `/api/commands/fulfillment.delivery.update` |
| POST | `/api/commands/fulfillment.pack` |
| POST | `/api/commands/fulfillment.pick` |
| POST | `/api/commands/fulfillment.ship` |
| POST | `/api/commands/fulfillment.short-pick` |
| POST | `/api/commands/fulfillment.void` |
| POST | `/api/commands/import.documents.decide` |
| POST | `/api/commands/import.documents.preview` |
| POST | `/api/commands/import.masters.decide` |
| POST | `/api/commands/import.masters.preview` |
| POST | `/api/commands/import.opening.decide` |
| POST | `/api/commands/import.opening.preview` |
| POST | `/api/commands/inventory.quantity.decide` |
| POST | `/api/commands/inventory.quantity.prepare` |
| POST | `/api/commands/inventory.valuation.decide` |
| POST | `/api/commands/inventory.valuation.policy` |
| POST | `/api/commands/inventory.valuation.prepare` |
| POST | `/api/commands/operations.reconciliation.prepare` |
| POST | `/api/commands/order.accept` |
| POST | `/api/commands/order.allocate` |
| POST | `/api/commands/order.amend` |
| POST | `/api/commands/order.cancel` |
| POST | `/api/commands/order.incoming.commit` |
| POST | `/api/commands/order.incoming.priority` |
| POST | `/api/commands/order.incoming.reconcile` |
| POST | `/api/commands/order.incoming.release` |
| POST | `/api/commands/order.reservation.deadline` |
| POST | `/api/commands/order.reservation.expire` |
| POST | `/api/commands/organization.ledger-disclosure.publish` |
| POST | `/api/commands/organization.ledger-disclosure.withdraw` |
| POST | `/api/commands/organization.ledger-residency.choose` |
| POST | `/api/commands/product.create` |
| POST | `/api/commands/product.price` |
| POST | `/api/commands/product.reactivate` |
| POST | `/api/commands/product.retire` |
| POST | `/api/commands/provider.disclosure.publish` |
| POST | `/api/commands/provider.disclosure.withdraw` |
| POST | `/api/commands/purchase.create` |
| POST | `/api/commands/purchase.draft.confirm` |
| POST | `/api/commands/purchase.draft.discard` |
| POST | `/api/commands/purchase.draft.save` |
| POST | `/api/commands/purchase.receive` |
| POST | `/api/commands/purchase.return` |
| POST | `/api/commands/purchase.return.credit` |
| POST | `/api/commands/purchase.return.replacement` |
| POST | `/api/commands/purchase.return.review` |
| POST | `/api/commands/purchase.return.void` |
| POST | `/api/commands/quickbooks.credit` |
| POST | `/api/commands/quickbooks.credit.apply` |
| POST | `/api/commands/quickbooks.credit.cancel` |
| POST | `/api/commands/quickbooks.invoice` |
| POST | `/api/commands/quickbooks.payment` |
| POST | `/api/commands/quickbooks.refund` |
| POST | `/api/commands/quickbooks.refund.apply` |
| POST | `/api/commands/serial.missing.decide` |
| POST | `/api/commands/serial.missing.recover` |
| POST | `/api/commands/serial.missing.report` |
| POST | `/api/commands/stock.count` |
| POST | `/api/commands/stock.inspect` |
| POST | `/api/commands/stock.relocate` |
| POST | `/api/commands/stripe.checkout` |
| POST | `/api/commands/stripe.checkout.renew` |
| POST | `/api/commands/stripe.refund` |
| POST | `/api/commands/supplier.availability` |
| POST | `/api/commands/supplier.create` |
| POST | `/api/commands/transfer.dispatch` |
| POST | `/api/commands/transfer.loss` |
| POST | `/api/commands/transfer.receive` |
| POST | `/api/commands/transfer.recover` |
| POST | `/api/commands/user.create` |
| POST | `/api/commands/user.password.change` |
| POST | `/api/commands/user.password.reset` |
| POST | `/api/commands/user.sessions.end-own` |
| POST | `/api/commands/user.sessions.revoke` |
| POST | `/api/commands/user.update` |
| POST | `/api/commands/warehouse.create` |
| POST | `/api/commands/warranty.credit` |
| POST | `/api/commands/warranty.disposition` |
| POST | `/api/commands/warranty.inspect` |
| POST | `/api/commands/warranty.manufacturer.decide` |
| POST | `/api/commands/warranty.manufacturer.refer` |
| POST | `/api/commands/warranty.policy` |
| POST | `/api/commands/warranty.receive` |
| POST | `/api/commands/warranty.replacement.cancel` |
| POST | `/api/commands/warranty.replacement.dispatch` |
| POST | `/api/commands/warranty.replacement.handover` |
| POST | `/api/commands/warranty.replacement.reserve` |
| POST | `/api/commands/warranty.replacement.shipping.update` |
| POST | `/api/commands/warranty.review` |
| POST | `/api/commands/warranty.submit` |
| GET | `/api/count-review-policy` |
| GET | `/api/counts` |
| GET | `/api/counts/page` |
| GET | `/api/credits` |
| GET | `/api/dashboard` |
| GET | `/api/effects` |
| POST | `/api/effects/:effectId/balance` |
| GET | `/api/effects/:effectId/balance-history` |
| GET | `/api/effects/:effectId/checkout` |
| GET | `/api/effects/:effectId/checkout/history` |
| POST | `/api/effects/:effectId/close-checkout` |
| POST | `/api/effects/:effectId/execute` |
| POST | `/api/effects/:effectId/reconcile` |
| POST | `/api/effects/:effectId/refresh-checkout` |
| POST | `/api/effects/:effectId/refresh-refund` |
| GET | `/api/events/:consumerId/deliveries` |
| GET | `/api/events/:consumerId/deliveries/:eventId/history` |
| GET | `/api/health` |
| GET | `/api/imports/documents` |
| GET | `/api/imports/masters` |
| GET | `/api/imports/opening` |
| POST | `/api/login` |
| POST | `/api/logout` |
| GET | `/api/operations/health` |
| GET | `/api/operations/reconciliation` |
| GET | `/api/operations/reconciliation/:receiptId/document` |
| GET | `/api/operations/reconciliation/history` |
| GET | `/api/orders/:id|:orderId` |
| GET | `/api/orders/:id|:orderId/amendments` |
| GET | `/api/orders/:id|:orderId/incoming-supply` |
| GET | `/api/orders/:id|:orderId/picks` |
| GET | `/api/orders/:id|:orderId/reservations` |
| GET | `/api/orders/:id|:orderId/short-picks` |
| GET | `/api/orders/page` |
| GET | `/api/organization/ledger-disclosures/:disclosureId` |
| GET | `/api/organization/ledger-residency` |
| GET | `/api/organization/ledger-residency/history` |
| GET | `/api/provider-callbacks` |
| POST | `/api/provider-callbacks/:callbackId/retry` |
| GET | `/api/provider-disclosures` |
| GET | `/api/provider-disclosures/:disclosureId` |
| GET | `/api/purchases` |
| GET | `/api/purchases/drafts/:draftId/history` |
| GET | `/api/purchases/orders/:orderId` |
| GET | `/api/purchases/orders/page` |
| GET | `/api/purchases/returns/:returnId/history` |
| GET | `/api/purchases/returns/page` |
| GET | `/api/purchases/suppliers/:supplierId` |
| GET | `/api/purchases/suppliers/:supplierId/availability` |
| GET | `/api/purchases/suppliers/page` |
| GET | `/api/quickbooks/authorization` |
| POST | `/api/quickbooks/authorization/begin` |
| POST | `/api/quickbooks/authorization/cancel` |
| POST | `/api/quickbooks/authorization/complete` |
| POST | `/api/quickbooks/authorization/disconnect` |
| GET | `/api/quickbooks/organization/authorization` |
| POST | `/api/quickbooks/organization/authorization/begin` |
| POST | `/api/quickbooks/organization/authorization/cancel` |
| POST | `/api/quickbooks/organization/authorization/complete` |
| POST | `/api/quickbooks/organization/authorization/disconnect` |
| GET | `/api/quickbooks/organization/revocation` |
| POST | `/api/quickbooks/organization/revocation` |
| POST | `/api/quickbooks/organization/revocation/review` |
| GET | `/api/security` |
| POST | `/api/security/mfa/confirm` |
| POST | `/api/security/mfa/disable` |
| POST | `/api/security/mfa/recovery/confirm` |
| POST | `/api/security/mfa/recovery/prepare` |
| POST | `/api/security/mfa/replacement/confirm` |
| POST | `/api/security/mfa/replacement/prepare` |
| POST | `/api/security/mfa/setup` |
| GET | `/api/serials/:serial` |
| GET | `/api/serials/dossier` |
| GET | `/api/session` |
| GET | `/api/shipments/:shipmentId/carrier` |
| GET | `/api/shipments/:shipmentId/carrier/history` |
| GET | `/api/shipments/:shipmentId/delivery/history` |
| GET | `/api/shipments/page` |
| POST | `/api/stock/:unitId/label` |
| GET | `/api/stock/:unitId/quantity-corrections` |
| GET | `/api/stock/:unitId/quantity-review` |
| GET | `/api/stock/:unitId/valuation-policy` |
| GET | `/api/stock/:unitId/valuation-review` |
| GET | `/api/stock/:unitId/valuations` |
| GET | `/api/stock/history` |
| GET | `/api/stock/labels` |
| GET | `/api/stock/page` |
| GET | `/api/stock/quantity-corrections/:correctionId` |
| GET | `/api/stock/serial-reviews` |
| GET | `/api/stock/valuations/:valuationId` |
| GET | `/api/transfer-destinations` |
| GET | `/api/transfers` |
| GET | `/api/transfers/page` |
| GET | `/api/users` |
| GET | `/api/warehouses/:warehouseId/canada-post/candidates` |
| GET | `/api/warehouses/:warehouseId/canada-post/groups` |
| GET | `/api/warranty/claims/:claimId/coverage` |
| GET | `/api/warranty/claims/:claimId/decisions` |
| GET | `/api/warranty/claims/:claimId/evidence` |
| POST | `/api/warranty/claims/:claimId/evidence` |
| POST | `/api/warranty/claims/:claimId/evidence/:evidenceId/download` |
| GET | `/api/warranty/claims/:claimId/replacement-candidates` |
| GET | `/api/warranty/claims/page` |
| GET | `/api/warranty/coverage-policy` |
| GET | `/api/warranty/replacements/:replacementId/carrier` |
| GET | `/api/warranty/replacements/:replacementId/carrier/history` |
| GET | `/api/warranty/replacements/:replacementId/shipping/history` |
| GET | `/api/warranty/sold-units/:unitId/coverage` |
| GET | `/api/warranty/sold-units/page` |
| GET | `/quickbooks/callback` |
| GET | `/quickbooks/organization/callback` |
| POST | `/webhooks/stripe/:bindingId` |

### Native UI file/component inventory

Public v1 and the standalone draft directly reuse none of these files. All specialist UI surfaces must be served from native source for UI parity. Export names are aids; internal/local components are covered by their owning file.

| Native file | Lines | Exported functions / responsibility |
|---|---|---|
| `src/web/accounting-balance.tsx` | 119 | AccountingBalanceReview |
| `src/web/accounting-costs.tsx` | 555 | AccountingCosts |
| `src/web/api.ts` | 491 | setCsrf, request, command, downloadReconciliation, uploadEvidence, downloadEvidence, downloadDocument, downloadStockLabel, downloadInboxDocument, downloadCostFile, downloadCanadaPostManifest |
| `src/web/audit-history.tsx` | 87 | AuditHistory |
| `src/web/billing-inbox.tsx` | 312 | usePages, BillingInbox |
| `src/web/bin-relocation.tsx` | 375 | BinRelocation |
| `src/web/canada-post.tsx` | 850 | CanadaPostWarehouse |
| `src/web/carrier-booking.tsx` | 778 | CarrierBooking |
| `src/web/carrier-claim.tsx` | 317 | CarrierClaim |
| `src/web/cart-quantities.tsx` | 262 | CartQuantities |
| `src/web/cart-save-recovery.tsx` | 286 | saveReviewedCart, CartSaveRecovery |
| `src/web/cash-payments.tsx` | 91 | CashPayments |
| `src/web/cash-refunds.tsx` | 214 | CashRefunds |
| `src/web/catalog-maintenance.tsx` | 199 | CatalogMaintenance, CatalogHistoryRows |
| `src/web/checkout-action.tsx` | 106 | CheckoutAction |
| `src/web/checkout-history.tsx` | 154 | CheckoutHistory |
| `src/web/claim-coverage.tsx` | 247 | ClaimSerialReview, RetainedClaimCoverage |
| `src/web/claim-queue.tsx` | 203 | useClaimQueue, ClaimQueueControls |
| `src/web/cost-correction-outcomes.tsx` | 237 | CostCorrectionOutcomes |
| `src/web/cost-correction-retry-review.tsx` | 204 | CostCorrectionRetryReview |
| `src/web/cost-correction-successor.tsx` | 556 | CostCorrectionSuccessor |
| `src/web/cost-corrections.tsx` | 450 | CostCorrectionsPanel |
| `src/web/count-queue.tsx` | 221 | CountQueue |
| `src/web/count-review.tsx` | 471 | CountReview |
| `src/web/deferred-page.tsx` | 34 | deferredPage |
| `src/web/demo-notice.tsx` | 32 | DemoNotice |
| `src/web/dhl-declaration.tsx` | 360 | DhlDeclarationFields, readDhlDeclaration, DhlDeclarationDetail |
| `src/web/event-reporting.tsx` | 267 | EventReporting |
| `src/web/factor-replacement.tsx` | 253 | FactorReplacement |
| `src/web/incoming-supply.tsx` | 665 | IncomingSupply, IncomingSupplyWorkspace |
| `src/web/inventory-quantity-contract.ts` | 530 | ensure, canonical, hash, movementShape, quantityReviewShape, quantityInputShape, quantityRecordShape, validateReviewRead, validateReviewResponse, validateRecord, validatePage, validateAttempt, readAttempt, immutableRecord, validateReply, eligibleSource, validateMovements |
| `src/web/inventory-quantity.tsx` | 913 | InventoryQuantity |
| `src/web/inventory-valuation-contract.ts` | 399 | canonical, hash, ensure, validatePolicyRead, validateReviewRead, validateValuation, validateAttempt, readAttempt, validateReply |
| `src/web/inventory-valuation.tsx` | 875 | InventoryValuation |
| `src/web/invoice-queue.tsx` | 243 | useInvoiceQueue, InvoiceQueueControls |
| `src/web/main.tsx` | 6995 | Contracts, constants or application composition |
| `src/web/mfa-security.tsx` | 256 | MfaSecurity |
| `src/web/modal.tsx` | 348 | Modal |
| `src/web/navigation.ts` | 152 | readNavigation, navigationHash, authorizedPages, authorizeNavigation |
| `src/web/operational-analytics.tsx` | 358 | Attention, OperationalAnalytics |
| `src/web/operations-health.tsx` | 153 | OperationsHealthPanel |
| `src/web/order-amendments.tsx` | 85 | OrderAmendments |
| `src/web/order-detail.tsx` | 175 | OrderDetail |
| `src/web/order-queue.tsx` | 296 | useOrderQueue, OrderQueueControls |
| `src/web/order-reservations.tsx` | 117 | ReservationStatus, OrderReservations |
| `src/web/organization-quickbooks-authorization.tsx` | 657 | OrganizationQuickBooksConnection, OrganizationQuickBooksCallback |
| `src/web/organization-revocation-contract.ts` | 220 | assert, summary, receipt, parse, validate, match |
| `src/web/organization-revocation.tsx` | 650 | OrganizationQuickBooksRevocation |
| `src/web/overview.tsx` | 544 | DistributionChart, Overview |
| `src/web/provider-disclosures.tsx` | 58 | DisclosureReview |
| `src/web/provider-history.tsx` | 270 | ProviderHistory |
| `src/web/purchase-entry.tsx` | 670 | PurchaseEntry |
| `src/web/purchase-queue.tsx` | 216 | usePurchaseQueue, PurchaseQueueControls |
| `src/web/quickbooks-authorization.tsx` | 336 | QuickBooksConnection, QuickBooksCallback |
| `src/web/reconciliation.tsx` | 317 | ReconciliationPanel |
| `src/web/recovery-codes.tsx` | 222 | RecoveryCodes |
| `src/web/refund-notices.tsx` | 180 | RefundNotices |
| `src/web/refund-payment-select.tsx` | 75 | RefundPaymentSelect |
| `src/web/replacement-serial-select.tsx` | 157 | ReplacementSerialSelect |
| `src/web/required-mfa.tsx` | 54 | RequiredMfa |
| `src/web/saved-carts.tsx` | 199 | SavedCarts |
| `src/web/saved-filters.tsx` | 95 | savedFilterKey, readSavedFilters, SavedFilters |
| `src/web/scan-input.tsx` | 261 | ScanInput |
| `src/web/serial-custody.tsx` | 103 | SerialCustody |
| `src/web/serial-dossier.tsx` | 336 | SerialDossier |
| `src/web/sold-serial-select.tsx` | 168 | SoldSerialSelect |
| `src/web/stock-history.tsx` | 203 | StockHistory |
| `src/web/stock-journal-cancellation.tsx` | 535 | StockJournalCancellation |
| `src/web/stock-journal-decision.tsx` | 394 | StockJournalDecision |
| `src/web/stock-journal-original-cancellation-contract.ts` | 267 | validSnapshot, parse, retained, checkedProof, checkedAttempt, checkedEvidenceReview, checkedCancellationReview, validReceipt |
| `src/web/stock-journal-original-cancellation.tsx` | 542 | StockJournalOriginalCancellation |
| `src/web/stock-journal-original-retry-contract.ts` | 231 | parse, retained, checkedReview, checkedAttempt, checkedReceipt |
| `src/web/stock-journal-original-retry.tsx` | 443 | StockJournalOriginalRetry |
| `src/web/stock-journal-permission-contract.ts` | 443 | hash, selection, disclosure, observation, prepared, prospect, history, parse, attempt, receipt |
| `src/web/stock-journal-permissions.tsx` | 730 | StockJournalPermissions |
| `src/web/stock-journal-preparation.tsx` | 821 | StockJournalPreparation |
| `src/web/stock-journal-reconciliation-contract.ts` | 275 | canonical, sha, snapshot, checkedReview, parse, retained, validReceipt |
| `src/web/stock-journal-reconciliation.tsx` | 533 | StockJournalReconciliation |
| `src/web/stock-journals.tsx` | 494 | StockJournals |
| `src/web/stock-movement-list.tsx` | 35 | StockMovementList |
| `src/web/stock-queue.tsx` | 312 | useStockQueue, StockQueueControls |
| `src/web/supplier-availability.tsx` | 567 | SupplierAvailability |
| `src/web/supplier-picker.tsx` | 164 | SupplierPicker |
| `src/web/supplier-return-history.tsx` | 101 | SupplierReturnHistory |
| `src/web/supplier-return-queue.tsx` | 221 | useSupplierReturnQueue, SupplierReturnQueueControls |
| `src/web/transfer-arrival.tsx` | 409 | TransferArrival |
| `src/web/transfer-dispatch.tsx` | 395 | TransferDispatch |
| `src/web/transfer-loss.tsx` | 521 | TransferLoss |
| `src/web/transfer-queue.tsx` | 203 | TransferQueue |
| `src/web/unavailable-cart-items.tsx` | 79 | UnavailableCartItems |
| `src/web/warranty-coverage.tsx` | 133 | SoldCoverage |
| `src/web/warranty-decisions.tsx` | 113 | WarrantyDecisions |
| `src/web/warranty-evidence.tsx` | 265 | WarrantyEvidence |
| `src/web/workspace.tsx` | 337 | WorkspaceIcon, WorkspaceNavigation, WorkspaceTabs, PageSections, PageSection |

### CLI and worker capabilities outside browser parity

These native entrypoints are preserved in source; they are not browser UI and must not be presented as working public demo controls. Operator-only restore, credential management, migrations and journal transport need explicit controlled scenarios rather than invented public buttons.

- `src/server/cli.ts` — Fictional seeding and organization bootstrap; not represented by a public browser control.
- `src/server/event-worker.ts` — Event delivery/report worker processing; not represented by a public browser control.
- `src/server/organization-authorization-cli.ts` — Organization-scoped accounting authorization operator lifecycle; not represented by a public browser control.
- `src/server/organization-revocation-cli.ts` — Organization-scoped authorization revocation operator lifecycle; not represented by a public browser control.
- `src/server/provider-credentials-cli.ts` — Provider credential configuration and inspection; not represented by a public browser control.
- `src/server/quickbooks-authorization-cli.ts` — Account-scoped QuickBooks authorization operator lifecycle; not represented by a public browser control.
- `src/server/recovery-cli.ts` — Backup/recovery operator operations; not represented by a public browser control.
- `src/server/restore-operator-cli.ts` — Restore candidate/operator phase execution; not represented by a public browser control.
- `src/server/restore-review-cli.ts` — Restore evidence and independent review decisions; not represented by a public browser control.
- `src/server/schema-cli.ts` — Schema inspection/migration operator operations; not represented by a public browser control.
- `src/server/stock-journal-transport-cli.ts` — Stock journal transport operator operations; not represented by a public browser control.
- `src/server/worker.ts` — Native integration effect queue processing; not represented by a public browser control.
