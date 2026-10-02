# Operations health

Local engineering, 2026-10-02. This is partial D-036 coverage. All 44 tasks and 10 product gates remain NOT VERIFIED.

## Read current observations

An administrator or support user can open **Operations health** and select **Refresh operations health** after operator or worker activity. The screen reads the current organization in the application's selected CA or US regional store. It shows the check time and whether a recovery hold is recorded. A regional store label does not establish physical infrastructure residency.

The authenticated `GET /api/operations/health` response uses `Cache-Control: no-store`. The application rechecks persisted account activity, role and password-change policy before returning even an empty report; ordinary HTTP session and MFA requirements still apply. These organization-wide support aggregates do not grant warehouse, customer, financial or provider command authority.

Each refresh clears the previous report while loading. A refused or failed read leaves an error and no old report. Navigation, sign-out, application refresh and a newer health request abandon the earlier response. There is no automatic polling.

## Interpret the queues

| Observation | What is counted |
| --- | --- |
| Native refunds | All retained native refund records by state |
| Stripe, QuickBooks and other provider effects | All retained effects by state; other providers share one aggregate |
| Payment callbacks | All retained callbacks by state; due counts include pending/waiting rows whose retry time has arrived |
| Refund callbacks | The equivalent retained refund callback counts and local retry eligibility |
| Refund outcome checks | Completed Stripe refund requests whose retained result still says pending or requires action; due checks additionally require an existing poll row, no claim token and an elapsed retry time |
| Carrier bookings | All retained booking records by state |
| Canada Post groups | All retained group records by state |
| Active Canada Post shipments | Active group memberships by state; creation age uses the owning group's creation time |
| Local event reporting | Unclaimed source events plus retained delivery states for the event-report consumer; due counts include unclaimed events, due retries and expired leases |

Counts cover the full matching organization, including records beyond ordinary twenty-item queue pages. Historical completed and other terminal records remain counted. Do not interpret the sum of all states as outstanding work, or add queues together as unique business transactions: an effect, its callback and its native refund can describe the same operation.

Each state includes the oldest recorded creation time. This is age since record creation, **not time spent in the current state**. Unclaimed events use event creation time; claimed delivery states use delivery-record creation time. The screen labels invalid or future timestamps explicitly. The single check time is shared by due calculations.

Event reporting also shows expired lease count, latest retained completion time and whether this consumer is registered in the serving process. Registration does not observe a separate worker, its last successful run or a heartbeat. Disabling the consumer does not hide retained history or make locally due work executable.

Unknown, blocked, failed, rejected, quarantined and requires-action records carry an operator review prompt. These labels describe retained states; no approved incident threshold or alert deadline is implied. A completed provider request can still have an unsettled refund outcome, which appears separately.

## Investigate before correction

Review [provider outcome history](PROVIDERS.md), [carrier booking history](CARRIER-BOOKINGS.md) and [event delivery attempts](EVENTS.md) in the relevant authorized screen. An authorized finance operator can run [native stock and money reconciliation](RECONCILIATION.md). Verify original records and any actual external outcome before following an owning module's retry, release or correction procedure.

A due count is only local time eligibility. It does not prove provider consent, enabled credentials, transport availability, current external state or permission to send. A recovery hold requires external reconciliation before provider activation; a health read cannot clear it. Unknown outcomes must not be treated as unsent work. The screen does not call providers, claim deliveries, execute callbacks, retry jobs, release leases, run reconciliation or change stock, billing, audit or recovery facts.

## Snapshot and limits

The application composes owning billing, integration, carrier and platform operations inside one native transaction. Each module reads only its owned tables and rechecks current authority. The report returns counts, states, fixed labels and timestamps, with a boolean recovery hold. It excludes customer identifiers, amounts, provider references, addresses, payloads, errors, credential/lease tokens and recovery archive metadata.

This transaction uses the existing `BEGIN IMMEDIATE` mechanism. It supplies one consistent local snapshot while taking a writer reservation; full-table aggregate scans, JSON result checks, index behavior, contention and latency at production scale remain unqualified. The fixed queue list and small state aggregates bound returned records, not database work. No schema or dependency change is introduced.

The [local receipt](evidence/LOCAL-OPERATIONS-HEALTH-2026-10-02.md) records synthetic CA/US restart, current access, full counts, redaction, persisted-row conservation, HTTP and phone browser verification. These checks do not qualify real provider or device behavior, physical/bank agreement, infrastructure residency, production monitoring/alerts, incident response deadlines or operator acceptance. Broader UI diagnostics and the existing large production bundle remain open.
