# Serial dossier API

Partial serial traceability engineering, 2026-10-02. The browser dossier view remains pending; the existing stock movement history view is unchanged. All 44 tasks and 10 product gates remain NOT VERIFIED.

Authenticated staff can request `GET /api/serials/dossier?serial=S1`. Administrator, warehouse, commercial, finance and warranty access use current persisted identity, password and role checks. Warehouse grants govern both present custody and the visibility of original receipts, shipments and claims. Missing evidence in the result means no evidence visible within that scope, not proof that no historical record exists.

The response connects the selected stock record's current position and movement page, original purchasing receipt, committed shipments with their native invoice summaries, and warranty/return claims. A replacement serial links to the original claim and invoice reference with a separate replacement state; reservation is not handover and no new sale or invoice is invented. Invoice totals are whole invoice totals, not a valuation assigned to the selected serial.

Each movement, shipment and claim section returns at most twenty records with an independent continuation token. Send those tokens as `movementAfter`, `shipmentAfter` or `claimAfter` with the same serial. Tokens bind the organization, stock identity and section, plus warehouse grants where applicable. Reads recheck current access and resolve scoped anchors; changed grants or unavailable anchors require refreshing. Newest insertion order determines shipment/claim pages even when timestamps tie. Unknown, blank, oversized or malformed query fields are rejected.

The application composes module-owned reads inside one native transaction. It does not alter business facts, call providers or process workers. Refused authenticated HTTP access can append the existing authorization-denial audit record. Receipt unit membership and shipment/invoice lineage are checked before projecting summaries; addresses, provider credentials and private evidence payloads are excluded.

Native synthetic CA/US checks cover restart, row conservation, repeated sales/returns, paging, current access, strict HTTP fields and reserved/handed-over replacement lineage. See the [local engineering receipt](evidence/LOCAL-SERIAL-DOSSIER-2026-10-02.md). These checks do not qualify physical custody, actual providers, infrastructure residency or operator acceptance.

SQL pages bound returned records and memory, not total scan cost. Shipment candidate search scans stored JSON text and then checks exact parsed unit membership; ownership enforcement remains intact. Claim filtering may scan beyond hidden records. SQLite snapshot reads reserve the writer. Indexing, contention, production latency, cancellation/replacement chains beyond the tested scenarios, delivery observations and the browser dossier experience remain unqualified. There is no schema, dependency or CI workflow change.
