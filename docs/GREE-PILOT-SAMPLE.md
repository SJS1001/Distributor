# Canadian Gree sample pilot — 2026-10-05

The owner explicitly selected **Seed the current pilot**. Fictional records now live in the real Canadian pilot database at https://dstrbtr.ca/, not an isolated demo. These records affect its stock, orders, accounts and reports. Do not use their totals as real business balances or reset the database after real activity begins.

## Contents

- Eleven sample products: eight Gree equipment entries and three generic HVAC accessories. Family names were checked against the [Gree Canada catalog](https://greehvac.ca/shop/); sample SKUs are not manufacturer part numbers or engineered equipment matches.
- Two sample warehouses, three fictional contractors and one fictional supplier.
- Twelve purchase orders, including an incoming 12-unit delivery with two units received into quarantine. Six units were committed to a customer backorder before partial receipt.
- Four sales orders, including a completed collection, invoice and fictional manual payment, plus open orders and a backorder.
- CAD sample prices, a 10% contractor tier discount and a 13% example tax setting. All prices, stock, serials, credit limits and payments are fictional. They are not approved commercial terms or manufacturer pricing.

The seed uses native commands in `src/demo/gree-pilot-seed.ts`. It refuses a store containing catalog, customer or warehouse records. Each command commits separately: run only on an offline candidate, validate, then activate it with the application writer stopped. It is not a reset operation or a general live-store importer.

## Access and gaps

Distributor staff and customers use the same `/#sign-in` page; the authenticated role determines the workspace. The sample buyer belongs only to Maple Leaf Heating. Credentials are retained in the ignored, protected local file `private-data/fly-ca/sample-customer-access.txt`; a password change was mandatory at first login and has already been completed. The saved initial password is now obsolete; use the password chosen for that account. No credentials belong in this document or Git.

At the historical schema-24 launch, buyers could browse all active tier-priced products and place orders for their own customer account; product purchasing restrictions were absent. Current live schema-25 source adds backend account entitlement and conditional review policies. Existing migrated buyers default to denied until staff chooses none/all/selected access. The fictional seed explicitly assigns its sample contractors all-product access; this fixture choice does not approve unrestricted access for real contractors. For the live upgrade, the three fictional accounts received selected access only to the eleven sample products, rather than unrestricted future catalog access.

The optional asynchronous `seedGreeFamilyReferences(app, actor, productIdsOrReceipt)` accepts the existing product IDs or protected seed receipt without reseeding business records. It validates fictional SKU correspondence and publishes eight official Gree Canada family-page links with clear family-only, exact-model-unverified metadata. Idempotent retries reuse resource command receipts; generic accessories receive no Gree resources. See [resource policy](CATALOG-RESOURCES.md).

Gree image/manual binaries remain research material, with no verified redistribution permission. The indexed SharePoint technical files are individually unverified and the first attempted manual retrieval was publisher-denied. Exact manufacturer model, capacity, voltage and revision matching remain unresolved. Family-page links do not establish that an actual manual applies to a fictional sample product, and no image binary is published by the helper.

Scanning is implemented in the existing web application, not a separate native scanner app. `src/web/scan-input.tsx` provides keyboard-scanner input, browser-supported camera barcode scanning, confirmation and manual fallback. Receipt, picking and other serial/bin forms use it through the shared modal. Actual device/browser qualification remains outstanding.

## Version and verification

The historical seeded deployment image digest is `sha256:deb84b82401f50a064f1b44c6ba478d18371cc7f4f07e3f0b95c747ed997edb9`, from Canadian launch checkpoint `46f4b62`. That seed changed data without changing deployed UI/API/schema (24). The later storefront/resources/purchasing implementation is deployed on schema 25; see the [current release receipt](evidence/LIVE-STOREFRONT-2026-10-05.md), including full checks, migration and eight published official family links. Historical seed evidence below remains version-specific.

Before activation, the application writer was stopped, an encrypted backup was created and the original store was cloned. Candidate integrity and foreign-key checks passed. All 19 preexisting non-counter rows were preserved; the audit and inventory cost sequence counters advanced and matched their ledgers. The original database and sidecars remain in the protected volume rollback directory. The encrypted pre-seed backup is also retained locally with its key stored separately. Never restore it over subsequent real activity without a reviewed recovery plan.

The focused local integration test passed (1/1): stock, incoming quarantine, buyer account isolation, tier pricing, buyer cart/quote/order acceptance after password change, and reseed refusal. TypeScript checking passed. Live HTTPS checks confirmed the homepage, CA health, distributor access to all 11 products, the buyer's required password change, unauthenticated refusal and logout invalidation. The live check did not place extra orders or change the buyer password.

Historical verification failures are retained in ignored local evidence: an initial test used the wrong stock-state field; strict candidate comparison initially rejected the two legitimate sequence counter changes. A full comparison then established that only those counters changed among preexisting rows, with ledger validation added. A scanner browser replay was blocked before running tests by an occupied auxiliary port 3200; no fresh scanner browser pass or physical-device qualification is claimed. No product gate, full-suite acceptance or live provider qualification follows from this seed.

## Full pilot activity seed — 2026-10-06

The owner asked for the full demonstration data and for the pilot to look like a working distributor. `seedFullPilot` in `src/demo/pilot-full-seed.ts` runs after `seedGreePilot` on an offline copy. It uses native commands only and refuses to run twice.

What it adds:

- **Catalog:** 16 more generic HVAC products (accessories, controls and three unbranded serialized units). It also adds tier prices, MSRPs and reviewed unit costs for all 27 products, 80 suggested add-on pairings, and one product marked out of stock with an expected date.
- **Trade applications:** 10 contractor applications. Seven were approved, and six of those activated a buyer login. One approved invitation awaits activation, two applications are pending and one was rejected. Approved applicants have contacts, purchasing access, pricing or billing terms where relevant. Two require order review and one is on credit hold.
- **Staff:** seven fictional staff users (warehouse, sales, finance, warranty, support and an onboarding administrator).
- **Activity:** about eight weeks of dated history, run under a seed-only virtual clock (`src/demo/virtual-clock.ts`):
  - 14 purchase orders with 49 receipts, one partly in quarantine, plus one supplier return;
  - 24 sales orders, 20 shipments and deliveries, and 13 manual payments;
  - 2 transfers and 2 stock counts;
  - 4 warranty claims at different stages;
  - 2 orders awaiting review, saved carts and record notes.
- **Labels:** the "SAMPLE" and "FICTIONAL SAMPLE" labels are retired through the new audited `product.rename`, `account.rename`, `warehouse.rename` and `supplier.rename` commands. Earlier invoices keep their original copies.

Boundaries:

- All businesses, people, prices, costs, stock, serials and payments are fictional. The site footer and workspace carry "Demonstration site — prices and stock are illustrative".
- Emails use the reserved `.example` domain, and telephone numbers use the fictional 555-01xx range.
- Registration numbers deliberately fail the CRA check digit, so they match no real business.
- Gree entries are family-level names, not model numbers.
- No provider transaction, message or carrier booking is made. Deliveries name the company truck.
- Staff, buyer and onboarding-administrator passwords are random and never recorded. An administrator must reset a password before anyone can use one of those logins.
- The onboarding administrator (Elena Vasquez) exists because application decisions require an administrator to re-enter a password. It remains an active administrator account until the owner deactivates it from Administration.
