# Stock and billing reconciliation

Finance and administrators can open **Reconciliation** and select **Run reconciliation**. Authenticated `GET /api/operations/reconciliation` rechecks the persisted principal, role, organization and forced password change, then reads owning inventory, billing, order and fulfillment operations in one SQLite transaction. It changes no stock, money, command receipt, audit or provider state. Responses use `no-store`; refreshing clears the previous result, and leaving the screen cancels its pending request.

## Read the controls

Stock quantity and original cost include retained custody, quarantine and transit. Movement controls use the same signed interpretation as [stock cost accounting](ACCOUNTING-COSTS.md). Ordinary dispatch/receipt transfers have zero organization-wide effect; recorded loss/recovery changes custody. Each product's retained quantity/value is compared separately with its movement history. Missing units/sequences, orphan sequences, unsupported movement types, wrong directions, invalid timestamps and integers outside safe application bounds are discrepancies.

Billing compares invoices with their immutable line prices/tax, credits with their original invoice lines, and credited quantities with sold quantities. It checks parent relationships, opening document/line evidence, historical opening arithmetic and pending/uncertain reservations and native completed refunds against payment and credited cash capacity. Document balance is invoice total minus credits minus payments plus completed refunds. Pending and uncertain refunds are separate; rejected refunds release capacity. A negative balance can correctly represent credited cash awaiting refund.

Sales agreement compares every native committed shipment with its accepted order, consumed allocations, retained shipped units, inventory shipment deductions and invoice. It checks both invoice/shipment links, account/site/order/currency agreement, per-product invoice quantities, original order line price/tax, allocation consumption and per-unit product/site/original-cost deductions. Partial serialized and bulk shipments aggregate into order shipped quantities; a bulk allocation can be consumed by several shipments. Packed and void records must have no committed unit or invoice evidence. Invalid retained JSON is a discrepancy rather than a failed report, and its private contents are not returned.

Historical opening invoices are excluded from native sales agreement using their owning opening provenance, not an identifier prefix. Warranty returns and replacement handovers do not reverse the original sold quantity or create another ordinary sales invoice; their separate stock movements remain covered by stock controls. Native invoice line net/tax totals include only the organization's currency; quantity counts cover all native evidence and a wrong currency is a discrepancy. Original costs remain regional inventory amounts without currency conversion.

Opening credit/payment/refund amounts are retained historical evidence, not new payment or credit documents. Regional money totals include only invoices in the organization's currency. Other currencies produce discrepancies and are excluded, without implicit exchange rates. Exact integer arithmetic preserves large retained totals; unsafe individual values are flagged because ordinary business commands operate within narrower bounds.

The issue count covers the complete scan. Stock, billing and sales agreement each return at most 100 details in stable scan order, with an explicit truncation notice. Details contain control codes, record identifiers and expected/recorded values, without descriptions, supplier/customer names, payment references, reasons or credentials.

## Investigate discrepancies

1. Record the checked time, organization/currency, totals and affected identifiers in the approved support location. This screen does not retain or export a reconciliation receipt.
2. Review the original owning records, custody/count evidence and document history. A discrepancy does not establish which record is correct.
3. Use an authorized business correction or recovery procedure with evidence and review. Do not edit the database from this screen or replay an uncertain provider effect merely to obtain matching totals.
4. Run the controls again, keeping earlier failure evidence. Independently reconcile actual bank/accounting/provider statements and physical custody.

## Scope and operating limits

This native control report is partial D-036 engineering coverage. It does not establish physical existence, current site/bin/serial accuracy, unconsumed reservation/pick accuracy, general-ledger reconciliation, bank/provider balances, tax correctness, customer acceptance or production readiness. Equal offsetting stock errors within one product can escape stock controls. Sales agreement detects differing retained unit deductions and product quantities, but coordinated changes to all agreeing records can escape it; agreement is not independent physical or commercial evidence. It does not schedule alerts, run providers, repair facts or qualify a product gate.

The complete scan holds one `BEGIN IMMEDIATE` transaction for consistent authority, stock and money. Other writers wait; readers can continue under WAL. Scan time grows with retained history, including orders, allocations, shipments and native invoice lines, and billing/product controls and complete sales evidence/maps grow in memory with record counts. Peak workloads, lock duration, indexing and production latency remain unqualified. Client cancellation stops display; it does not interrupt an already-running synchronous database scan. These limits require operating qualification before production use.

Related procedures: [event diagnostics](EVENTS.md), [billing documents](BILLING-DOCUMENTS.md), [runtime installation](RUNTIME.md) and [acceptance checkpoints](CHECKPOINTS.md). Direct workstation tests are engineering evidence only; all product tasks and gates remain NOT VERIFIED.
