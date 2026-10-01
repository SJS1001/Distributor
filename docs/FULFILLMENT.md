# Fulfillment and short-pick review

Local implementation, 2026-10-01. All tasks and product gates remain NOT VERIFIED. This workflow uses synthetic provisional policies pending warehouse/finance acceptance.

Warehouse staff at a granted site can pick serial/bulk allocations, pack selected quantities, void packing, and record collection or shipment handover. Handover consumes allocated stock and creates the original invoice; packing alone does neither. Actual carriers, labels, devices and physical handover remain to be qualified.

## Reporting unavailable allocated stock

From Orders, choose **Report short pick**, select an allocation, enter unavailable whole units and a reason/evidence reference. The command requires both the current order revision and stock revision. It releases only those allocated quantities to backorder and holds their expected book stock in quarantine. Partial bulk shortages split a held lot at the original product/site/bin/cost with procurement lineage; a serialized shortage holds the entire serial. Other reservations and already packed quantities remain protected. Void conflicting packing explicitly before reporting its quantities unavailable.

Reporting records expected stock for investigation; it is not proof of physical custody or an approved loss. It does not cancel ordered units, reduce book value, create an invoice/credit/refund or change customer exposure. Staff can allocate replacement usable supply and fulfill it, or commercial staff can cancel remaining backorders under the ordinary order rules. Found held stock requires inspection before it becomes usable and can be reallocated.

For bulk losses, record a separate count observation and obtain the administrator's review. An approved observation of zero removes the held book quantity/value at original cost. Partial lots share their original bin, so reconcile the whole bin and its other reservations/lots before treating a held-lot count as independent physical evidence. The application does not enforce distinct observer/reviewer identities; separation of duties remains an operating policy to qualify. Serialized loss/writeoff custody review remains unimplemented; do not use bulk counting or relabel a serial to bypass it.

## History, retries and authorization

**View short picks** shows saved reports for warehouse, commercial and support users (administrator access follows the existing role policy). Warehouse access requires the order's granted site. API history pages contain 20 records with an order-scoped chronological cursor; the UI loads more reports without losing earlier pages on a failed request. Reasons are rendered as text. Current role/site/active/password requirements apply to every history read and cached command retry.

`POST /api/commands/fulfillment.short-pick` accepts only `orderId`, `revision`, `allocationId`, `unitRevision`, `quantity`, and `reason`; authenticated origin/CSRF and a durable idempotency key are required. Exact retry returns the original report without a second release/hold. A changed request using the same key conflicts. Order/inventory/fulfillment report, movement sequence, event and receipt mutations share one transaction; late audit failure rolls them all back. `GET /api/orders/:orderId/short-picks?after=…` rejects a cursor from another order.

## Evidence and remaining qualification

See [the local short-pick receipt](evidence/LOCAL-SHORT-PICKS-2026-10-01.md) for the tested candidate, failures, final checks and limitations. Workstation tests cover split/original serial identities, packed commitments, another order's reservation, restarts/retries, real grants/password requirements, tied-timestamp pagination, rollback and separate-process packing/report contention. Browser evidence uses synthetic stock and simulated lost responses; it does not establish physical shortage, operator acceptance or production capacity.

Actual bin/lot procedures, serial custody/writeoff, approval duties, evidence attachments, corrections/disputes, carrier exception handling, clock/retention/archive/load/security/upgrade/recovery and production residency remain unqualified. No CI, external provider request or remote publication is authorized for this checkpoint.
