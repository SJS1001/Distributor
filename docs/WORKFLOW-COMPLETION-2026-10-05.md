# Workflow completion ledger

Owner request, 5 October 2026: close missing implementation and workflow blind
spots, using parallel agents; preserve evidence and distinguish deployed work
from local changes. No PR merges or CI jobs. This ledger does not pass product
gates or substitute for external qualification.

| Work item | Owner | Status / completion evidence required |
| --- | --- | --- |
| Per-customer MSRP multiplier and net-only/detailed price policy | Pricing backend + interface agents | Deployed; focused backend + customer-pricing browser passed; exact cents and account-scoped detailed/net-only projections |
| Explicit product MSRP, savings percentage and dollar value | Pricing backend + interface agents | Deployed; reviewed MSRP separate from base/acquisition cost; detailed/net-only browser checks passed |
| Historical price and policy changes | Pricing backend + interface agents | Deployed; append-only before/after policy/MSRP records and historical document prices verified in focused tests |
| Shorter catalog and focused product management | Parent | Deployed; replacing cursor pages and focused product dialog; catalog browser checks passed |
| Customer administration tabs | Interface agent | Deployed; Accounts, Pricing, Purchasing rules, Provider terms; pricing browser passed |
| Customer reports and graphical administration reporting | Parent | Deployed; date/currency-scoped financial reports and graphical customer/admin views; backend and browser checks passed |
| Add/remove/reorder workspace report cards | Parent | Deployed; per-browser/org/user show/hide/reorder/reset; phone/reload/account isolation browser checks passed |
| Explicit shipping included/extra and preserved sale adjustments | Gap audit then implementation | Deployed; explicit tax/once-only partial-shipment charge and immutable snapshots; shipping backend/browser checks passed |
| Specification-to-code blind-spot review | Independent audit agent | Source audit complete: docs/WORKFLOW-GAP-AUDIT-2026-10-05.md; six gaps implemented; external qualification limits remain explicit |
| Reviewed wholesale cost and reasoned price overrides with separate exception approval | Pricing backend, shipping and interface agents | Deployed; cost/limits/history/one-off lifecycle and MFA fix verified; final buyer browser check passed, including no cost/margin/reason disclosure |
| Scanner link through internal email/SMS | Parent + independent reviewer | Adapter/HTTP/UI implemented; local browser lost-response and validation recovery passed; independent security/retry review and nine backend tests passed. Live provider remains unconfigured |
| Session-aware public navigation, breadcrumbs and private verified staff notes | Navigation, notes and parent integration | Deployed in a5ca594/schema28; guest/customer/admin live checks and independent note verification covered; five-pass follow-up corrections pending final release |
| Manufacturer reference to saleable model continuity | Pricing backend + interface | Explicit mappings, current native purchasing restrictions and sign-in context implemented; backend/browser checks passed. No fabricated mapping of sample SKUs |

Three Codex subagents completed their assigned work with explicit responsibilities. No
separate cloud session is claimed. Current deployed release is source
`a5ca594`, schema28. See the [navigation and notes release receipt](evidence/LIVE-NAVIGATION-NOTES-2026-10-05.md) for database conservation, exact image and live checks. The [five-pass polish review](evidence/FIVE-PASS-POLISH-2026-10-05.md) tracks subsequent local corrections and their deployment status.

Completion must record source version, checks actually run and outcomes. Actual
provider credentials, contractual/carrier inputs, real-device evidence and host
qualification must remain explicit; a code-only result cannot certify them.

Local checkpoint: 237 focused backend/migration/recovery tests and five reporting/catalog browser journeys passed before the newly authorized override implementation. This is partial verification, not completion of all ledger rows.

Later local checkpoints: combined279/279 backend/migration checks passed, followed by12/12 current-MFA security regressions. Initial full workstation suite: 6,027/6,038 passed, 11 failed. Six process-race fixture failures now use one current cart revision and focused files pass; three invoice-access failures exposed a transaction-fence regression now fixed with new-write safety proof; one navigation assertion was stale; one recovery failure was concurrent source mutation. All affected focused reruns pass. Final frozen workstation suite passed 6,038/6,038 with zero failures, skips or cancellations. Final override, shipping and scanner browser journeys passed, along with all five reporting journeys. Typecheck, build, formatting and plan validation passed. Subsequent live release verification is recorded in the receipt above. See [pricing guide](PRICING-AND-REPORTING.md) and [scanner delivery](SCANNER-LINK-DELIVERY.md).
