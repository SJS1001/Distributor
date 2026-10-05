# Customer storefront and product resources

Owner requirements captured 2026-10-05. A customer is a contractor purchasing from the distributor; the customer experience should be a storefront with its own orders and payments. This document records authorized product direction and proposed implementation choices. It does not claim implementation or acceptance.

## Current implementation boundary

At local source checkpoint `0f41a55`, buyer identity, own-account order entry, tier pricing, invoices and payment-related views exist. Buyers share the application shell. `src/server/catalog.ts` owns products and tier prices but has no product-media collection; `src/web/catalog-maintenance.tsx` has no equipment-image/manual upload controls. `src/server/orders.ts` accepts valid quotes into orders and commits exposure/reservations without a conditional distributor review state. Account enrollment approval is separate from product eligibility and order approval.

## Requested experience

| Area | Required behavior | Existing task coverage |
| --- | --- | --- |
| Customer storefront | Product images, featured carousel, categories, search, equipment details and customer-specific pricing. A customer sees only its own commercial account, orders, invoices and payments. | D-008, D-012, D-018, D-020 |
| Product eligibility | Staff chooses which products each customer may purchase. Enforce the same policy in browsing and backend cart, quote and acceptance paths, including direct requests and changes after a quote. | D-008, D-012, D-018, D-019 |
| Conditional order approval | Selected customers or products require distributor verification before accepting the order. The customer sees “Awaiting distributor approval”; staff can approve, decline or request more information. | D-018, D-019, D-020 |
| Administrator product resources | Upload equipment images, sales literature, installation guides, maintenance/service guides and other applicable documents; attach them to the correct product/model. | D-002, D-008, D-012, D-020 |
| Gree pilot content | Collect official Canadian Gree images and documents for seeded families and identify exact-model/revision gaps. | D-002, D-012 |

## Product resource management

Proposed staff catalog tabs: **Details · Images · Documents · Purchasing rules**. Customer product tabs: **Overview · Specifications · Documents**. The customer's main navigation should include **Shop · Orders · Invoices & payments · Account**. Preserve the owner's category/page-tab approach; do not add another “on this page” button strip.

Images need a primary image, optional gallery order, meaningful alternative text and a preview. Documents need a readable title, category, language, applicable manufacturer model(s), refrigerant/voltage where relevant, revision and source. Keep image/literature selection explicit: a family montage must not imply that every pictured component is included in a purchase.

Recommended initial management flow: choose product → upload or add an official document link → review metadata and preview → publish to eligible buyers. Staff can replace, reorder and retire resources. Changes retain actor/time/provenance and prior document metadata. Attachments default to draft; publishing confirms ownership or permitted distribution. The current Gree research collection is draft material and must not become public merely because it was downloaded.

Implementation should remain Catalog-owned. Authenticate every upload/list/download and derive organization scope from the current actor. Buyer access must recheck product eligibility; possession of an attachment ID is insufficient. Use generated storage identities, never user filenames as paths. Initially allow bounded JPEG/PNG/WebP images and PDFs, validate actual content, normalize images, and serve document downloads with safe content headers. Reject executable/HTML/SVG content. Treat vendor-supplied names/metadata as untrusted text. If links are supported, allow HTTPS and prevent server-side fetching of arbitrary destinations; imports should be an explicit trusted-source operation.

For this single-Machine Canadian pilot, use storage in the approved Canadian boundary, with quotas and a backup/restore plan covering both metadata and files. Choose database BLOBs or volume-backed files based on bounded sizes and atomicity; no storage choice or schema migration has been implemented in this research pass. Actual manuals can exceed the existing warranty-evidence upload limit, so do not reuse that limit or module blindly. Safely admit only verified content; include a malware inspection/quarantine policy before publishing arbitrary documents.

## Eligibility and order-review rules

Maintain distinct policies:

1. **May purchase**: the customer is entitled to buy this item.
2. **Requires review**: an otherwise eligible purchase needs distributor approval.

Recommended initial rule: require review when either the customer or any submitted product is flagged. Customer/product-specific exceptions can be added when a concrete business rule needs them. Existing buyers should not silently receive unrestricted entitlement during migration; staff must explicitly choose the initial catalog access policy.

Recommended first workflow holds the entire submitted request, avoiding partial approval complexity. It has a separate request identifier and statuses **Awaiting approval**, **More information needed**, **Declined**, **Withdrawn**, and **Accepted** (linked to the actual order). Submission must not emit `orders.accepted`, reserve inventory, commit customer exposure, initiate payment collection, invoice or permit shipment. The customer must be told that stock and price are not guaranteed while review is pending. This is a proposed operational default, not an already approved stock-hold policy.

Approval must revalidate current customer status, product eligibility/activity, quote/pricing validity, credit and available supply. A reviewed request cannot reuse an expired quote as a back door. If price or terms change, obtain renewed customer acceptance; do not silently charge a changed amount. Produce at most one accepted order under retries or concurrent staff approval, through the existing native order operation and transaction boundary. Both direct acceptance and approval paths must enforce review requirements. Never temporarily bypass a customer flag to approve one order.

Persist the submitted revision, requested lines, terms, review reason and authorized decision. Stale staff decisions must refuse after customer edits or policy changes. Buyer identity cannot choose a different account or supply approval flags. Notifications can initially be in-app; automatic email remains separately unconfigured. Keep staff-only notes separate from buyer-visible requests for information.

## Bounded implementation sequence and evidence

All implementation rows below remain **not started in this pass**; the asset research is complete to the limitations in its manifest.

1. Catalog entitlement and review-policy data/commands with explicit migration policy. Verify account isolation, stale quotes, revocation and API bypass cases.
2. Native request/review/accept workflow. Verify duplicate and competing approvals, no pre-acceptance inventory/financial side effects, expiry/repricing and authorized transitions.
3. Catalog resource storage and staff upload/publish controls. Verify role/tenant/entitlement boundaries, malformed and oversized files, safe delivery, retirement and backup/restore behavior.
4. Buyer storefront and product pages, images/carousel and scoped orders/payments navigation. Provide keyboard controls, no automatic carousel rotation, touch targets, reduced-motion behavior and small-screen layouts. Check actual iPhone Safari before claiming device support.
5. Import only model-matched and permitted Gree resources into the catalog; preserve provenance and document revisions. Take a qualified backup and follow the schema migration/deployment runbook before any live activation.

The current research collected eight family image entries and 92 technical document links. See [library and download limitations](catalog/README.md). No storefront, upload endpoint, purchasing restriction or order-review workflow has been deployed by this increment. No product gate is verified.
