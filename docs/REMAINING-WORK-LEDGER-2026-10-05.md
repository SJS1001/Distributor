# Remaining-work ledger — 2026-10-05

This is the single reconciled list of remaining Distributor work. It supersedes the scattered status lines in `REMAINING-WORK.md`, `CODING-REMAINDER.md` and `WORKFLOW-GAP-AUDIT-2026-10-05.md` wherever they disagree.

Each row has one of five classes:

- **Implemented** — code is present in current source; tested where stated.
- **Defect** — the problem has been demonstrated.
- **Missing code** — no implementation exists.
- **External input** — the work cannot proceed without something only the owner, a vendor or a reviewer can supply.
- **Deferred** — the owner explicitly deferred it.

Missing code and missing operational qualification are kept in separate sections. Implemented code is not qualified operation.

All 44 tasks in [TASKS.md](TASKS.md) and all ten gates in [CHECKPOINTS.md](CHECKPOINTS.md) remain **NOT VERIFIED**. Nothing in this ledger changes that.

Evidence key:

- **source** — the file was read in this pass.
- **grep** — absence was established by searching `src/` with the stated terms.
- **receipt** — a historical result from an earlier dated evidence document, not re-run here.
- **run** — executed in this pass. Exact commands and results are in [HANDOFF.md](HANDOFF.md), 2026-10-05 continuation.

## 1. Implemented

| Item | Evidence |
|---|---|
| Shipping commercial terms are included, extra or unspecified, and carry through quote → accepted snapshot → invoice | source `src/server/orders.ts`, `src/server/billing.ts`, `src/web/shipping-terms.tsx`; tests `tests/shipping-terms*.ts`. run: shipping-terms browser config 2/2 passed. |
| Dashboard report chooser (add, remove, reorder) with permission scoping | source `src/web/dashboard-reports.tsx`, `operational-analytics.tsx`. run: workflow-reports config 5/5 passed on the pre-lane commit. Preferences are browser-local; see §5. |
| Actual-sales, credit, payment and refund reporting by date range | source `src/server/billing-sales-report.ts`, `GET /api/reports/sales`, `src/web/financial-report.tsx`. |
| Internal scanner send-link seam (no relay configured) | source `src/server/scanner-link*.ts`, `src/web/scanner-link-delivery.tsx`. Relay qualification is in §6. |
| Gree reference to saleable SKU mapping editor and customer-side matches | source `src/web/gree-reference.tsx`, `catalog-resources.tsx`, `storefront.tsx`. No mappings are seeded; real mappings are an input (§4). |
| Tabbed page sections across Orders, Inventory, Purchasing, Billing, Customers, Returns, Imports and Administration | source `src/web/main.tsx` `PageSections`. |
| Account MSRP multipliers, detailed or net-only presentation, price history, reviewed cost, one-off overrides with a separate approver | source `src/server/order-price-overrides.ts`, `catalog-price-authority.ts`, `src/web/price-overrides.tsx`. run: price-overrides config 1/1 passed. |
| Staff customer record with Overview, History, Terms, Pricing, Notes and Contacts tabs | source `src/web/customer-record.tsx`. run: customer-record config passed (counts in HANDOFF). |
| **Canonical invoice detail** (new in this pass): `GET /api/billing/invoices/:invoiceId`, `#page=Billing&invoice=<id>`, header figures, lines, payments for finance and support, PDF, staff action menu, links from customer History | source `src/server/billing.ts` `invoiceDetail`, `src/web/invoice-detail.tsx`; run `tests/invoice-detail.test.ts` 2/2 passed (projection equality, no writes, custody, 401/403/404). This closes the one gap the 2026-10-05 customer-record release listed. |
| Append-only staff record notes | source `src/server/record-notes.ts`, `src/web/record-notes.tsx`. run: record-notes-recovery config 8/8 passed. |
| Per-customer product purchasing approval (none, all or selected) | source `src/web/purchasing-rules.tsx`. Choosing real entitlements is an input (§4). |
| Staff-reviewed contractor enrollment with one-time buyer activation | source `src/server/enrollment.ts`, `src/web/enrollment-review.tsx`. Automated email is missing (§3). |
| Saved order and invoice filters; daily history charts; storefront category paging | source `src/web/saved-filters.tsx`, `operational-analytics.tsx`, `bar-chart.tsx`, `storefront.tsx`. |
| Stripe, QuickBooks OAuth and stock-journal, Canada Post, DHL and FedEx sandbox adapters | source `src/server/providers.ts`, `quickbooks-*.ts`, `canada-post-*.ts`, `dhl-test.ts`, `fedex-sandbox.ts`. Code only; no provider qualification (§6). |
| Restore, recovery and offline-evidence coordinators | source `src/server/restore-*.ts`, `integration-offline-*.ts`. Closed by default because the restore host is unset (§4). |
| UI polish pass (this continuation) across the public site, customer portal and staff workspace | run: before/after screenshots, typecheck, build, unit and browser suites. Details are in HANDOFF. This is not owner visual acceptance; see §7. |

## 2. Defects

Two product defects found during this pass are fixed:

- **Sign-out landing.** After a reload, ending a workspace session (sign-out or a security change) landed on the public home and dropped the reason. It now always shows sign-in with its notice.
- **Stock search on refresh.** Application Refresh re-applied a stale free-text stock search. Search now clears; address-bar view and warehouse filters remain.

Before this pass, the browser suites had 137 failing journeys. They came from deliberate earlier product changes the tests had not followed: buyer Shop landing, sign-in entrances, purchasing approval, Actions disclosures and tabs. A few came from test-server port collisions. All were repaired without weakening assertions; final counts are in HANDOFF.

Resolved 2026-10-06 (owner decision): any API reply refusing the session (`401 UNAUTHENTICATED`) now returns the workspace to its sign-in entrance with "Your session has ended. Sign in again." Previously the client kept showing the workspace until a full page load.

## 3. Missing code

| Item | Evidence | Dependency |
|---|---|---|
| Automated invitation and notification email, and email-address verification | grep `nodemailer|smtp|sendgrid|postmark|mailgun|emailVerif|verifyEmail|sendMail|sendEmail` in `src/`: no hits | Needs an email provider decision (§4) before a transport seam can be qualified. A seam modelled on `scanner-link-runtime.ts` could be written first. |
| Purolator protocol client | grep: Purolator appears only as an enum or label (`src/shared/carrier-booking.ts`, `provider-choices.ts`) | Blocked on the Purolator contract (§4). Manual shipping is the accepted interim path. |
| Optional Project UB adapter (D-042 to D-044) | grep `ub adapter|project ub`: no hits | Deferred (§5). |
| Warranty summary widget | grep `warranty ?summary|warrantySummary|coverageSummary`: no hits | Its scope is undefined; deferred (§5). |
| Cross-device storage for report preferences and note-recovery drafts | source: browser-local storage | Deferred (§5). |

## 4. External input needed

| Input | Who | Unblocks |
|---|---|---|
| Purolator E-Ship contract and credentials (developer and REST routes returned 403) | Owner or vendor | Purolator client |
| Email provider choice, terms, residency and credentials | Owner | Invitation and notification email, and verification |
| Named restore host, trust registry, approvers and source fencing (`configuredRestoreHost` returns `undefined` by design, `src/server/deployment-host.ts`) | Owner and operations | Restore and recovery coordinators |
| Scheduled worker model and cadence (`src/server/event-worker.ts` has no scheduler) | Owner and operations | Event delivery and reconciliation runs |
| Business and financial policy: tax, terms, credit, case-pack, serial rules, retention, workload targets (D-001, D-004, D-006, D-012 to D-023, D-030 to D-033) | Product, finance, warehouse and warranty owners | Gate G0 |
| Real Gree model-to-SKU mappings and per-contractor purchasing entitlements | Staff or owner data entry | Customer-side reference matches with real data |
| Licence and rights evidence: Fontkit, abstract-logging, native distribution, image and manual redistribution (D-002, D-037) | Reviewer | Dependency qualification |
| Migration source files and independent opening and unpaid totals (D-035, D-039) | Operator and finance | Cutover |

## 5. Explicitly deferred

| Item | Basis |
|---|---|
| Native demo and MVP shareability | `REMAINING-WORK.md` rows 1 and 3: deferred by the owner in favour of the real Canadian app |
| Project UB qualification and adapter (D-042 to D-044) | Optional and outside baseline; `REMAINING-WORK.md` row 12 |
| Warranty summary widget | `REMAINING-WORK.md` row 12, "existing issues"; scope undefined |
| Cross-device report preferences and note recovery | Documented limitation: browser-local per organization and user |
| Further bundle splitting | Partial lazy loading exists; Vite's large-chunk advisory remains |

## 6. Operational qualification (separate from code)

| Item | Evidence needed |
|---|---|
| Physical iPhone Safari, camera scanning and device share | Real-device test. Only 390px Chromium emulation exists. |
| Printers, labels and scanner hardware, with operator cycles at both warehouses | Selected devices, media and named operators |
| Stripe, QuickBooks and carrier sandbox and production runs | Provider accounts, contracts and authority for external calls |
| Scanner email or SMS relay | Vendor terms and residency review, relay configuration, authorized test |
| Residency and CA/US named-exception acceptance | Actual processing locations and terms |
| Load, RPO and RTO, restore rehearsal, cutover, monitoring | Measured results |
| CH-01 to CH-11 acceptance, two-cycle operator pilot, production readiness | Operators and release owners |
| CI and dependency security qualification | Workflows are barred by the 2026-10-02 owner instruction; GitHub-hosted runners are the later choice |

## 7. Finite completion list

The application is not complete until each item below is closed by its owner. The list is finite; no percentage is claimed.

1. Owner visual acceptance of the polished public site, customer portal and staff workspace on a physical phone and a desktop.
2. Owner decision on global handling of server-ended sessions (see §2).
3. Email provider decision, then build and qualify the transport.
4. Purolator contract, then build and qualify the client.
5. Restore host and authority, then wire `configuredRestoreHost` in a reviewed change and rehearse a restore.
6. Scheduled worker decision and implementation.
7. Policy workbook (G0) and real data entry: Gree mappings, entitlements, terms.
8. Licence evidence for Fontkit and abstract-logging.
9. Provider and device qualification (§6).
10. Migration data and cutover rehearsal.
11. Operator pilot, CH-01 to CH-11 acceptance, and gate verification.
12. Owner scope decisions on the deferred items (§5).
