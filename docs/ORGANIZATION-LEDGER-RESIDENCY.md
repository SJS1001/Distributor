# Organization residency review for stock journals

D-009/D-034/D-036/D-039 engineering work. The native service and authenticated API record an organization's separate processing choice for QuickBooks **sandbox stock-cost journals**. No journal execution, scoped ledger credentials, durable delivery queue or browser form is connected by this change. All product tasks and gates remain NOT VERIFIED.

## Review and authority

A new organization starts at strict revision 1 without a stored acceptance. A current administrator publishes immutable regional terms naming minimum data, processing countries, subprocessors, retention/deletion, withdrawal consequences, provider terms reference and reviewed evidence. The scope is fixed to `quickbooks` / `stock-cost-journal` / `sandbox`; it cannot be broadened by a submitted provider, customer identifier or environment. Publishing requires the exact previous current disclosure ID, including `null` if none is current. Version names cannot be reused. An administrator can withdraw only the current disclosure with a retained audit reason. Terms and prior acceptances remain readable.

Current finance staff or administrators may record strict residency or accept the exact current terms ID and SHA-256 hash for one numeric sandbox company realm. Acceptance requires a recorded authorized organization representative, evidence reference and acknowledgment. These fields are attestations; the service does not independently establish the representative's authority, vendor terms or actual processing location. Account-bound principals, buyers and other roles cannot review or authorize organization journals. Current grants, activity and password-change requirements are checked even before returning an exact cached command receipt. HTTP uses existing session, MFA, origin and CSRF controls.

Each choice appends the next revision and requires the exact reviewed prior revision. Simultaneous different choices cannot overwrite the same review. Identical retries return the original receipt without restoring a withdrawn choice. Moving to strict residency blocks future permission. Replacing or withdrawing terms blocks accepted permission until a new current review is recorded. Reaccepting terms after withdrawal creates a new revision and never revives an old effect's authority stamp. Changes are audited atomically with command receipts and roll back together on failure.

Buyer/customer exceptions are independent and cannot authorize this whole-organization operation. Existing buyer-scoped credentials and generic effects are unchanged. Choosing a region does not migrate storage; cross-region choices refuse. This review does not claim that accepting named processor exceptions keeps all processing within Canada or within the US.

## Authenticated API

Use the existing direct command body and `idempotency-key` header at `POST /api/commands/:name`; see [native API contracts](CONTRACTS.md) for application boundaries. New command names are:

| Command | Review input |
| --- | --- |
| `organization.ledger-disclosure.publish` | `region`, `previousDisclosureId`, unique `version`, `purposes`, `minimumData`, `processingCountries`, `subprocessors`, `retention`, `withdrawal`, `termsReference`, `reviewEvidence` |
| `organization.ledger-disclosure.withdraw` | Exact current `disclosureId` and `reason` |
| `organization.ledger-residency.choose` | `region`, prior `revision`, `mode`, `realm`, `acknowledgment`; exception also requires `acceptance` with exact `disclosureId`, `disclosureHash`, `representative`, `evidenceRef` |

Choice `mode` is `strict` or `provider-exception`. Strict requires `realm: null` and omission of `acceptance`. Exception requires a decimal string realm beginning with 1–9 (up to 40 digits) and exact current terms. Unknown fields, including customer identifiers or an alternative scope, refuse. Disclosure lists and text fields are bounded; country codes use uppercase two-letter syntax without claiming qualification of those countries.

| Read | Result |
| --- | --- |
| `GET /api/organization/ledger-residency` | Current choice, current terms, consent eligibility `allowed` and reason (`strict`, `terms-unavailable`, `terms-changed` or `null`) |
| `GET /api/organization/ledger-residency/history?after=REVISION` | At most 20 retained choices, newest first; optional next revision cursor must exist within the current organization |
| `GET /api/organization/ledger-disclosures/:disclosureId` | Exact retained terms, hash, publisher and timestamp within the current organization and region |

The read result's `allowed` describes consent eligibility only. It does not clear a recovery hold or authorize provider delivery. Reads have no processing side effect. No customer-supplied organization ID selects this scope.

## Prospective execution fence

`identity.organizationResidency.permission(actor, realm)` checks current native authority, region, current accepted disclosure/revision/company and the provider recovery hold in one transaction. It returns an exact permission stamp. `assertAllowed(actor, stamp)` recaptures and compares every scope field and revision, refusing later withdrawal, terms drift or a different company. A held restored store may retain consent eligibility in its history while execution permission refuses with `RECOVERY_HOLD`.

These synchronous methods are foundations for a future native guard. They supply no token, lease or delivery authorization by themselves. Before connecting the [disabled journal candidate](QUICKBOOKS-STOCK-JOURNAL.md), implement organization-scoped credential authority, durable immutable source/effect/reference reservations and exclusive leases, current approval/mapping/period checks, correction ordering, interruption handling and append-only provider observations/retry binding. Independent external reconciliation and actual vendor, infrastructure and representative qualification remain required. In-flight or previously transmitted data cannot be recalled by a later local choice.

## Upgrade and evidence

[Schema 11](SCHEMA-UPGRADES.md) adds three IAM-owned tables. Reviewed fresh-file upgrades from exact versions 1–10 add empty organization consent storage and conserve existing records, sessions and ciphertext. Prior buyer choices never become organization acceptance. Exact current clones retain terms and revision history. Encrypted isolated restore retains the provider hold; consent review cannot remove it.

The [local receipt](evidence/LOCAL-ORGANIZATION-LEDGER-RESIDENCY-2026-10-03.md) binds the tested source and synthetic CA/US boundaries, including independent concurrent applications, stale roles/revisions, withdrawal, tampering, bounded history, HTTP refusals, historical upgrades and held restores. No CI job, workflow, live provider call, account, PR, merge or deployment was created.
