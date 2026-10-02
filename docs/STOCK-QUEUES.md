# Review stock and replacement serials

Status: local engineering, 2026-10-02. All 44 tasks and 10 product gates remain NOT VERIFIED.

## Stock search

Open **Inventory** to load up to twenty stock records. Search part of a serial or bin, select a product by SKU, select a warehouse, or choose available usable stock, quarantine, damage, transit, sold or scrapped records. Serial/bin searches treat `%` and `_` literally. Case folding follows SQLite's `lower()` behavior and does not promise full Unicode matching. Changing a filter clears prior results. Enter or **Search stock** runs the typed search; **Load more stock** appends another page.

Failed continuation retains its rows and cursor; **Retry stock queue** repeats the failed request. Refresh returns to the initial unfiltered page. Navigation, refresh, sign-out and newer filters cancel older requests. Keyboard pagination moves focus to the retry/next button, or the heading after the final page. Existing inspection, count, transfer, label and custody actions remain available on loaded records; commands revalidate current permissions and native facts.

Overview's **Available units** uses a separate full scoped total, including records beyond the first page. It sums positive usable stock quantity less native allocations and reserved replacements. Quarantine, damaged, transit, sold and scrapped records contribute zero. This is neither a physical count nor a substitute for [reconciliation](RECONCILIATION.md).

## Replacement selection

For an inspected claim or reviewed repair, **Approve replacement** opens an independent twenty-serial search. The server resolves the returned unit's product from the original claim through inventory's owning API; neither the returned serial nor its replacement needs to be on the dashboard's stock page.

Candidates are usable, unreserved, single-unit serialized stock of that product at currently permitted warehouses. The returned serial must remain quarantined; claims with a credit or active replacement cannot obtain candidates. Search a serial/bin or choose **Next replacement serials**. Selection clears when searching or changing page. A failed page retains results for inspection and permits retry. Closing, navigation, refresh and sign-out discard late responses. Successful loading focuses the serial selector. Reserving still requires a selected serial, disposition and review evidence; the native command checks claim state, custody and availability again. See [warranty procedures](WARRANTY.md).

## Access and interface

Stock page and summary reads reload active persisted role, organization, warehouse grants and required-password restrictions in their own database transactions. Warehouse workers see only their current sites; empty site grants return no stock. Existing finance, commercial, support and warranty organization-wide stock visibility is provisional. Buyers have no stock endpoint. Replacement search requires current administrator or warranty authority; nonadministrators are restricted to current sites. Claim and inventory review share warranty's transaction. Forged caller grants cannot expand scope.

`GET /api/dashboard` returns the initial `stock` page, `stockNext` continuation, and `stockSummary: {available}`. `GET /api/stock/page` returns `{items, next}` with optional `query` (at most 100 characters), `productId`, `warehouseId` (at most 128 each), `view`, and `after` (at most 4096). `view` accepts exactly `available`, `quarantine`, `damaged`, `transit`, `sold`, or `scrapped`. `GET /api/warranty/claims/:claimId/replacement-candidates` accepts only optional `query` and `after`. Strict schemas reject unknown fields and page-size overrides. Both routes require a session and return no-store responses.

Each canonical base64url cursor binds its version, purpose, search/product/warehouse/view and anchor identifier. Replacement purpose includes the original returned unit. Cursors are continuation data, not credentials or signed grants. The anchor is re-read under current custody before filtering; changes to its condition do not prevent traversal, but missing, foreign or newly inaccessible anchors remain unavailable. Ordering uses ascending stable identifier, with a twenty-first matching record determining continuation. Scope and filter predicates are applied before the SQL limit. Organization boundaries apply to units, allocation totals and replacement holds.

## Qualification limits

Pages are live reads, not immutable snapshots. Newly created identifiers before the current boundary require refresh; changed matching records beyond it may appear on later pages. Previously loaded custody and quantities can become stale. One page is transaction-consistent; summary and other dashboard collections use separate reads.

The limit bounds returned records, not accumulated browser rows, SQL work, full-summary scans, other dashboard collections or write contention from immediate read transactions. Existing internal full-list stock reads remain unbounded. Production indices/workload targets, staff visibility policy, actual devices/providers, cross-browser behavior, hosting residency, security/load/recovery qualification and observed operator acceptance remain open.

The [local engineering receipt](evidence/LOCAL-STOCK-QUEUE-2026-10-02.md) identifies tested inputs, synthetic results and retained failures. This is partial D-008/D-013/D-016/D-032/D-033 and REQ-03/REQ-07/REQ-10/REQ-17 engineering. It does not complete D-039 or pass any product gate.
