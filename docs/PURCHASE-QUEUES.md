# Review the purchase order queue

Status: local engineering, 2026-10-02. All 44 tasks and 10 product gates remain NOT VERIFIED. This extends purchasing reads and operator navigation without changing native receipt, inspection, supplier-return or stock/cost commands.

## Load and filter purchase orders

Open **Purchasing** to see up to twenty newest recorded purchase orders. **Load more purchase orders** appends the next page. **Purchase order state** selects all, open or received orders. Changing it starts a new queue and clears the previous results. Existing native receiving determines the order state; a partial receipt leaves outstanding units open.

A failed continuation preserves rows and its cursor; **Retry purchase order queue** requests the same page. A failed first filter load leaves that queue empty until retry. Refresh reloads the initial all-state queue. Navigation, refresh, sign-out and a newer filter cancel earlier page responses. Keyboard pagination restores focus to the retry/next button or the heading after the final page. Hover text exposes the complete order identifier.

Older orders become usable after loading their page. Saved receipt drafts can also be resumed, saved and reviewed for physical receipt without loading their order into the visible queue: the saved draft retains exact purchase and line identifiers, and native commands revalidate them. Supplier replacement choices use each receipt's owning product identity rather than searching visible purchase headers. Draft receipt and supplier-return histories remain governed by their existing commands. See [scanning](SCANNING.md) and [supplier returns](SUPPLIER-RETURNS.md).

## Current access and continuation

The owning page/detail reader reloads active persisted identity, role, warehouse sites and required-password restrictions inside its database transaction. Warehouse scope applies in SQL before the header limit, including an empty grant set. Commercial, finance and administrator retain existing organization scope; buyers have no purchase queue access. Supplied actor roles/sites cannot expand access. Grant changes can make an old cursor unavailable.

Each page enriches at most twenty headers with their own lines. An unenriched twenty-first header determines whether another page exists. Creation timestamp and identifier form a deterministic descending boundary, including tied timestamps and restart. The cursor encodes version, selected state and anchor identifier; it is an opaque continuation value, not a credential or signature. The currently scoped anchor is re-read before applying the state filter, so completing that anchor does not invalidate traversal. Foreign, missing or revoked anchors are unavailable.

Pages are live reads. A newer inserted order needs refresh, older orders entering the selected state may appear later, and displayed rows may become stale. There is no immutable multi-page snapshot. Authority, headers and line enrichment share the existing immediate transaction for one page/detail operation; this can contend with writers. The purchasing overview's other collections are separate reads.

## Interface and qualification limits

`GET /api/purchases` returns its initial header page as `orders` with `orderNext`, alongside existing suppliers, receipts, returns and drafts. `GET /api/purchases/orders/page` returns `{items, next}`. Optional `state` is exactly `open` or `received`; optional `after` is the returned canonical base64url cursor, at most 512 characters. Cursor version, shape and matching state are validated. Unknown or malformed fields fail validation; no page-size override exists. `GET /api/purchases/orders/:orderId` provides current scoped detail independently of the visible page.

This bounds header materialization, not per-order lines, suppliers, receipts, returns, drafts, accumulated browser rows, SQL scan/sort cost or transaction duration. Internal full-list purchase reads remain available and unbounded for compatibility. No production index, workload or concurrency target is qualified by these tests. Actual operators, physical scanners/printers, other browser engines, production security/load/recovery and providers remain unqualified. The [local receipt](evidence/LOCAL-PURCHASE-QUEUE-2026-10-02.md) records exact tested inputs and preserved failures. This is partial D-008/D-014 and REQ-03/REQ-08 engineering; it does not complete D-039 or any product gate.
