# Review the invoice queue

Status: local engineering, 2026-10-02. All 44 tasks and 10 product gates remain NOT VERIFIED.

## Load and filter invoices

Open **Billing** to load up to twenty newest recorded invoices. **Load more invoices** appends the next page. **Invoice balance** selects all balances, unpaid balances above zero, settled balances equal to zero, or credit balances below zero. Changing the filter clears earlier results and starts a new queue. The Overview invoice balance remains the sum of positive balances across every currently scoped invoice, including those on later pages.

A failed continuation keeps its rows and cursor; **Retry invoice queue** requests the same page. A failed first filter load leaves that queue empty until retry. Refresh reloads the initial all-balance queue. Navigation, refresh, sign-out and newer filters cancel earlier responses. Keyboard pagination returns focus to the retry/next button or to the heading after the final page.

Loaded older invoices retain their existing payment, checkout, credit, refund, accounting and document actions. Native commands revalidate permissions, balances and original facts. Credits carry their original invoice number, customer identifier and currency from billing's owning projection, so reviewing and publishing an original credit PDF does not require loading its invoice's page. See [billing documents](BILLING-DOCUMENTS.md) for publication and finance procedures.

## Access and balances

Each page and summary reloads active persisted identity, role, current buyer account and required-password restrictions inside its own immediate database transaction. Existing administrator, finance, commercial, warranty and support visibility is unchanged. Warehouse workers have no invoice queue. Buyers see only their current account; missing assignments cannot broaden access. Supplied actor fields do not expand or remove persisted permissions.

The balance projection uses original invoice totals, approved opening credited/paid/refunded amounts, subsequent native credits and payments, and completed refunds. Pending, unknown and rejected refunds do not change settled balance. The positive-balance total does not net one invoice's customer credit against another invoice's unpaid amount.

Each page enriches at most twenty invoice headers with current totals, original lines, creditable quantities, opening provenance and publication state. An unenriched twenty-first header determines whether more results exist. Timestamp and identifier form a deterministic descending boundary, including tied timestamps and restart. The cursor carries version, selected balance filter and anchor identifier. It is an opaque continuation, not a credential or signature. The anchor is re-read under current access before the balance filter, allowing a payment to settle that anchor without breaking traversal. Missing, foreign or revoked anchors remain unavailable.

Pages are live reads. Newer invoices require refresh; older invoices entering a selected balance may appear on later pages; previously displayed balances can become stale. There is no immutable multi-page snapshot. One page's authority, anchor, selection and enrichment share a transaction. Summary and other dashboard collections use separate reads, so the complete dashboard is not one coherent snapshot.

## Interface and qualification limits

`GET /api/dashboard` returns the initial page as `invoices`, continuation as `invoiceNext`, and full scoped aggregate as `invoiceSummary` with `total`, `unpaid`, `settled`, `credit` and integer-cent `due`. `GET /api/billing/invoices/page` returns `{items, next}`. Optional `state` is exactly `unpaid`, `settled` or `credit`; optional `after` is the canonical returned base64url cursor, at most 512 characters. Cursor shape, version and filter binding are validated. Unknown/malformed fields fail; no page-size override exists.

This bounds header materialization, not lines per invoice, credit collections, other dashboard collections, accumulated browser rows, SQL scan/sort cost or transaction duration. The summary calculates balances over its full scope. Existing internal full-list invoice reads remain available and unbounded. Immediate read transactions can contend with writers. Production indices, workload targets, staff policy, actual providers, hardware, other browser engines and operator/security/load/residency acceptance remain unqualified.

The [local receipt](evidence/LOCAL-INVOICE-QUEUE-2026-10-02.md) records tested inputs, outcomes and retained failures. This is partial D-008/D-022/D-023/D-024/D-025 and REQ-03/REQ-14/REQ-15 engineering; it does not complete D-039 or any product gate.
