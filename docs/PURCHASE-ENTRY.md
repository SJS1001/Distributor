# Purchase order entry

Status: partial local engineering, 2026-10-02. All product tasks and gates remain NOT VERIFIED.

Commercial staff and administrators can open **Purchasing → Purchase order**, search suppliers by name, choose a warehouse, and search catalog products by SKU or name. Both searches return twenty descriptors per page. The chosen supplier, selected quantities and costs survive search and paging; a selected product cannot be added twice. Remove a line to return keyboard focus to search. Enter one to 100 different products, whole quantities from 1 to 100,000 and explicit unit costs from 0 to 1,000,000,000 cents in the organization's CAD or USD currency. A zero cost must be entered explicitly. Selling prices do not prefill purchase costs.

**Review purchase order** shows supplier, warehouse, individual quantities and costs, and an exact total of the entered line costs. Tax, freight and supplier payments are not added. **Edit purchase lines** returns to the same quantities before submission. Canceling an unsubmitted review creates no order. **Create reviewed purchase order** invokes the existing native purchasing command. Creating an order does not receive stock; use separate receipt/scanning controls for partial deliveries, inspection and original-cost movements.

The catalog includes products retired for customer ordering and labels them accordingly. Retirement currently prevents new customer quotes/acceptance; it is not an approved supplier purchasing discontinuation rule. Saved receipt drafts retain their existing active-product/SKU checks. An operator must resolve any retired-product receiving restriction before using that draft workflow; this editor does not change it.

## Find a supplier

Enter a name in **Purchase supplier search**, then choose **Search purchase suppliers** or press Enter. Search accepts at most 120 characters, trims surrounding whitespace and folds ASCII case; `%` and `_` are literal characters. **Next purchase suppliers** fetches the next twenty results. Searching again starts at the first page. The initial choice comes from the first bounded dashboard page; review it explicitly before creating the order.

The selected supplier remains available when it is outside the displayed page or search. The select contains at most twenty page results plus that retained choice. A failed page removes unavailable page choices, keeps the selected supplier and offers **Retry purchase suppliers** for the same query and cursor. Superseded or closed-editor responses are discarded. Review/edit preserves an off-page supplier; submitted recovery retains its exact identifier and description independently of subsequent searches.

Native `supplierPage` and `GET /api/purchases/suppliers/page?q=…&after=…` return only `id`, `name` and a next cursor. Cursors bind the organization, normalized query and current anchor; they are neither authorization nor a snapshot. Native `supplierChoice` and `GET /api/purchases/suppliers/:supplierId` resolve one supplier within current organization authority, including suppliers outside the dashboard page. Current warehouse/commercial/finance/admin authority and password restrictions apply before reads; HTTP responses use `no-store`. The directory is organization-wide; native purchasing and receiving commands still enforce their own warehouse and business permissions.

The legacy `suppliers` operation and the `suppliers` field of `GET /api/purchases` now return the first twenty descriptors; the HTTP dashboard also exposes `supplierNext`. Clients requiring more suppliers must traverse the page operation. These reads create no order, stock or money effect.

## Recover a submitted attempt

Before transmitting, the editor retains the exact reviewed payload and request key in browser local storage, scoped to the organization and staff account. On the same browser/account, reopening after reload or sign-out returns to that review. **Retry exact purchase** uses the original key and details. The server checks current authority before replaying its cached result and commits purchasing records and its command receipt atomically.

An unknown outcome freezes the submitted details. Closing or signing out cannot cancel a submitted order. Do not clear browser storage, use another browser or create a replacement order until the original attempt has been reconciled. Browser storage is recovery evidence, not authorization or proof of regional infrastructure residency. It contains supplier/warehouse/product descriptions, quantities and costs; shared-device and browser retention policies still require operator qualification.

Tabs on the same browser origin use Web Locks to serialize this account's submission. If another tab retained an attempt, the editor shows its exact details and requires a separate retry action without transmitting the different review. An unavailable lock, damaged/unreadable storage or storage-write failure refuses before new transport. Cancel/Escape remains available when idle. Browsers without the required storage/Web Locks capabilities cannot submit through this editor.

A native validation/not-found refusal (HTTP 400/404) clears the uncommitted attempt and permits correction. Authorization, conflicting keys, throttling, malformed replies, network and server failures retain the attempt for reconciliation/retry. A confirmed successful reply closes the editor and reports any subsequent refresh failure separately. Losing access does not grant authority through retained browser evidence.

## Local verification and limits

See [the local engineering receipt](evidence/LOCAL-PURCHASE-ENTRY-2026-10-02.md). Synthetic browser checks cover page/search-independent quantities, explicit blank/zero costs, review/edit/cancel, phone bounds, lost-response reload and sign-out, cross-tab adoption, damaged storage, atomic native refusal, separate partial receipts, duplicate/over-receipt refusal and original stock costs. These are direct workstation checks using production browser assets and native HTTP/SQLite fixtures.

The [supplier search receipt](evidence/LOCAL-SUPPLIER-PAGING-2026-10-02.md) records the subsequent bounded native supplier reads, authority checks, persisted-row conservation, phone paging/retry/cancellation and off-page exact-attempt recovery. No schema, dependency or Actions workflow change is required.

Warehouse choices, receipts and other legacy dashboard reads remain unbounded. Browser recovery does not coordinate different browsers, devices or cleared/copied storage; no offline purchasing contract is claimed. Live supplier/catalog traversal is not a snapshot; restart the search after directory changes. Search SQL scan/sort costs and concurrent workload remain unqualified. Actual providers, devices, residency, production operations and human acceptance remain pending.
