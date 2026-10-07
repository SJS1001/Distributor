# Customer prices when preparing an order

Status: local engineering, 2026-10-02. All 44 tasks and 10 product gates remain NOT VERIFIED.

## Ordering procedure

Choose **Prepare order**, select the customer and warehouse, then continue. The quantity editor loads that customer's current prices and saved quantities. Each product shows its unit price, unit tax and currency. The catalog shows twenty products at a time. Search by SKU or name, or use **Next catalog page**; selected quantities remain editable in **Selected products from other pages**. Search treats `%` and `_` as literal characters. Zero removes a selection; at most 100 products may be selected. A buyer can select only their assigned customer; administrators and commercial staff can prepare an order for a customer they are permitted to read.

Continue to save quantities and obtain a fresh quote. The price shown while editing can change before this step; review the quote's lines and total before accepting. An accepted order retains the quoted prices and taxes even if the catalog price subsequently changes. Zero quantities remove a product. Canceling the quote preserves the saved cart, so reopening loads its quantities with newly read prices.

A failed preparation keeps the customer and warehouse selection for retry. Closing the dialog, navigation, dashboard refresh and sign-out cancel preparation reads and prevent their late responses from reopening the editor. Abandoning the editor also prevents a late save result from starting a quote or a late quote result from reopening review. Submitted commands may still finish and retain their native receipts.

## Recover saving and quoting

If saving or quoting loses its response, continue again from the quantity editor. Before sending a save, the browser retains its exact account, warehouse, revision, quantities and request key. If you changed quantities meanwhile, it first recovers that save, then submits the changed quantities against the returned revision. A native quantity/line validation or revision refusal permits correcting the form. Transport errors, timeouts, server errors, unreadable success replies and authority/key refusals retain the original save: a refusal to retrieve a receipt does not prove the original command failed.

After closing the editor, reloading or signing out, sign in as the same account and choose **Orders → Review retained cart save**. The readonly review displays the original customer, warehouse and named quantities; **Recover exact cart save** sends the original body and request key. Recovery alone does not quote or accept an order. Refresh and resume the current saved cart before obtaining a new quote: an original receipt may describe an older revision than the current cart. An open review stays fixed if another tab changes the recovery evidence; the old attempt cannot be sent after its key or body changes. Close and review the current evidence instead.

One pending save is retained per organization and signed-in identity in a browser profile. Web Locks coordinate tabs; an occupied lock refuses transport instead of starting a competing save. A different pending cart or quantity set cannot replace unresolved evidence. Unreadable or unwritable storage, or an unavailable Web Locks API, blocks transport. If storage cleanup fails after a committed reply, the original attempt remains recoverable. Restore browser storage and reconcile the previous native attempt before saving again; clearing damaged evidence is not proof of an uncommitted save.

Once the editor observes a successful save, retrying a failed quote with unchanged quantities does not save the cart again. A lost successful quote response reuses its original request key and quote snapshot. Always review the displayed quantities and money before accepting; recovery does not accept an order automatically. Existing quote expiry, current authority, credit and stock checks still apply.

If another session changes the cart before a new save or quote, cancel and reopen to load its current quantities. Recovery does not overwrite a newer revision. An already issued quote retains its original snapshot; retrieving it again does not promise today's prices or a new expiry. Canceling and reopening obtains current cart quantities and prepares a new quote.

The [earlier cart recovery receipt](evidence/LOCAL-CART-RECOVERY-2026-10-02.md) records editor retries, edited quantities, validation correction, network/timeout recovery and concurrent-session refusals. The [durable cart recovery receipt](evidence/LOCAL-CART-RETENTION-2026-10-02.md) adds reload/sign-out recovery, unchanged review, competing tabs and storage/reply failures. Unsaved editor changes and quote review remain local to that editor; reopening reads the current native saved cart. This checkpoint makes submitted cart saves recoverable across reload, not arbitrary unsaved edits or quote reviews.

## Unavailable saved items

If a saved product is currently inactive, the editor shows its SKU, name and saved quantity with an unchecked removal choice. Review each item, or use **Remove unavailable items from this saved cart** to select all. Continue refuses before saving or quoting until every unavailable item is selected for removal. A partial selection changes no saved quantities. Canceling before submission preserves those quantities; reopening resets the choices. Available products keep their saved quantities and current customer prices.

Continuing with removal checked saves the remaining available quantities before requesting a quote. A failed or lost response follows the same exact-save recovery above. Canceling after submission does not undo a committed save. If removal leaves no items, the empty cart is saved and the quote reports **Cart is empty.**; add available quantities and continue to obtain a quote. Removal never accepts an order automatically.

The [earlier removal receipt](evidence/LOCAL-UNAVAILABLE-CART-2026-10-02.md) records buyer and staff cancellation, lost-response recovery, and clearing an unavailable-only cart. The [item review receipt](evidence/LOCAL-CART-ITEM-REVIEW-2026-10-02.md) records named individual choices and active-product removal. Saved product identities, activity and customer prices are resolved independently of the visible page, so active off-page items are preserved. Selected active products also have a **Remove … from cart** button; removal returns keyboard focus to catalog search and remains an unsaved edit until Continue. Unavailable products cannot be retained in a new quote; cancel to preserve the existing saved cart. Commercial staff manage [catalog retirement and reactivation](CATALOG-LIFECYCLE.md) separately through a fresh native review. Cart removal review does not reactivate products.

## Find and resume saved carts

In **Orders**, the **Saved carts** section shows twenty cart headers at a time with product/unit counts. Filter by customer or warehouse, use **Next saved cart page**, or reset with **First saved cart page**. **Resume** preselects that cart's customer and warehouse; continuing reads the exact current cart and its selected products. Buyers can read only their current assigned customer.

Failed catalog/cart page requests preserve the existing page and quantities. Retry repeats the failed search/filter/cursor. Cancellation, component removal and refresh discard late page responses. Paging replaces the visible page rather than accumulating headers. Reads do not save, quote or accept anything.

## Price and access contract

`Catalog.customerProducts(actor, accountId)` refreshes persisted identity, role, required-password restrictions, customer assignment and customer tier in one database transaction. Administrator, commercial and buyer roles are permitted; finance, warehouse, warranty and support are refused. Buyers cannot choose another account, and stale or forged caller grants do not expand access. These checks precede even an empty catalog result.

The catalog joins only its own product and tier-price tables within the current organization. Each active product uses the selected customer's tier price, falling back to its base price when that tier has no override. A zero override remains zero. Unit tax uses the same exact integer, half-up calculation as native quotes. A product in a different currency refuses the projection; no implicit conversion occurs.

The public projection contains exactly `id`, `sku`, `name`, `serialized`, `unit_price`, `unit_tax`, `tax_bp` and `currency`. It excludes other tier prices and internal organization/activity fields. A buyer's dashboard uses the first twenty products from the paged projection for their current assigned customer. Accepted off-page order lines use their immutable descriptions when the SKU is absent from that page. Staff dashboards retain their existing base catalog projection; staff quantity editing fetches the selected customer's projection separately. Internal catalog APIs retain their existing business responsibilities.

`GET /api/catalog/customer-products?accountId=...` requires a current session, accepts only the required account identifier (1–128 characters), rejects extra query fields and returns no-store responses. Denied HTTP access retains the existing authorization-denial audit; catalog/cart/order business facts remain unchanged. Buyer assignment changes revoke existing sessions. An unassigned buyer's full dashboard currently fails closed in the existing sold-unit reader; this checkpoint does not add an unassigned-buyer experience.

`GET /api/catalog/customer-products/page?accountId=...&after=...&q=...` supplies twenty active, customer-priced products sorted by SKU/identity. Search is case-insensitive within SQLite's supported lower-case comparison, trimmed and limited to 120 characters. The cursor resolves a current organization-owned product, including an inactive anchor; it is not bound to a search snapshot. The UI repeats its applied search for continuation. Changing or renaming products during traversal may omit or repeat records; restart the search for a current list.

`GET /api/carts/page?after=...&accountId=...&warehouseId=...` supplies twenty headers sorted by descending update time/identity. Cursor authority is checked against the current customer and warehouse filters. `GET /api/carts/selection?accountId=...&warehouseId=...` resolves one current scoped cart and at most 100 catalog-owned selected descriptors within one transaction. Empty reads still recheck current persisted role, password and buyer assignment. All three endpoints require a current session, reject malformed/unknown/duplicate query fields and use no-store responses. Account/site/cursor identifiers are limited to 128 characters.

## Qualification limits

The portal catalog and saved-cart header pages now have explicit bounds; selected cart products are bounded separately. Legacy full-list APIs, staff dashboard products and customer/warehouse selector lists remain unbounded. SQL scans/sorts and writer contention are not bounded by returned page size. Each pricing read is transaction-consistent, but cart, pricing and dashboard reads are separate and may become stale. Immediate read transactions, SQL cost and catalog editing at scale remain unqualified. Named unavailable saved lines require explicit removal before a new quote; retaining or changing their quantities in that quote is unsupported. Native quote and acceptance commands remain authoritative for account, currency, stock, credit, reservation and immutable price evidence.

Browser recovery stores customer/warehouse/product descriptors and quantities in plaintext local storage after sign-out for the original identity. UI account separation grants no protection against someone who can read that browser profile. Shared-device retention, managed workstation protection/residency, cleared storage, independent-device recovery and non-Chromium browser compatibility require qualification. Browser evidence grants no authority; the server rechecks current access before returning a cached receipt. Quote review and acceptance remain separate, and the browser is not the authoritative current cart.

The [local receipt](evidence/LOCAL-CUSTOMER-PRICING-2026-10-02.md) records synthetic CA/US cases, phone-width Chromium workflows, retained failures and tested inputs. It does not establish country-specific tax obligations, actual provider/device behavior, infrastructure residency, production load/security/recovery or operator acceptance. This is partial D-008/D-018/D-019/D-020 and REQ-03/REQ-12/REQ-13 engineering; it does not pass G3 or any other product gate.

The [catalog and cart paging receipt](evidence/LOCAL-CATALOG-ENTRY-2026-10-02.md) records the current bounded reads, exact selected-product resolution and local recovery checks. It supersedes the earlier full-catalog dependency for unavailable-item classification.

## Individual customer minimums

Set the customer’s minimum merchandise amount and equipment quantity under Customers → the exact customer → Terms. Both thresholds apply before acceptance or approval; buyers see the requirements under Account and in the cart. See [individual customer minimum orders](CUSTOMER-MINIMUM-ORDERS.md) for calculation, accessory-only orders, exact save recovery and existing-order behavior.
