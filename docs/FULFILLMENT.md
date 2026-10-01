# Fulfillment and short-pick review

Local implementation, 2026-10-01. All tasks and product gates remain NOT VERIFIED. This workflow uses synthetic provisional policies pending warehouse/finance acceptance.

Warehouse staff at a granted site can pick serial/bulk allocations, pack selected quantities, void packing, and record collection or shipment handover. Handover consumes allocated stock and creates the original invoice; packing alone does neither. Actual carriers, labels, devices and physical handover remain to be qualified.

## Reporting unavailable allocated stock

From Orders, choose **Report short pick**, select an allocation, enter unavailable whole units and a reason/evidence reference. The command requires both the current order revision and stock revision. It releases only those allocated quantities to backorder and holds their expected book stock in quarantine. Partial bulk shortages split a held lot at the original product/site/bin/cost with procurement lineage; a serialized shortage holds the entire serial. Other reservations and already packed quantities remain protected. Void conflicting packing explicitly before reporting its quantities unavailable.

Reporting records expected stock for investigation; it is not proof of physical custody or an approved loss. It does not cancel ordered units, reduce book value, create an invoice/credit/refund or change customer exposure. Staff can allocate replacement usable supply and fulfill it, or commercial staff can cancel remaining backorders under the ordinary order rules. Found held stock requires inspection before it becomes usable and can be reallocated.

For bulk losses, record a separate count observation and obtain the administrator's review. An approved observation of zero removes the held book quantity/value at original cost. Partial lots share their original bin, so reconcile the whole bin and its other reservations/lots before treating a held-lot count as independent physical evidence. The application does not enforce distinct observer/reviewer identities; separation of duties remains an operating policy to qualify. Serialized losses use the separate custody workflow below; do not use bulk counting or relabel a serial to bypass it.

## Serialized missing stock and recovery

From Inventory, select **Report missing serial** on a quarantined, unreserved serialized unit. Enter the expected serial, a unique custody review reference and physical search evidence. Reporting preserves its one expected book unit and original cost. The serial need not be scanned when it cannot be found; the expected identity must exactly match the held record. Reconcile active order/replacement reservations before submission.

The **Serial custody reviews** panel records observation, decision and recovery evidence. Administrators can approve or reject a submitted review. Approval requires unchanged stock revision, original site/bin/product/serial/cost and no reservations, then removes one unit and its original value atomically. The unit retains its original identity and procurement/trace history as zero-quantity quarantined stock. Inspection and return disposition cannot make absent stock usable. No order cancellation, customer invoice, credit, refund, exposure change or external accounting posting occurs. Native cost movements can be included in the separate reviewed accounting handoff.

Observation does not freeze stock. If inspection or another stock change invalidates the snapshot, reject the review and submit fresh evidence using a new reference. Rejection retains the observation without changing stock quantity/value. The application permits an administrator to observe and decide their own review; distinct staff and approval-duty policy require operator qualification.

For a subsequently found unit, choose **Recover serial** on its approved loss. Scan the exact original serial and enter a unique recovery receipt reference, recovered bin and reason. Recovery checks the current stock revision and original zero-quantity quarantined identity/site/cost/product and absence of reservations. It restores that same unit at original cost in its original warehouse, in quarantine. Inspect before reallocation; recovery does not automatically reserve it or change orders/money. A later loss cycle requires new review and recovery references. Cross-site recovery, evidence attachments and correction/reversal procedures remain to be designed and qualified.

Authenticated `serial.missing.report`, `serial.missing.decide` and `serial.missing.recover` commands require strict fields, origin/CSRF and durable idempotency keys. Current principal role/site/active/password requirements precede cached results. Exact command retries return the original receipt; normalized business-reference retries also prevent a second observation/loss/recovery under new keys. Altered evidence conflicts. Review, unit, cost movement/sequence, audit, event and receipt mutations share one transaction.

`GET /api/stock/serial-reviews?after=…` returns up to 20 reviews in timestamp/ID order for administrator, warehouse, finance and support roles. Staff history is filtered to current granted sites before pagination; a cursor from an ungranted site is refused. Empty site access returns no records. The browser retains loaded rows and cursor after a failed next-page request. Refresh returns to the first page. See [the serial custody receipt](evidence/LOCAL-SERIAL-CUSTODY-2026-10-01.md) for direct workstation evidence and limits.

## History, retries and authorization

**View short picks** shows saved reports for warehouse, commercial and support users (administrator access follows the existing role policy). Warehouse access requires the order's granted site. API history pages contain 20 records with an order-scoped chronological cursor; the UI loads more reports without losing earlier pages on a failed request. Reasons are rendered as text. Current role/site/active/password requirements apply to every history read and cached command retry.

`POST /api/commands/fulfillment.short-pick` accepts only `orderId`, `revision`, `allocationId`, `unitRevision`, `quantity`, and `reason`; authenticated origin/CSRF and a durable idempotency key are required. Exact retry returns the original report without a second release/hold. A changed request using the same key conflicts. Order/inventory/fulfillment report, movement sequence, event and receipt mutations share one transaction; late audit failure rolls them all back. `GET /api/orders/:orderId/short-picks?after=…` rejects a cursor from another order.

## Evidence and remaining qualification

See [the local short-pick receipt](evidence/LOCAL-SHORT-PICKS-2026-10-01.md) for the tested candidate, failures, final checks and limitations. Workstation tests cover split/original serial identities, packed commitments, another order's reservation, restarts/retries, real grants/password requirements, tied-timestamp pagination, rollback and separate-process packing/report contention. Browser evidence uses synthetic stock and simulated lost responses; it does not establish physical shortage, operator acceptance or production capacity.

Actual bin/lot procedures, physical serial custody/writeoff/recovery, approval duties, evidence attachments, corrections/disputes, carrier exception handling, clock/retention/archive/load/security/upgrade/recovery and production residency remain unqualified. No CI, external provider request or remote publication is authorized for this checkpoint.
