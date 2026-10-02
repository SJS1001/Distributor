# Stock and billing reconciliation

Finance and administrators can open **Reconciliation** and select **Run reconciliation**. Authenticated `GET /api/operations/reconciliation` rechecks the persisted principal, role, organization and forced password change, then reads owning inventory and billing operations in one SQLite transaction. It changes no stock, money, command receipt, audit or provider state. Responses use `no-store`; refreshing clears the previous result, and leaving the screen cancels its pending request.

## Read the controls

Stock quantity and original cost include retained custody, quarantine and transit. Movement controls use the same signed interpretation as [stock cost accounting](ACCOUNTING-COSTS.md). Ordinary dispatch/receipt transfers have zero organization-wide effect; recorded loss/recovery changes custody. Each product's retained quantity/value is compared separately with its movement history. Missing units/sequences, orphan sequences, unsupported movement types, wrong directions, invalid timestamps and integers outside safe application bounds are discrepancies.

Billing compares invoices with their immutable line prices/tax, credits with their original invoice lines, and credited quantities with sold quantities. It checks parent relationships, opening document/line evidence, historical opening arithmetic and pending/uncertain reservations and native completed refunds against payment and credited cash capacity. Document balance is invoice total minus credits minus payments plus completed refunds. Pending and uncertain refunds are separate; rejected refunds release capacity. A negative balance can correctly represent credited cash awaiting refund.

Opening credit/payment/refund amounts are retained historical evidence, not new payment or credit documents. Regional money totals include only invoices in the organization's currency. Other currencies produce discrepancies and are excluded, without implicit exchange rates. Exact integer arithmetic preserves large retained totals; unsafe individual values are flagged because ordinary business commands operate within narrower bounds.

The issue count covers the complete scan. Stock and billing each return at most 100 details in stable scan order, with an explicit truncation notice. Details contain control codes, record identifiers and expected/recorded values, without descriptions, supplier/customer names, payment references, reasons or credentials.

## Investigate discrepancies

1. Record the checked time, organization/currency, totals and affected identifiers in the approved support location. This screen does not retain or export a reconciliation receipt.
2. Review the original owning records, custody/count evidence and document history. A discrepancy does not establish which record is correct.
3. Use an authorized business correction or recovery procedure with evidence and review. Do not edit the database from this screen or replay an uncertain provider effect merely to obtain matching totals.
4. Run the controls again, keeping earlier failure evidence. Independently reconcile actual bank/accounting/provider statements and physical custody.

## Scope and operating limits

This native control report is partial D-036 engineering coverage. It does not establish physical existence, site/bin/serial accuracy, allocations, shipment-to-invoice agreement, general-ledger reconciliation, bank/provider balances, tax correctness, customer acceptance or production readiness. Equal offsetting errors within one product can escape these controls. It does not schedule alerts, run providers, repair facts or qualify a product gate.

The complete scan holds one `BEGIN IMMEDIATE` transaction for consistent authority, stock and money. Other writers wait; readers can continue under WAL. Scan time grows with retained history, and billing maps/product controls grow in memory with record counts. Peak workloads, lock duration, indexing and production latency remain unqualified. Client cancellation stops display; it does not interrupt an already-running synchronous database scan. These limits require operating qualification before production use.

Related procedures: [event diagnostics](EVENTS.md), [billing documents](BILLING-DOCUMENTS.md), [runtime installation](RUNTIME.md) and [acceptance checkpoints](CHECKPOINTS.md). Direct workstation tests are engineering evidence only; all product tasks and gates remain NOT VERIFIED.
