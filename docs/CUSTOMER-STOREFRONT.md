# Customer storefront and product resources

Owner requirements captured 2026-10-05. A customer is a contractor purchasing from the distributor; the customer experience should be a storefront with its own orders and payments. This document records authorized direction and the subsequent implementation and Canadian pilot activation. See the [live release receipt](evidence/LIVE-STOREFRONT-2026-10-05.md); release checks do not establish product acceptance.

## Current implementation boundary

Historical checkpoint `0f41a55` lacked product media, customer purchasing restrictions and conditional order review. The current local increment adds staff account/product purchasing policies, default-deny buyer entitlement, native order-review requests and decisions, catalog image/document management, and the buyer storefront. Enrollment approval, product eligibility and order review remain separate controls. These changes are active in the Canadian pilot on schema 25.

Catalog resources use bounded SQLite BLOB storage, generated IDs, fresh account/tenant/eligibility checks and immutable history. Images normalize to PNG; PDFs are reconstructed as raster-only documents in a bounded child process. Draft publication requires an explicit permission basis. Metadata edits return published resources to draft; retirement preserves history. HTTPS document links never trigger a server fetch. See [resource limits and operating policy](CATALOG-RESOURCES.md).

## Shop cart and suggested add-ons — 2026-10-06

Owner requests, 2026-10-06:
- add to cart with a quantity;
- "View product" opens only that product;
- choose the warehouse in the cart;
- suggest add-ons such as install kits or brackets with main units.

- **Cart.** Product cards and the product page have a quantity and **Add to cart**, replacing "Prepare order with this product". Lines wait in the buyer's browser tab (`sessionStorage`), because the saved server cart belongs to one customer and one warehouse. In the cart the buyer changes quantities, removes lines and picks **Ship from warehouse**. **Review order quantities** merges the lines into that warehouse's saved cart, adding to any saved quantity up to the 100,000 limit. It then opens the quantity review listing only those products. The tab's cart clears once the server cart is saved. Prices in the cart are estimates; the quote confirms current price, tax and availability.
- **Product page.** Shows only the chosen product. The manufacturer collection, reference matches and catalog list are hidden.
- **Add-ons (schema 30).** Administrators choose up to 12 existing products per main unit in Catalog → Manage product → Add-ons, in display order, with a reason. Saves use a revision check and are audited. Customers see an add-on only if their account may buy it now (entitlement, visibility, currency and MSRP pricing rules), at their own price. Add-ons of a main unit the account cannot buy are not disclosed. Nothing is inferred from names or SKUs; no pairings are seeded.
- **Dialogs.** Every workspace dialog has a close button (X) in the top-right corner and closes on a click outside it, unless a save is in progress. The catalog product dialog keeps its close button and also closes on an outside click.

## Requested experience

| Area | Required behavior | Existing task coverage |
| --- | --- | --- |
| Customer storefront | Product images, featured carousel, categories, search, equipment details and customer-specific pricing. A customer sees only its own commercial account, orders, invoices and payments. | D-008, D-012, D-018, D-020 |
| Product eligibility | Staff chooses which products each customer may purchase. Enforce the same policy in browsing and backend cart, quote and acceptance paths, including direct requests and changes after a quote. | D-008, D-012, D-018, D-019 |
| Conditional order approval | Selected customers or products require distributor verification before accepting the order. The customer sees “Awaiting distributor approval”; staff can approve, decline or request more information. | D-018, D-019, D-020 |
| Administrator product resources | Upload equipment images, sales literature, installation guides, maintenance/service guides and other applicable documents; attach them to the correct product/model. | D-002, D-008, D-012, D-020 |
| Gree pilot content | Collect official Canadian Gree images and documents for seeded families and identify exact-model/revision gaps. | D-002, D-012 |

## Product resource management

The local staff catalog includes image/document management and purchasing controls; the buyer workspace includes Shop and scoped commercial activity. The requested product organization remains **Overview · Specifications · Documents**, with **Shop · Orders · Invoices & payments · Account** navigation. Preserve the owner's category/page-tab approach; do not add another “on this page” button strip. Source presence does not establish every requested detail or device acceptance.

Images need a primary image, optional gallery order, meaningful alternative text and a preview. Documents need a readable title, category, language, applicable manufacturer model(s), refrigerant/voltage where relevant, revision and source. Keep image/literature selection explicit: a family montage must not imply that every pictured component is included in a purchase.

Recommended initial management flow: choose product → upload or add an official document link → review metadata and preview → publish to eligible buyers. Staff can replace, reorder and retire resources. Changes retain actor/time/provenance and prior document metadata. Attachments default to draft; publishing confirms ownership or permitted distribution. The current Gree research collection is draft material and must not become public merely because it was downloaded.

Implementation should remain Catalog-owned. Authenticate every upload/list/download and derive organization scope from the current actor. Buyer access must recheck product eligibility; possession of an attachment ID is insufficient. Use generated storage identities, never user filenames as paths. Initially allow bounded JPEG/PNG/WebP images and PDFs, validate actual content, normalize images, and serve document downloads with safe content headers. Reject executable/HTML/SVG content. Treat vendor-supplied names/metadata as untrusted text. If links are supported, allow HTTPS and prevent server-side fetching of arbitrary destinations; imports should be an explicit trusted-source operation.

The local implementation chooses SQLite BLOBs for coherent metadata/content snapshots, with 8 MiB image and 16 MiB PDF bounds, dimensional/work limits and organization/product quotas. A closed-copy test covers retained metadata/history/bytes, not production backup recovery. Canadian storage residency follows the qualified database host. PDF reconstruction strips original active objects but loses searchable/accessible text; native renderer containment and actual deployment capacity still require operating qualification.

## Eligibility and order-review rules

Maintain distinct policies:

1. **May purchase**: the customer is entitled to buy this item.
2. **Requires review**: an otherwise eligible purchase needs distributor approval.

Recommended initial rule: require review when either the customer or any submitted product is flagged. Customer/product-specific exceptions can be added when a concrete business rule needs them. Existing buyers should not silently receive unrestricted entitlement during migration; staff must explicitly choose the initial catalog access policy.

Recommended first workflow holds the entire submitted request, avoiding partial approval complexity. It has a separate request identifier and statuses **Awaiting approval**, **More information needed**, **Declined**, **Withdrawn**, and **Accepted** (linked to the actual order). Submission must not emit `orders.accepted`, reserve inventory, commit customer exposure, initiate payment collection, invoice or permit shipment. The customer must be told that stock and price are not guaranteed while review is pending. This is a proposed operational default, not an already approved stock-hold policy.

Approval must revalidate current customer status, product eligibility/activity, quote/pricing validity, credit and available supply. A reviewed request cannot reuse an expired quote as a back door. If price or terms change, obtain renewed customer acceptance; do not silently charge a changed amount. Produce at most one accepted order under retries or concurrent staff approval, through the existing native order operation and transaction boundary. Both direct acceptance and approval paths must enforce review requirements. Never temporarily bypass a customer flag to approve one order.

Persist the submitted revision, requested lines, terms, review reason and authorized decision. Stale staff decisions must refuse after customer edits or policy changes. Buyer identity cannot choose a different account or supply approval flags. Notifications can initially be in-app; automatic email remains separately unconfigured. Keep staff-only notes separate from buyer-visible requests for information.

## Bounded implementation sequence and evidence

The following sequence now has local source implementation and focused verification; final source-bound evidence is recorded separately. Historical research and launch receipts remain valid only for their recorded versions.

1. Catalog entitlement and review-policy data/commands with explicit migration policy. Verify account isolation, stale quotes, revocation and API bypass cases.
2. Native request/review/accept workflow. Verify duplicate and competing approvals, no pre-acceptance inventory/financial side effects, expiry/repricing and authorized transitions.
3. Catalog resource storage and staff upload/publish controls. Verify role/tenant/entitlement boundaries, malformed and oversized files, safe delivery, retirement and backup/restore behavior.
4. Buyer storefront and product pages, images/carousel and scoped orders/payments navigation. Provide keyboard controls, no automatic carousel rotation, touch targets, reduced-motion behavior and small-screen layouts. Check actual iPhone Safari before claiming device support.
5. Import only model-matched and permitted Gree resources into the catalog; preserve provenance and document revisions. Take a qualified backup and follow the schema migration/deployment runbook before any live activation.

The resource service/HTTP checks passed 9/9; the family-reference helper and existing business-seed checks bring that bounded run to 11/11. These tests cover malformed/oversized uploads, draft/publish/edit/retire, idempotency, account isolation, fresh entitlement revocation, safe delivery, PDF active-object removal and a coherent SQLite copy. They do not establish universal workflow, actual iPhone Safari, live backup recovery or host containment qualification.

The research collected eight family image entries and 92 technical document links. See [library and download limitations](catalog/README.md). The optional Gree helper publishes only eight official manufacturer family-page references, clearly labelled as unverified for exact model/capacity/voltage. No Gree binary is automatically imported or redistributed. Model/revision matching and redistribution rights remain gaps. The four-feature increment is deployed; no product gate is verified.

## Public portal and customer layout

The subsequent [design release](evidence/LIVE-PORTAL-REDESIGN-2026-10-05.md) supplies a dedicated customer masthead/navigation, illustrated featured equipment, product cards and detail/resource views. Public `/#customer-sign-in`, `/#admin-sign-in` and `/#apply` provide the three entrances; legacy `/#sign-in` remains supported. Server authentication determines the role regardless of entrance. Desktop and phone-width Chromium were checked; actual iPhone Safari remains a separate device check.
