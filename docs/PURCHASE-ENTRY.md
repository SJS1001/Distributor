# Purchase order entry

Status: partial local engineering, 2026-10-02. All product tasks and gates remain NOT VERIFIED.

Commercial staff and administrators can open **Purchasing → Purchase order**, choose a supplier and warehouse, and search catalog products by SKU or name. The search returns twenty products per page. Selected quantities and costs survive search and paging; a selected product cannot be added twice. Remove a line to return keyboard focus to search. Enter one to 100 different products, whole quantities from 1 to 100,000 and explicit unit costs from 0 to 1,000,000,000 cents in the organization's CAD or USD currency. A zero cost must be entered explicitly. Selling prices do not prefill purchase costs.

**Review purchase order** shows supplier, warehouse, individual quantities and costs, and an exact total of the entered line costs. Tax, freight and supplier payments are not added. **Edit purchase lines** returns to the same quantities before submission. Canceling an unsubmitted review creates no order. **Create reviewed purchase order** invokes the existing native purchasing command. Creating an order does not receive stock; use separate receipt/scanning controls for partial deliveries, inspection and original-cost movements.

The catalog includes products retired for customer ordering and labels them accordingly. Retirement currently prevents new customer quotes/acceptance; it is not an approved supplier purchasing discontinuation rule. Saved receipt drafts retain their existing active-product/SKU checks. An operator must resolve any retired-product receiving restriction before using that draft workflow; this editor does not change it.

## Recover a submitted attempt

Before transmitting, the editor retains the exact reviewed payload and request key in browser local storage, scoped to the organization and staff account. On the same browser/account, reopening after reload or sign-out returns to that review. **Retry exact purchase** uses the original key and details. The server checks current authority before replaying its cached result and commits purchasing records and its command receipt atomically.

An unknown outcome freezes the submitted details. Closing or signing out cannot cancel a submitted order. Do not clear browser storage, use another browser or create a replacement order until the original attempt has been reconciled. Browser storage is recovery evidence, not authorization or proof of regional infrastructure residency. It contains supplier/warehouse/product descriptions, quantities and costs; shared-device and browser retention policies still require operator qualification.

Tabs on the same browser origin use Web Locks to serialize this account's submission. If another tab retained an attempt, the editor shows its exact details and requires a separate retry action without transmitting the different review. An unavailable lock, damaged/unreadable storage or storage-write failure refuses before new transport. Cancel/Escape remains available when idle. Browsers without the required storage/Web Locks capabilities cannot submit through this editor.

A native validation/not-found refusal (HTTP 400/404) clears the uncommitted attempt and permits correction. Authorization, conflicting keys, throttling, malformed replies, network and server failures retain the attempt for reconciliation/retry. A confirmed successful reply closes the editor and reports any subsequent refresh failure separately. Losing access does not grant authority through retained browser evidence.

## Local verification and limits

See [the local engineering receipt](evidence/LOCAL-PURCHASE-ENTRY-2026-10-02.md). Synthetic browser checks cover page/search-independent quantities, explicit blank/zero costs, review/edit/cancel, phone bounds, lost-response reload and sign-out, cross-tab adoption, damaged storage, atomic native refusal, separate partial receipts, duplicate/over-receipt refusal and original stock costs. These are direct workstation checks using production browser assets and native HTTP/SQLite fixtures.

No backend, schema, dependency or Actions workflow changes are required. Supplier/warehouse choices and legacy dashboard reads remain unbounded. Browser recovery does not coordinate different browsers, devices or cleared/copied storage; no offline purchasing contract is claimed. Live catalog traversal is not a snapshot, and search SQL costs and concurrent workload remain unqualified. Actual providers, devices, residency, production operations and human acceptance remain pending.
