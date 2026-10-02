# Master data, opening stock and unpaid-document import runbook

Local implementation checkpoint 2026-09-30. Bounded customer/catalog master, opening-stock and unpaid-invoice paths support D-013/D-035. All tasks/product gates remain NOT VERIFIED. Complete historical financial/purchase reconciliation, actual source qualification and full cutover remain outstanding. See [implementation status](IMPLEMENTATION.md) and [checkpoint criteria](CHECKPOINTS.md).

## Current import authority

Customer/catalog, opening-stock and unpaid-document reviews reload the active persisted principal for the requested organization. Lists, previews and approve/reject decisions require current administrator authority and no required password change. Supplied roles do not grant or remove access. Revocation, deactivation and password restrictions also apply before returning saved command results or permanent decisions with new keys. Authorized identical retries preserve the original report, mappings and result through restart.

Decision authorization runs inside the existing atomic command transaction before cached results or effects. Original source controls, stale fingerprints, source identity constraints and owning-module application remain in force. A denied attempt changes no import/master/stock/money/order or command/audit facts. Other owning APIs, configurable approval duties, historical search/retention and actual cutover/security/residency qualification remain outstanding. See [the local authority receipt](evidence/LOCAL-IMPORT-AUTHORITY-2026-10-02.md).

## Customer and catalog review

An administrator uses **Imports → Dry run customer/catalog**. Prepare an authorized frozen source artifact, independently reconcile the record count and control amount, and retain its original hash and rights/cutoff evidence in approved regional storage. The application accepts the supplied evidence; it cannot verify the file contents, completeness, rights or physical storage location. Fixtures are synthetic. Import catalog masters before opening stock; customer masters do not bring unpaid documents, balances, users or credentials.

The `import.masters.preview` command accepts the exact version 1 manifest described below with one additional field: `kind`, exactly `customer` or `catalog`. For masters, `expectedQuantity` means record count, not stock units. `expectedValue` means the sum of customer credit limits or catalog base unit prices in regional cents, not an opening balance or inventory valuation. Both are independent source controls; any rejected row or unmatched total blocks the entire batch. There are 1–500 rows and no exchange or cross-region move. The UI shows existing record IDs for explicit matching, every submitted row field, normalized mapping, issues and review fingerprint. There is no CSV uploader, source-file hashing or attachment storage.

Customer rows have exactly these six fields:

```json
{
  "sourceId": "CUSTOMER-001",
  "targetId": null,
  "name": "Synthetic customer",
  "tier": "standard",
  "creditLimit": 100000,
  "held": false
}
```

Catalog rows have exactly these seven fields:

```json
{
  "sourceId": "PRODUCT-001",
  "targetId": null,
  "sku": "SYNTHETIC-SKU",
  "name": "Synthetic product",
  "serialized": true,
  "unitPrice": 10000,
  "taxBasisPoints": 1300
}
```

`held` and `serialized` must be actual booleans. Credit limits are integer cents from zero to 1,000,000,000,000; base prices from zero to 1,000,000,000; tax rates are integer basis points from zero to 10,000. Aggregate control amounts are bounded at 1,000,000,000,000. Names, SKUs, source IDs and tiers are trimmed, nonempty strings of at most 160 characters. Imported tax/credit/tier values require separate business approval; this path does not establish their legality or suitability.

`targetId: null` requests creation. An existing exact customer name or SKU prevents silent creation/merging: select its existing organization record ID and submit fields that match it exactly. Catalog targets must be active. Exact matching records a source mapping without modifying the target, tier-specific prices, customer holds or provider choices. Duplicate source IDs, names/SKUs or target IDs within a batch reject every affected row. Source and target mappings cannot be reassigned within the same organization/kind/source dataset. Keep `sourceRef` and row IDs when correcting source evidence; use a new `batchRef`. A separately identified dataset may explicitly match an existing target; it still cannot silently update it.

New customers start with strict regional residency, no named provider exceptions and choice version 1. Consent, processor choices, region changes, credentials and extra row fields cannot be imported. Existing customer choices remain unchanged. The separate versioned residency workflow remains the only way to record named customer processor exceptions.

Only a current administrator can list or decide reviews. `import.masters.decide` supplies the batch ID, saved review hash, approve/reject decision and nonempty reason. Approval reassesses owner-controlled records, source mappings and complete target snapshots inside one transaction. Native creation, field changes or a revised customer residency choice makes the review stale. Reject and re-preview rather than overwriting evidence. All creations, mappings, decision and audit/command receipts commit together; a late mapping failure rolls everything back. Matching never updates the target. Dry runs and rejected decisions create no masters, inventory or financial documents.

Permanent decisions replay across request keys/restart when their evidence is unchanged; a changed reason/decision conflicts. Current authority is checked before cached results. After a lost approval response, retry the unchanged dialog. Applied results retain each source ID, target ID and create/match action. The latest 50 batches are displayed; earlier raw evidence stays in the database. Configurable independent approval duties, historical search/export/retention, large-volume migration and real cutover procedures remain unqualified.

The [master import receipt](evidence/LOCAL-MASTER-IMPORTS-2026-09-30.md) records synthetic restart, process races, rollback and encrypted populated-master restore. Restoration retains mappings/permanent decisions, invalidates copied sessions and imposes the recovery provider hold. It does not qualify production recovery targets or activation. Adding these tables changes the exact schema accepted by recovery; older archives require a qualified upgrade path.

## Prepare source evidence

Use an authorized, frozen source dataset and independently reconcile physical quantity and original inventory cost by product/site. Preserve the source file, its lowercase SHA-256, cutoff timestamp, mapping decisions, rejected-row corrections and approval evidence in approved regional storage. The application records the supplied source hash and acknowledgment; it cannot verify rights, source completeness, physical counts, file contents or an actual cutoff procedure. Local fixtures are synthetic and cannot authorize actual customer data ingestion.

Create the organization's products and warehouses through their owning operations before this stock import. Each runtime has one declared region and currency; this import accepts only that organization's CA/CAD or US/USD. No exchange, cross-region move, customer residency-policy change, provider processing or financial posting occurs. Named customer processor choices remain controlled by the separate residency workflow.

The import targets a product/site with no custody records, including zero-quantity, sold and in-transit history. Existing custody requires reconciliation rather than another opening balance. A serial must be globally new within the organization. A batch may contain several new serials/lots at the same empty product/site. Once applied, that product/site cannot accept a second opening batch; consolidate its entire balance within the supported batch. Batches are limited to 1–500 rows and a bounded payload; large openings require a separately designed and tested migration procedure.

## Version 1 format

An administrator uses **Imports → Dry run opening stock** or the authenticated `import.opening.preview` command. HTTP commands require the current session, origin/CSRF checks and an idempotency key like other application tasks. The manifest has exactly these fields:

| Field | Meaning |
| --- | --- |
| `version` | Integer `1`. |
| `batchRef` | Organization-unique immutable review reference. Use a new reference for corrected evidence. |
| `sourceRef` | Stable dataset namespace retained across corrected batches. Source row IDs are deduplicated within this namespace. |
| `sourceHash` | Lowercase 64-character SHA-256 of the original source artifact, supplied by the reviewer. |
| `cutoffAt` | Past canonical UTC timestamp, such as `2026-09-01T00:00:00.000Z`. |
| `region`, `currency` | Match the current organization/runtime. |
| `expectedQuantity` | Independently reconciled integer source unit count, up to 1,000,000,000. |
| `expectedValue` | Independently reconciled total original cost in currency cents, up to 1,000,000,000,000. |
| `acknowledgment` | Nonempty rights, mapping and cutoff evidence reference/text, at most 2,000 characters. |
| `rows` | Array of 1–500 source rows. Invalid rows are retained in the immutable dry-run evidence. |

Every row has exactly eight fields. This is a synthetic example of one serialized unit:

```json
{
  "sourceId": "LEGACY-UNIT-001",
  "sku": "EXISTING-SKU",
  "warehouse": "Toronto",
  "bin": "A-1",
  "serial": "LEGACY-SERIAL-001",
  "quantity": 1,
  "unitCost": 6000,
  "condition": "usable"
}
```

`sku` and `warehouse` resolve through owning modules using exact trimmed names. Product must be active. Serialized products require one nonempty serial and quantity one; bulk products require `serial: null`. Quantity is an integer from 1 to 100,000; unit cost is integer cents from zero to 1,000,000,000, with each row value at most 1,000,000,000,000. Condition is exactly `usable`, `quarantine` or `damaged`. A null/malformed row, unknown mapping, extra field, fractional quantity/cost, conflicting serial or duplicate source row blocks the whole batch. Zero-cost stock is technically accepted and still requires independent financial approval.

The opening-stock UI accepts JSON rows; it provides no CSV upload, attachment storage, source-file hashing, source freeze or catalog/customer creation inside a stock batch. Use the separate reviewed master path first where needed. The saved payload hash binds submitted rows and manifest, independently of the externally supplied file hash.

## Review, approval and retry

The dry run commits only the review, command receipt and audit evidence. It stores raw input, normalized mappings, row issues, eligible quantity/value and per-site totals. Review fingerprints bind the input hash and complete report. Eligible totals must equal the independent source totals; any row/batch issue gives state `blocked`. A blocked review cannot apply stock. Reject it with a reason and prepare a corrected batch with a new `batchRef` and the same `sourceRef`/source row identities. Old review evidence stays unchanged. An identical batch reference/input returns the original review; changed input conflicts.

Only a current administrator can read previews or approve/reject them. Approval supplies the saved batch ID, fingerprint, decision and nonempty reason through `import.opening.decide`. Current stock, mappings, active product and source-row identity are rechecked inside the same transaction as inventory creation and permanent source mapping. If custody/mapping changed after review, approval rejects with `IMPORT_STALE`: reject that review and create a fresh batch. A failed approval leaves its original report available.

Successful approval creates every new lot/serial, its original cost/condition, one `opening` movement and one permanent source-to-stock mapping together. A later mapping/storage failure rolls back all inventory changes and decision/command receipts. No partial acceptance is presented as success. Repeated identical decisions across request keys/restart return the original result; altered decision/reason conflicts. Authorization is rechecked before cached results. If the response is lost, retry the unchanged dialog/request rather than modifying its evidence or creating another opening.

Approval/rejection records actor, time and reason. Applied/rejected decisions are permanent. A rejected batch has zero applied quantity/value and no source mappings. The current list displays the latest 50 reviews; older raw evidence remains in the database. Historical lookup/export and retention tooling remain to implement. Administrator self-review is provisionally permitted; configurable independent approval duties and human acceptance remain to qualify.

## Reconcile and qualify

Compare approved source mappings, physical stock and original cost to independent source totals and per-site balances. Usable stock contributes availability; quarantine/damaged stock retains physical quantity/value while remaining unavailable. `opening` records do not establish a supplier purchase origin, so purchase-based supplier returns cannot infer an old PO from equal product/cost. Legacy supplier credit/purchase lineage needs a separate qualified reconciliation path. No invoice, opening general-ledger journal, QuickBooks delivery, payment or supplier credit is created.

Correct later errors through approved inventory/financial reconciliation with linked evidence. This path provides no destructive undo or overwrite of a decided import. Preserve the review and physical movement history. Encrypted backup/isolated recovery has a separate [runbook](RECOVERY.md); this checkpoint tests import persistence across application restart, not a production cutover or populated-import restore rehearsal. Adding import tables changes the exact current schema accepted by recovery; older-schema archives need a separately qualified upgrade path.

The [local opening receipt](evidence/LOCAL-OPENING-IMPORTS-2026-09-30.md) documents its historical synthetic candidate. Actual source rights/lineage, human quantity/value sign-off, source freeze and one-writer routing, large-volume import, abrupt crash/disk faults, production upgrade/restore, cutover rollback, complete financial migration and actual customer/catalog source qualification remain outstanding. Source publication, live ingestion, accounts, provider activation and deployment have separate authorization requirements.

## Unpaid invoice review

An administrator uses **Imports → Dry run unpaid documents** after creating or matching customer/catalog masters. Independently reconcile source invoice count, original net/tax, previous credits, previous payments, previous refunds and outstanding balance at an authorized frozen cutoff. Keep actual source, rights and reconciliation evidence in approved regional storage. The application records supplied hashes and acknowledgments; it cannot establish their truth or authorize actual data ingestion.

`import.documents.preview` accepts the version 1 manifest above. `expectedQuantity` means invoice count and `expectedValue` means outstanding cents. Five additional required controls are `expectedNet`, `expectedTax`, `expectedCredited`, `expectedPaid` and `expectedRefunded`. All six amount controls are independent integer cents from zero to 1,000,000,000,000. The organization region/currency must match. There are 1–500 invoices within the bounded manifest payload; no implicit exchange occurs.

Each invoice has exactly these fields; replace the two target IDs with existing organization IDs:

```json
{
  "sourceId": "LEGACY-001",
  "accountId": "existing-customer-id",
  "number": "LEGACY-INVOICE-001",
  "issuedAt": "2026-08-01T00:00:00.000Z",
  "dueAt": "2026-08-31T00:00:00.000Z",
  "net": 20000,
  "tax": 2600,
  "total": 22600,
  "credited": 11300,
  "paid": 4000,
  "refunded": 1000,
  "balance": 8300,
  "lines": [{
    "productId": "existing-product-id",
    "description": "Original equipment description",
    "quantity": 2,
    "unitPrice": 10000,
    "unitTax": 1300,
    "creditedQuantity": 1
  }]
}
```

Issue/due dates are canonical UTC timestamps; issue must be on/before cutoff and due on/after issue. Each invoice contains 1–100 distinct product lines, whole quantities 1–100,000, unit price/tax 0–1,000,000,000 cents and historical credited quantity from zero through original quantity. Original net/tax must equal the line sums; total equals net plus tax; historical credits equal credited quantities times original unit price/tax. Refunds cannot exceed historical payments. Outstanding must be positive and equal total minus credits minus payments plus refunds. All document amounts are bounded at 1,000,000,000,000 cents. Closed invoices, opening credits, fractional credits, discounts or source rounding that cannot satisfy this format need a separately qualified reconciliation path; do not alter source amounts to force acceptance.

Review displays raw rows, original numbers, customer mappings, issues, each independent control and the saved fingerprint. One rejected row, duplicate source/number or unmatched control blocks the entire batch. Corrections preserve the old review and use a new `batchRef` with the same source dataset/row identities. Original invoice numbers and applied source mappings cannot be overwritten. `import.documents.decide` requires the batch ID, saved review hash, approve/reject and a nonempty reason. Approval rechecks current master/document/source evidence inside one transaction; changed evidence yields `IMPORT_STALE`. Current administrator authority and organization scope apply before cached responses.

Billing owns original invoices/lines and immutable cutoff balances. Migration owns reviews and permanent mappings. All invoices, baselines, mappings, audit and command receipts commit together. Late storage failure rolls everything back. Dry runs/rejections create no financial documents; application creates no stock, orders, shipments, historical cash records or provider/accounting posting. Public opening invoices have null order/shipment links. Repeating an unchanged decision after lost response, a new request key or restart returns the original result; altered decisions/reasons conflict.

Current balances combine historical credits/cash/refunds with later native entries. Outstanding contributes to credit exposure. Further line credits cannot exceed original quantity less all historical/native credited quantities. Historical cash totals are not refundable payment identities. New manual cash is bounded by current outstanding and retains its own evidence. Original numbers remain reserved; native numbering skips collisions. New QuickBooks posting of an opening invoice is blocked with `OPENING_ACCOUNTING` until source accounting identity/reconciliation is qualified. CSV exports include current refunds, origin and source/cutoff provenance. Named customer provider choices remain separate; imports cannot grant consent.

The [local document receipt](evidence/LOCAL-DOCUMENT-IMPORTS-2026-09-30.md) covers synthetic balances, retries, real process contention, late-write rollback, browser review and populated encrypted restore. Restore retains cutoff/current balances and imposes the recovery provider hold; older-schema archives need an upgrade path. Latest-50 review display, provisional administrator self-review and bounded JSON entry do not qualify historical search/export/retention, independent approval duties, full legacy financial mapping, production scale/fault/upgrade/cutover or human source/tax/financial approval. All tasks/product gates remain NOT VERIFIED.
