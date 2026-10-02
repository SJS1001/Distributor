# Stock movement history

Inventory offers read-only movement history for an exact stock record or serial. Use **Movement history** on an inventory row, or **Find serial** to scan/type an exact serial. Serialized equipment and bulk lots show their current stock identity, warehouse/bin, quantity, original unit cost, condition, state and revision. Each movement retains its original quantity/cost, warehouse, reference, reason, recorder and timestamp.

The pane displays at most twenty movements, newest committed insertion first. **Older movements** and **Newer movements** navigate pages; **Refresh movement history** starts again at the newest page. A failed read clears unavailable positions and rows. **Retry movement history** repeats the same selection and cursor. Closing returns focus to the opening control. Closing, navigation, application refresh and sign-out abandon pending reads; an abandoned response cannot reopen the pane. Long references wrap on phone widths.

## Native read contract

`GET /api/stock/history` accepts exactly one of `unitId` (1–128 characters) or `serial` (1–160 characters), plus optional `after` (1–4096 characters). Unknown fields, empty supplied values, ambiguous selection and malformed/mismatched cursors refuse. The authenticated response uses the shared `StockHistoryPage` projection: `{unit, items, next}`. It excludes organization identifiers and contains at most twenty movement rows. Reads require no mutation key and create no stock, reservation, cost, audit, command or event facts.

Inventory owns the queries. Fresh persisted active identity, role and password restrictions, current unit position and movement selection resolve within one SQLite transaction. Administrator, commercial, finance, warranty and support staff can read organization stock. Warehouse staff must have the stock record's current warehouse and see only movement warehouses in their current grants. Buyers cannot read this staff history. The current site check applies before empty pages and cursor resolution; historical access does not preserve a withdrawn grant.

Canonical cursors bind the organization, stock identity, warehouse visibility and an existing visible movement identifier. The server resolves that identifier's insertion position afresh and selects up to twenty-one rows before returning twenty. Foreign stock/site anchors, changed visibility and malformed continuations refuse. Identical timestamps do not skip rows. New movements require refreshing the first page; each returned position reflects the record when that page was read. Pages are a live view, not a frozen multi-page snapshot.

## Qualification limits

This is a stock-record movement view. Split bulk records have separate histories; it does not join all transfer, shipment, invoice, claim, replacement or supplier evidence into one end-to-end serial lineage. Movement references remain retained text rather than links to every owning workflow. The compatibility `/api/serials/:serial` read remains available and unbounded.

The SQLite transaction reserves the writer, and row limits do not qualify scans, indexes, contention or production latency. Actual scanner/camera/printer behavior, physical custody, operator policy, infrastructure residency, providers and production acceptance remain unqualified. Local synthetic [verification](evidence/LOCAL-STOCK-HISTORY-2026-10-02.md) supplies engineering observations only. All 44 tasks and 10 gates remain NOT VERIFIED; the full system remains incomplete.
