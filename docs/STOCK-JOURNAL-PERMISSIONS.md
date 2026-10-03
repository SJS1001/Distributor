# Reviewed stock-journal permission replacement

D-034/D-036/D-039 engineering work. Native accounting operations and authenticated APIs support a separately reviewed replacement of a frozen QuickBooks sandbox journal's organization permission. The original journal, source, account mapping, date, company, reference and review hash remain immutable. No browser replacement form, provider execution route, polling worker or startup invocation is connected. All tasks and product gates remain NOT VERIFIED.

## Review and independent decision

An undispatched pending journal may propose current permission for its original write. An unknown outcome or expired/clock-invalid lease may propose lookup permission only. Ready, rejected, posted, cancelled and actively leased journals cannot propose replacement. Reviewing an expired lease does not clear it; a subsequent authorized lookup claim records uncertainty and retires its ownership. An old issued lease cannot acquire the replacement stamp.

The prospective read checks current internal finance authority, password status, organization, current accepted terms/company/revision and provider recovery hold in one transaction. It returns the original journal, previous authority and its hash, the current authority, operation mode and retained terms. Replacement must preserve the original provider, operation, sandbox environment, organization, region and company. Changed credentials must be separately qualified; this operation does not install or grant a credential.

Preparation records exact original journal/review hash, previous effective permission hash, current authority, mode and reason as an append-only observation. A different current internal finance principal approves or rejects that exact proposal hash. Approval rechecks current authority, journal state, predecessor hash and native facts atomically. Competing proposals cannot both advance the same predecessor. Rejection records the review without advancing permission. Once permission is limited to lookup, a later approval cannot restore write permission.

For a pending write, current source, correction attempt, account mapping, date/period and policy must reconstruct the complete original plan with only its permission stamp substituted. Every other byte remains exact. Lookup retains the exact approved source without imposing a newer write-period policy. Neither mode rewrites or reposts the journal, changes inventory/billing facts, clears uncertainty or removes a provider hold.

## Authenticated APIs

All reads require fresh persisted finance/admin authority in the native organization and return `Cache-Control: no-store`. Commands use existing session/MFA, origin/CSRF and exact `idempotency-key` controls. Unknown query/body/nested authority fields refuse.

| Operation | Contract |
| --- | --- |
| `GET /api/accounting/journals/:journalId/permission-review` | Read-only current prospective review; no query fields |
| `GET /api/accounting/journals/:journalId/permissions` | Effective retained authority, historical mode, newest twenty proposal/decision records and `olderReviews` |
| Same history read with `?reviewId=ID` | One exact retained proposal and its decision; organization-scoped not-found refusal |
| `POST /api/commands/accounting.journal.permission.prepare` | Exact `journalId`, original `reviewHash`, `previousPermissionHash`, `authority`, `mode` and `reason` |
| `POST /api/commands/accounting.journal.permission.decide` | Exact `journalId`, `permissionReviewId`, `permissionReviewHash`, `decision` (`approve` or `reject`) and `reason` |

The nested authority has exactly `provider`, `purpose`, `environment`, `orgId`, `region`, `realm`, `revision`, `disclosureId` and `disclosureHash`. Complete outer observations remain available through [existing paged history](STOCK-JOURNAL-CONTROLS.md). History's mode is a retained restriction, not current execution permission or proof of write eligibility. History and exact cached command receipts remain readable after withdrawal or a provider hold, under fresh finance authority; replay adds no observation or permission.

## Delivery fences and recovery

The integration owner verifies every observation's outer hash and reduces the complete append-only approval chain before claiming an operation or using an issued lease. A new lease carries the approved effective stamp/revision with the unchanged original payload and permanent reference. Native guard, final synchronous write fence and posted-result retention each compare that lease with the chain and current organization choice. A later withdrawal, role change, state change or hold refuses. Original preparation/review receipts retain the original permission and bytes; later permission history records the separate replacement.

Schema 12 and dependencies remain unchanged. Proposal/decision, exact command receipt and audit commit together; late audit failure rolls all of them back. The public history response is bounded, but native chain validation reads every retained observation inside the database transaction. Its growing scan/locking cost requires production load and retention qualification; no constant-cost claim is made.

See the [local verification receipt](evidence/LOCAL-STOCK-JOURNAL-PERMISSIONS-2026-10-03.md). Synthetic native/HTTP checks do not qualify real QuickBooks, account/chart identities, processing locations, residency terms, finance approval or operator acceptance. Browser replacement review/recovery, organization OAuth/company verification and remote revocation, original cancellation/fresh retry, multiple-date reconciliation, further journal/valuation correction and durable restore activation remain open. The [coding inventory](CODING-REMAINDER.md) records dependent work. No CI runner, provider request, account, delegated/cloud session, PR, merge or deployment is part of this increment.
