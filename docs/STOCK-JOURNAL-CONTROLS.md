# Stock-journal review and history controls

D-034/D-036/D-039 engineering continuation. Authenticated task-shaped HTTP operations expose the integration-owned [native journal queue](STOCK-JOURNAL-DELIVERY.md). These operations prepare and review local instructions, read retained records and link separately reviewed correction cancellation evidence. They do not send, look up or claim a provider operation. Creating an application does not connect the [disabled transport](STOCK-JOURNAL-TRANSPORT.md). [Browser independent decision review and recovery](STOCK-JOURNAL-BROWSER.md) are now connected; [correction cancellation review](STOCK-JOURNAL-CANCELLATION.md) is connected; [preparation forms](STOCK-JOURNAL-PREPARATION.md), [permission replacement](STOCK-JOURNAL-PERMISSIONS.md) and [complete original reconciliation](STOCK-JOURNAL-RECONCILIATION.md) are connected. [Original cancellation](STOCK-JOURNAL-ORIGINAL-CANCELLATION.md) now has native/API controls; its browser controls and fresh retry remain dependent work. All tasks and gates remain NOT VERIFIED.

## Review commands

Use the existing authenticated command endpoint with a same-origin request, current session CSRF token and an idempotency key. Nested fields are strict; additional fields refuse. Current persisted internal finance/admin authority, organization, active status and password requirements govern new commands and cached receipts. Provider recovery hold refuses preparation/decision and provider claims; separately evidenced local original/correction cancellation remains available under the hold without releasing it. Preparation does not approve or dispatch anything.

| Command | Exact reviewed inputs and effect |
| --- | --- |
| `accounting.journal.prepare` | Approved source ID/hash, original/reversal/replacement leg, exact posting date, current correction attempt or explicit null, sandbox credential binding/company, current policy revision, exact organization permission stamp, distinct source-to-receiver account IDs and reason. Native source/period/permission checks freeze the plan and its review hash. |
| `accounting.journal.decide` | Journal ID, exact review hash, approve/reject and reason. A different current finance principal reviews the frozen plan; approval reserves the permanent actual document reference. |
| `accounting.journal.original-cancellation.evidence` | Original journal ID, exact complete-history review hash, native request reference, external final-cancellation case/explanation and literal true final cancellation/non-posting/no-later-posting attestations. Appends evidence without changing uncertain state. |
| `accounting.journal.cancel-original` | Original journal ID/reference, latest final evidence hash and reason. A different current finance principal cancels locally and retains permanent source/date/reference reservations. |
| `accounting.journal.cancel-correction` | Native journal ID, actual retained document reference, exact final operator evidence hash and reason. The native operation requires the separately recorded final cancelled/unposted correction outcome and a different finance reviewer. Lookup absence and unknown original outcomes provide no cancellation authority. |

Receiver company and account IDs are positive numeric strings of at most thirty digits. Source/observation hashes are lowercase SHA-256 strings. The permission stamp names QuickBooks, stock-cost-journal, sandbox, organization, CA/US region, exact company, current choice revision and disclosure ID/hash. Buyer payment consent cannot supply this organization permission. The server verifies the full native contract; valid JSON alone is insufficient.

An exact retry uses the original body and key. A retained preparation receipt does not bypass fresh authority; independent decision and native delivery fences still apply. A lost command reply may represent a committed local effect. Closing a browser or aborting its fetch cannot undo that effect. Independent decision review has [durable browser recovery](STOCK-JOURNAL-BROWSER.md); [correction cancellation](STOCK-JOURNAL-CANCELLATION.md) has separate durable browser recovery; [preparation](STOCK-JOURNAL-PREPARATION.md) also has durable browser recovery.

## Read operations

| GET path | Response and position |
| --- | --- |
| `/api/accounting/journals` | Up to twenty descriptors with optional exact `sourceId`, state and `after` cursor. Omits the frozen source plan and operation ownership nonce/actor. |
| `/api/accounting/journals/:journalId` | Exact frozen review plan, current retained state and newest one hundred hash-checked observations. `olderObservations` signals additional retained history. No query fields accepted. |
| `/api/accounting/journals/:journalId/original-cancellation-evidence-review` | Exact unknown original, immutable source/date/company/reference and complete-history snapshot/hash for final evidence. No query fields; read-only under a hold. |
| `/api/accounting/journals/:journalId/original-cancellation-review` | Exact unknown original, latest final evidence and separate-recorder eligibility. No query fields; read-only under a hold. |
| `/api/accounting/journals/:journalId/cancellation-review` | Exact unknown correction journal and hash-checked final operator evidence/current attempt, with separate-recorder eligibility. No query fields; read-only even under a provider hold. |
| `/api/accounting/journals/:journalId/observations` | Up to twenty hash-checked observations with optional `after` cursor. Continue until `next` is null to inspect older records beyond the detail cap. |

Reads return `Cache-Control: no-store` and require fresh persisted internal finance/admin authority, including before an empty result or cursor anchor. They remain available during a provider recovery hold and conserve native business records. Foreign journals and principals cannot access a position. Queue headers are checked against the frozen plan before return; every returned observation hash binds organization, journal, revision, body, recorder and time. Reading recent observations does not verify uninspected older ones or independently reconcile provider outcomes.

Canonical cursors bind organization, principal, current role, operation kind, selected filters and (for observations) journal. Queue order follows native insertion position; observation order follows revision. The first page retains a high-water position so later inserts, including backdated journals, cannot enter older pages. State filters are live: intervening state changes can change which existing records appear on later pages. Reload the first page for current membership/new inserts. Cursors are positions, not authority or database snapshots. The database verifies an exact scoped anchor for each subsequent page. Unknown query fields, malformed/noncanonical cursors and cross-scope positions refuse.

No HTTP command exposes write/lookup leases, dispatch, result retention or transport execution. Queue reads cannot expire leases, create observations, reconcile journals or alter stock/cost facts. Twenty returned records do not establish production scan, lock or indexing performance.

## Approval timestamp consistency

Correction approval now captures one decision timestamp for both its canonical artifact and native decision record. Earlier code called the clock separately; crossing a millisecond could produce an artifact that later failed the exact integrity check. A deterministic advancing-clock test exercises preparation of the approved reversal. Existing inconsistent historical records are not rewritten; their integrity refusal remains and requires its own reviewed investigation.

## Verification and next work

The [local controls receipt](evidence/LOCAL-STOCK-JOURNAL-CONTROLS-2026-10-03.md) binds fresh workstation synthetic checks to tested source/configuration hashes and retained private failures. No actual provider, independent finance reconciliation, browser qualification, production database performance, device, infrastructure or residency acceptance is established. Scoped browser review/history and exact uncertain-decision recovery are now connected; browser preparation, permission replacement and complete original reconciliation are now connected. Native/API original cancellation now exists; original cancellation browser controls/fresh retries and organization OAuth/company verification/remote revocation remain dependent work.
