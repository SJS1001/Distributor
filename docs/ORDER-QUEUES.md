# Review the order queue

Status: local engineering, 2026-10-02. All product tasks and gates remain NOT VERIFIED. This extends the existing order, amendment and reservation workflows; it does not change accepted quantities, allocations, prices, invoices or provider work.

## Load and filter orders

Open **Orders** to see up to twenty newest recorded orders. **Load more orders** appends the next page. **Order state** selects all, open or closed orders; changing it starts a new queue and clears the previous results. An order is closed when every accepted unit is shipped or canceled. Cancellation is a line quantity, not a separate order state. Partially shipped orders with outstanding units stay open.

Failed continuation loads preserve the rows and cursor so **Retry order queue** requests the same page. A failed first filter load leaves the new queue empty until retry. Refresh reloads the initial all-state queue. Navigation, refresh, sign-out and a newer filter cancel earlier responses. Keyboard pagination restores focus to the retry/next button or the queue heading after the final page. An order identifier's hover text contains the complete identifier. Amendment and reservation histories also work for orders loaded on later pages.

The Overview open-order metric counts every order in the current account/site scope, independently of the twenty displayed headers. Order pages and that metric each use a current database snapshot; the whole dashboard is not one atomic snapshot. A change between those queries can make the displayed slice and count differ temporarily.

## Access and live queue semantics

The owning order reader reloads active identity and password restrictions before inspecting any cursor. Buyer account and warehouse site restrictions apply in SQL before the row limit, including an empty warehouse grant set. Changed grants can make a previously valid cursor unavailable. Other staff roles retain their existing organization-wide order read scope. Forged or cached actor fields do not grant access.

Each page contains up to twenty order headers, their existing lines and buyer-visible reservation summary. The extra twenty-first header determines whether another page exists and is not enriched. Creation time and identifier form the descending continuation boundary. A currently accessible cursor remains usable after its order changes state. These are live queries: an older order entering the chosen state can appear later; a newer creation needs refresh; already displayed rows can become stale. There is no immutable session-wide queue snapshot.

The read transaction holds current authority, headers, lines and reservation summaries together and prevents another SQLite connection from changing that snapshot during enrichment. It uses the existing immediate transaction mechanism; it can contend with writers. Internal full-list reads remain available and unbounded for compatibility, with fresh authority and the same account/site restrictions.

## Engineering interface and limits

`GET /api/orders/page` returns `{items, next}`. Optional `state` is exactly `open` or `closed`; optional `after` is a current-scope order identifier, at most 128 characters. Unknown/repeated/malformed query fields fail validation. No page-size override is exposed. Dashboard fields are `orders`, `orderNext` and full-scope `orderCounts: {total, open}`.

Header results are bounded, not per-order line/history size, total accumulated browser rows, SQL scan/sort cost, transaction lock duration or other dashboard collections. Production indexes, concurrency/load targets, real operator workflows, supported physical devices and other browser engines remain to be qualified. The [local engineering receipt](evidence/LOCAL-ORDER-QUEUE-2026-10-02.md) records the tested candidate and synthetic scope. See [order amendments](ORDER-AMENDMENTS.md) and [reservation deadlines](RESERVATIONS.md) for native command semantics.
