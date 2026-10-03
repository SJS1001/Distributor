# Reviewed stock-journal permission replacement

D-034/D-036/D-039 engineering work. Native accounting operations, authenticated APIs and Billing browser controls support a separately reviewed replacement of a frozen QuickBooks sandbox journal's organization permission. The original journal, source, account mapping, date, company, reference and review hash remain immutable. No provider execution route, polling worker or startup invocation is connected. All tasks and product gates remain NOT VERIFIED.

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

## Billing browser review and recovery

Select a frozen journal in Billing, then load replacement permission. Review the unchanged journal/source/date/company/reference and the previous and proposed permission revision, allowed operation and complete retained disclosure. Enter a preparation reason, open the fixed review and explicitly confirm. No editable inputs appear inside that fixed review and no command is sent before confirmation. A different current finance principal loads permission history, selects an undecided review, reviews its exact hash/preparer/terms, records approval or rejection and confirms a separate fixed decision. The preparer cannot select their own decision.

The browser validates initial and retry original plan hashes, exact retry predecessor stamps, organization/company scope, terms hashes, proposal hashes and append-only observation hashes before showing or accepting evidence. History displays the newest twenty reviews and an older-history indication; a known exact review ID retrieves its retained proposal/decision. Historical mode is a restriction, not current execution authority. Cancelled reads and abandoned responses cannot update a later selection. Closing a fixed review restores focus to its original action after that action is mounted again.

The exact body/key, immutable journal selection, disclosure and prepared decision evidence are persisted before transport under an organization/principal-specific browser key. Storage read-back and same-profile Web Locks are required. An open fixed review stays unchanged when another tab changes retained evidence; conflicting attempts and overlapping transport refuse. Reload/sign-out recovery retains the original attempt. Preparation recovery uses the exact original command key/body. Decision recovery first reads the exact original review/observation and validates the original decision; only an absent decision permits same-key command fallback. A competing decision, damaged evidence, malformed reply or cleanup failure preserves the original attempt. Withdrawal does not prevent historical receipt recovery under fresh finance authority and does not grant new permission.

Unconfirmed or refused attempts remain retained for reconciliation; the browser provides no discard/reset bypass. Corrupted storage and definitive refusals that cannot yield an original receipt require operator reconciliation. Same-profile locks do not coordinate different profiles/devices, and browser storage is local recovery evidence rather than encrypted production credential storage. No terms/vendor/location qualification, remote journal lookup or provider send follows from these controls.

## Delivery fences and recovery

The integration owner verifies every observation's outer hash and reduces the complete append-only approval chain before claiming an operation or using an issued lease. A new lease carries the approved effective stamp/revision with the unchanged original payload and permanent reference. Native guard, final synchronous write fence and posted-result retention each compare that lease with the chain and current organization choice. A later withdrawal, role change, state change or hold refuses. Original preparation/review receipts retain the original permission and bytes; later permission history records the separate replacement.

Schema 12 and dependencies remain unchanged. Proposal/decision, exact command receipt and audit commit together; late audit failure rolls all of them back. The public history response is bounded, but native chain validation reads every retained observation inside the database transaction. Its growing scan/locking cost requires production load and retention qualification; no constant-cost claim is made.

See the [native/API receipt](evidence/LOCAL-STOCK-JOURNAL-PERMISSIONS-2026-10-03.md) and [browser receipt](evidence/LOCAL-STOCK-JOURNAL-PERMISSION-BROWSER-2026-10-03.md). Synthetic native/HTTP checks do not qualify real QuickBooks, account/chart identities, processing locations, residency terms, finance approval or operator acceptance. Organization OAuth/company verification and remote revocation, further journal/valuation correction and durable restore activation remain open. Original cancellation/fresh retry and multiple-date reconciliation now have separate native/API/browser contracts; their synthetic verification does not qualify actual finance or provider outcomes. The [coding inventory](CODING-REMAINDER.md) records dependent work. No CI runner, provider request, account, delegated/cloud session, PR, merge or deployment is part of this increment.

The [retry follow-up receipt](evidence/LOCAL-STOCK-JOURNAL-RETRY-FOLLOW-UP-2026-10-03.md) records synthetic CA/US cancellation, lookup-only permission replacement and exact recovery qualification for retry journals.
